import type { AccountSummary, BridgeAssets, Candle, Deposit, DepositRequest, Holder, Launchpad, Me, NewAccount, PlainTransaction, Quote, QuoteRequest, SendResult, TokenDetail, TokenList, Token, Trade, TransferStatus, TxStatus, Withdrawal, WithdrawRequest } from "./types.js";

export * from "./types.js";

export interface NearTradeOptions {
  /**
   * Your key from https://dev.neartrade.lol. Optional to try the API: reads and quotes answer without one (20 requests a
   * minute, 300 a day per address); sending needs one. Keep it on your server: a key inside an app or a page is public.
   */
  apiKey?: string;
  /** Default https://dev.neartrade.lol. */
  baseUrl?: string;
  /** Per-request time limit in ms. Default 15000. */
  timeoutMs?: number;
  /** A fetch implementation (default: the global one). */
  fetch?: typeof fetch;
}

/**
 * An API error: the HTTP status, the API's code (e.g. "quote_expired", "no_quote") and what to do. `details` holds any
 * other fields of the answer, such as a deposit's `minimumUsd` (NEAR Intents' minimum for that chain) on
 * "no_bridge_quote".
 */
export class NearTradeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "NearTradeError";
  }
}

/**
 * Something that can sign for a NEAR account: an ed25519 key (`{ accountId, secretKey: "ed25519:..." }`, signed with
 * near-api-js) or your own signer (an HSM, MPC or custody service) that signs a 32-byte transaction hash.
 */
export type SignerInput =
  | { accountId: string; secretKey: string }
  | { accountId: string; publicKey: string; sign: (hash: Uint8Array) => Promise<Uint8Array> };

/** A wallet-selector wallet (or anything with the same method): it signs and broadcasts a batch itself. */
export interface BatchWallet {
  signAndSendTransactions(params: { transactions: Array<{ signerId: string; receiverId: string; actions: PlainTransaction["actions"] }> }): Promise<unknown>;
}

const DEFAULT_URL = "https://dev.neartrade.lol";
const DEFAULT_RPC = "https://rpc.mainnet.fastnear.com";

function decimalToUnits(amount: number | string, decimals: number): string {
  const text = typeof amount === "number" ? amount.toFixed(decimals) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`not a positive decimal amount: ${amount}`);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error(`more than ${decimals} decimals: ${amount}`);
  const units = BigInt(whole! + fraction.padEnd(decimals, "0"));
  return units.toString();
}

