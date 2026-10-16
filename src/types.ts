/** A NEAR action as the API returns it (the same shape wallet-selector's signAndSendTransactions takes). */
export type Action =
  | { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }
  | { type: "Transfer"; params: { deposit: string } };

export interface PlainTransaction {
  receiverId: string;
  actions: Action[];
}

export type Side = "buy" | "sell";
export type QuoteAsset = "near" | "usdc";

export interface QuoteRequest {
  /** The NEAR account that will sign. */
  account: string;
  /** The token's contract account, e.g. "token.rhealab.near". */
  token: string;
  side: Side;
  /**
   * What goes in, as an integer string: yoctoNEAR for a buy (NearTrade.near(1)), the token's smallest unit for a sell,
   * or USDC's 6-decimal units for a buy with quoteAsset "usdc" (NearTrade.usdc(25)).
   */
  amount: string;
  /** 10 to 5000. Default 300 (3%). */
  slippageBps?: number;
  /** "near" (default) or "usdc": pay a buy in USDC, or take a sell's proceeds in USDC. */
  quoteAsset?: QuoteAsset;
}

export interface Quote {
  quoteId: string;
  expiresAt: string;
  account: string;
  token: string;
  side: Side;
  venue: string;
  quoteAsset: QuoteAsset;
  amountIn: string;
  /** After neartrade's fee. In USDC units for a usdc sell, yoctoNEAR for a sell, the token's units for a buy. */
  expectedOut: string;
  minOut: string;
  tokenDecimals: number | null;
  conversion?: { venue: string; from: string; to: string; usdcDecimals: number; nearIn: string | null; nearOut: { expected: string; min: string } | null; fee: string };
  fee: { yoctoNear: string; bps: number | null; partner: { account: string; shareBps: number; yoctoNear: string | null } | null };
  transactions: PlainTransaction[];
}

export interface SendResult {
  quoteId: string;
  transactions: Array<{ hash: string; status: "executed" | "included" | "failed"; error?: string }>;
  /** The venue could not fill within minOut and sent the input back; nothing after the swap was sent. */
  refunded: boolean;
  complete: boolean;
}

export interface TxStatus {
  hash: string;
  known: boolean;
  status: string;
  failure?: string | null;
  refunded?: boolean;
  detail?: string;
}

export interface Me {
  name: string;
  perMinute: number;
  scopes: string[];
  partner: { account: string; shareBps: number } | null;
}

export interface Token {
  token: string;
  symbol: string;
  name: string;
  icon: string | null;
  decimals: number | null;
  launchpad: string | null;
  status: "bonding_curve" | "trading";
  graduationProgressBps: number | null;
  priceUsd: number | null;
  priceNear: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  holders: number | null;
  createdAt: string | null;
  poolId: string | null;
  url: string;
}

export interface CheckStep { key: "clusters" | "bundles" | "dev"; label: string; state: "pass" | "fail" | "unknown"; detail: string }

export interface TokenSafety {
  /** 0 to 100, higher is riskier; null when too little is known. */
  rugScore: number | null;
  rugConfidence: number | null;
  rugReasons: string[];
  /** The three-step check before a buy: any "fail" means skip. */
  check: { verdict: "skip" | "small" | "unknown"; failed: number; steps: CheckStep[] } | null;
  top10Pct: number | null;
  developer: string | null;
  developerPct: number | null;
  insidersPct: number | null;
  launchBundlesHeldPct: number | null;
  buyTaxBps: number | null;
  sellTaxBps: number | null;
  mintable: boolean | null;
  contractLocked: boolean | null;
  updatedAt: string;
}

export interface TokenDetail extends Token {
  safety: TokenSafety | null;
}

export interface TokenList {
  list: string;
  total: number;
  offset: number;
  limit: number;
  nearUsd: number | null;
  updatedAt: string;
  tokens: Token[];
}

export interface Launchpad { id: string; tokens: number; launched24h: number; launched7d: number; graduated: number; volume24hUsd: number }

export interface Trade { trader: string; side: "buy" | "sell" | string; tokenAmount: string; nearAmount: string; tx: string; at: string | null; pool: string | null }
export interface Holder { account: string; balance: string; kind: string }
export interface Candle { time: string; open: number; high: number; low: number; close: number; volume: number }