export class NearTrade {
  private readonly key: string | null;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NearTradeOptions = {}) {
    this.key = options?.apiKey?.trim() || null;
    this.base = (options.baseUrl ?? DEFAULT_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** NEAR to yoctoNEAR: NearTrade.near(1.5) === "1500000000000000000000000". */
  static near(amount: number | string): string { return decimalToUnits(amount, 24); }
  /** USDC to its 6-decimal units: NearTrade.usdc(25) === "25000000". */
  static usdc(amount: number | string): string { return decimalToUnits(amount, 6); }
  /** USDT to its 6-decimal units: NearTrade.usdt(25) === "25000000". */
  static usdt(amount: number | string): string { return decimalToUnits(amount, 6); }
  /** Any token's whole amount to its smallest units, given its decimals. */
  static units(amount: number | string, decimals: number): string { return decimalToUnits(amount, decimals); }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: { ...(this.key ? { "x-api-key": this.key } : {}), accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
      if (!response.ok || !data) {
        const { error: code, message, ...details } = (data ?? {}) as { error?: string; message?: string } & Record<string, unknown>;
        throw new NearTradeError(response.status, code ?? "http_error", message ?? `HTTP ${response.status}`, details);
      }
      return data;
    } catch (error) {
      if (error instanceof NearTradeError) throw error;
      if ((error as { name?: string })?.name === "AbortError") throw new NearTradeError(0, "timeout", `No answer within ${this.timeoutMs} ms`);
      throw new NearTradeError(0, "network", error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------------- trading */

  /** The key's limits, scopes and partner terms. */
  me(): Promise<Me> { return this.call("GET", "/v1/me"); }

  /** A quote: the figures and the transactions the account signs. Lives 90 seconds, sent once. */
  quote(request: QuoteRequest): Promise<Quote> { return this.call("POST", "/v1/quote", request); }

  /** Broadcasts a quote's signed transactions (base64, in order) through neartrade's endpoints. */
  send(quoteId: string, signedTransactions: string[]): Promise<SendResult> { return this.call("POST", "/v1/send", { quoteId, signedTransactions }); }

  /** Where one transaction is. */
  status(hash: string, account: string): Promise<TxStatus> { return this.call("GET", `/v1/status/${encodeURIComponent(hash)}?account=${encodeURIComponent(account)}`); }

  /** Asks /v1/status until the transaction reached `until` (default EXECUTED_OPTIMISTIC), failed, or `timeoutMs` passed. */
  async waitFor(hash: string, account: string, options: { until?: "EXECUTED_OPTIMISTIC" | "FINAL"; timeoutMs?: number; intervalMs?: number } = {}): Promise<TxStatus> {
    const order = ["NONE", "INCLUDED", "EXECUTED_OPTIMISTIC", "INCLUDED_FINAL", "EXECUTED", "FINAL"];
    const want = order.indexOf(options.until ?? "EXECUTED_OPTIMISTIC");
    const deadline = Date.now() + (options.timeoutMs ?? 30_000);
    let last: TxStatus | null = null;
    while (Date.now() < deadline) {
      last = await this.status(hash, account).catch(() => last);
      if (last && (last.status === "failed" || order.indexOf(last.status) >= want)) return last;
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 400));
    }
    return last ?? { hash, known: false, status: "unknown" };
  }

  /** The quote's transactions as wallet-selector's signAndSendTransactions takes them. */
  static walletTransactions(quote: Quote): Array<{ signerId: string; receiverId: string; actions: PlainTransaction["actions"] }> {
    return quote.transactions.map((tx) => ({ signerId: quote.account, receiverId: tx.receiverId, actions: tx.actions }));
  }

  /**
   * A browser or mobile wallet (wallet-selector, HOT, Meteor, Intear...): the wallet signs and broadcasts the whole batch
   * itself. neartrade's fee is inside the transactions; do not change them.
   */
  async signAndSendWithWallet(wallet: BatchWallet, quote: Quote): Promise<unknown> {
    return wallet.signAndSendTransactions({ transactions: NearTrade.walletTransactions(quote) });
  }

  /**
   * Signs the quote's transactions with a key or your own signer (nonce and block hash read from `nodeUrl`), then sends
   * them through /v1/send, which waits for each before the next and stops at a refunded swap. Needs near-api-js
   * (a peer dependency) to build the transactions.
   */
  async signAndSend(quote: Quote, options: { signer: SignerInput; nodeUrl?: string }): Promise<SendResult> {
    const signed = await this.signQuote(quote, options);
    return this.send(quote.quoteId, signed);
  }

  /** The quote's transactions signed, base64, in order (signAndSend without the send). */
  async signQuote(quote: Quote, options: { signer: SignerInput; nodeUrl?: string }): Promise<string[]> {
    if (options.signer.accountId !== quote.account) throw new Error(`the quote is for ${quote.account}, the signer is ${options.signer.accountId}`);
    return signTransactions(quote.account, quote.transactions, options);
  }

  /* ---------------------------------------------------------------- onboarding (NEAR Intents, any chain) */

  /**
   * A new NEAR account, made locally with no transaction and no fee: an implicit account (its id is the public key in
   * hex), live as soon as NEAR reaches it, e.g. a deposit() with receive "near". Store secretKey as you store keys.
   * Needs near-api-js.
   */
  static async newAccount(): Promise<NewAccount> {
    const near = await nearApi();
    const keyPair = near.KeyPair.fromRandom("ed25519");
    const publicKey = keyPair.getPublicKey();
    return { accountId: hex(publicKey.data), publicKey: publicKey.toString(), secretKey: keyPair.toString() };
  }

  /** Every chain and asset a deposit can come from or a withdrawal go to, and the bridge fee. */
  bridgeAssets(): Promise<BridgeAssets> { return this.call("GET", "/v1/bridge/assets"); }

  /**
   * A deposit address on another chain (USDC on Base, SOL, BNB, USDT on Tron, BTC...) that delivers to a NEAR account
   * through NEAR Intents. With receive "near" (default) the funds arrive as native NEAR, which also creates a new
   * implicit account and pays its gas. The user sends exactly `amountIn` to `depositAddress` before `deadline`.
   */
  deposit(request: DepositRequest): Promise<Deposit> { return this.call("POST", "/v1/deposit", request); }

  /** NEAR or USDC from a NEAR account to an address on any chain: the figures and the transaction to sign. */
  withdraw(request: WithdrawRequest): Promise<Withdrawal> { return this.call("POST", "/v1/withdraw", request); }

  /** withdraw(), signed with `signer` and broadcast, then reported to NEAR Intents. Returns the withdrawal and the hash. */
  async withdrawAndSend(request: WithdrawRequest, options: { signer: SignerInput; nodeUrl?: string }): Promise<{ withdrawal: Withdrawal; hash: string }> {
    if (options.signer.accountId !== request.account) throw new Error(`the withdrawal is from ${request.account}, the signer is ${options.signer.accountId}`);
    const withdrawal = await this.withdraw(request);
    const [signed] = await signTransactions(request.account, withdrawal.transactions, options);
    const outcome = await rpc<{ transaction: { hash: string } }>(options.nodeUrl ?? DEFAULT_RPC, "send_tx", { signed_tx_base64: signed, wait_until: "INCLUDED" });
    await this.submitTransfer(withdrawal.depositAddress, outcome.transaction.hash).catch(() => undefined);
    return { withdrawal, hash: outcome.transaction.hash };
  }

  /** Tells NEAR Intents which transaction sent the funds, so it is picked up at once. */
  submitTransfer(depositAddress: string, txHash: string): Promise<{ ok: true }> {
    return this.call("POST", `/v1/transfers/${encodeURIComponent(depositAddress)}/submit`, { txHash });
  }

  /** Where a deposit or withdrawal is. */
  transfer(depositAddress: string): Promise<TransferStatus> { return this.call("GET", `/v1/transfers/${encodeURIComponent(depositAddress)}`); }

  /** Asks transfer() until it is done, refunded, failed or incomplete, or `timeoutMs` (default 20 minutes) passed. */
  async waitForTransfer(depositAddress: string, options: { timeoutMs?: number; intervalMs?: number; onStatus?: (status: TransferStatus) => void } = {}): Promise<TransferStatus> {
    const deadline = Date.now() + (options.timeoutMs ?? 20 * 60_000);
    let last: TransferStatus | null = null;
    while (Date.now() < deadline) {
      const now = await this.transfer(depositAddress).catch(() => null);
      if (now && now.status !== last?.status) options.onStatus?.(now);
      if (now) last = now;
      if (last && ["done", "refunded", "failed", "incomplete"].includes(last.status)) return last;
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 5_000));
    }
    if (!last) throw new NearTradeError(0, "timeout", `No status for ${depositAddress} within the time limit`);
    return last;
  }

  /** What a NEAR account holds (NEAR, every token with USD values) and whether it has the NEAR to trade. */
  account(account: string): Promise<AccountSummary> { return this.call("GET", `/v1/accounts/${encodeURIComponent(account)}`); }

  /* ---------------------------------------------------------------- discovery (partner keys) */

  /** Token lists: "trending" (24 h volume), "new", "graduating" (curves closest to their pool), "market_cap". */
  tokens(options: { list?: "trending" | "new" | "graduating" | "market_cap"; launchpad?: string; limit?: number; offset?: number } = {}): Promise<TokenList> {
    const q = new URLSearchParams();
    if (options.list) q.set("list", options.list);
    if (options.launchpad) q.set("launchpad", options.launchpad);
    if (options.limit !== undefined) q.set("limit", String(options.limit));
    if (options.offset !== undefined) q.set("offset", String(options.offset));
    return this.call("GET", `/v1/tokens${q.size ? `?${q}` : ""}`);
  }

  /** Up to 25 tokens by symbol, name or contract. */
  search(query: string): Promise<{ query: string; tokens: Token[] }> { return this.call("GET", `/v1/tokens/search?q=${encodeURIComponent(query)}`); }

  /** One token with its safety facts (Rug %, the three-step check, holders, developer, bundles, taxes). */
  token(token: string): Promise<TokenDetail> { return this.call("GET", `/v1/tokens/${encodeURIComponent(token)}`); }

  /** Up to 50 prices in NEAR and USD. */
  prices(tokens: string[]): Promise<{ nearUsd: number | null; prices: Record<string, { priceNear: number | null; priceUsd: number | null }> }> {
    return this.call("GET", `/v1/prices?tokens=${encodeURIComponent(tokens.join(","))}`);
  }

  /** The launchpads neartrade trades on. */
  launchpads(): Promise<{ launchpads: Launchpad[] }> { return this.call("GET", "/v1/launchpads"); }

  /* ---------------------------------------------------------------- market data */

  /** The token's latest trades, newest first. */
  trades(token: string, options: { limit?: number } = {}): Promise<{ token: string; trades: Trade[] }> {
    return this.call("GET", `/v1/tokens/${encodeURIComponent(token)}/trades${options.limit ? `?limit=${options.limit}` : ""}`);
  }

  /** The holder count and the biggest holders, each with its kind (wallet, pool, bridge, contract, burn...). */
  holders(token: string, options: { limit?: number } = {}): Promise<{ token: string; holders: number | null; updatedAt: string | null; top: Holder[] }> {
    return this.call("GET", `/v1/tokens/${encodeURIComponent(token)}/holders${options.limit ? `?limit=${options.limit}` : ""}`);
  }

  /** OHLCV candles in NEAR from on-chain trades. */
  candles(token: string, options: { interval?: "1m" | "5m" | "15m" | "1h" | "4h" | "1d"; limit?: number } = {}): Promise<{ token: string; interval: string; unit: string; candles: Candle[] }> {
    const q = new URLSearchParams();
    if (options.interval) q.set("interval", options.interval);
    if (options.limit) q.set("limit", String(options.limit));
    return this.call("GET", `/v1/tokens/${encodeURIComponent(token)}/candles${q.size ? `?${q}` : ""}`);
  }

  /** The token's biggest traders by volume. */
  topTraders(token: string, options: { limit?: number } = {}): Promise<{ token: string; totals: unknown; traders: unknown[] }> {
    return this.call("GET", `/v1/tokens/${encodeURIComponent(token)}/top-traders${options.limit ? `?limit=${options.limit}` : ""}`);
  }

  /** A wallet's positions and realised P&L. */
  walletPnl(account: string): Promise<{ account: string; positions: unknown[]; totals: unknown }> {
    return this.call("GET", `/v1/wallets/${encodeURIComponent(account)}/pnl`);
  }
}

async function nearApi(): Promise<typeof import("near-api-js")> {
  const near = (await import("near-api-js").catch(() => null)) as typeof import("near-api-js") | null;
  if (!near) throw new Error("this needs near-api-js: npm i near-api-js");
  return near;
}

/** Signs `transactions` from `account` in order (nonce and block hash read from `nodeUrl`), base64. */
async function signTransactions(account: string, transactions: PlainTransaction[], options: { signer: SignerInput; nodeUrl?: string }): Promise<string[]> {
  const near = await nearApi();
  const nodeUrl = options.nodeUrl ?? DEFAULT_RPC;
  let publicKeyText: string;
  let sign: (hash: Uint8Array) => Promise<Uint8Array>;
  if ("secretKey" in options.signer) {
    const keyPair = near.KeyPair.fromString(options.signer.secretKey as Parameters<typeof near.KeyPair.fromString>[0]);
    publicKeyText = keyPair.getPublicKey().toString();
    sign = async (hash) => keyPair.sign(hash).signature;
  } else {
    publicKeyText = options.signer.publicKey;
    sign = options.signer.sign;
  }
  const publicKey = near.PublicKey.fromString(publicKeyText);
  const [accessKey, block] = await Promise.all([
    rpc<{ nonce: number | string }>(nodeUrl, "query", { request_type: "view_access_key", finality: "final", account_id: account, public_key: publicKeyText }),
    rpc<{ header: { hash: string } }>(nodeUrl, "block", { finality: "final" }),
  ]);
  const blockHash = near.baseDecode(block.header.hash);
  let nonce = BigInt(accessKey.nonce);
  const out: string[] = [];
  for (const tx of transactions) {
    nonce += 1n;
    const actions = tx.actions.map((action) => action.type === "Transfer"
      ? near.actions.transfer(BigInt(action.params.deposit))
      : near.actions.functionCall(action.params.methodName, action.params.args, BigInt(action.params.gas), BigInt(action.params.deposit)));
    const transaction = near.createTransaction(account, publicKey, tx.receiverId, nonce, actions, blockHash);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", transaction.encode()));
    const signature = new near.Signature({ keyType: publicKey.keyType, data: await sign(hash) });
    const signedTx = new near.SignedTransaction({ transaction, signature });
    out.push(toBase64(signedTx.encode()));
  }
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "neartrade-sdk", method, params }) });
  const body = (await response.json().catch(() => null)) as { result?: T; error?: { message?: string; cause?: { name?: string } } } | null;
  if (!body?.result) throw new Error(`NEAR RPC ${method}: ${body?.error?.cause?.name ?? body?.error?.message ?? `HTTP ${response.status}`}`);
  return body.result;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export default NearTrade;
