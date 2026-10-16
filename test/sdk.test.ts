import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { decodeSignedTransaction, KeyPair } from "near-api-js";
import { NearTrade, NearTradeError, type Quote } from "../src/index.js";

test("amount helpers", () => {
  assert.equal(NearTrade.near(1.5), "1500000000000000000000000");
  assert.equal(NearTrade.near("0.000001"), "1000000000000000000");
  assert.equal(NearTrade.usdc(25), "25000000");
  assert.equal(NearTrade.units("12.5", 18), "12500000000000000000");
  assert.throws(() => NearTrade.usdc("1.0000001"));
});

test("API errors carry status and code", async () => {
  const nt = new NearTrade({ apiKey: "nt_live_test", fetch: (async () => new Response(JSON.stringify({ error: "quote_expired", message: "Ask for a new one." }), { status: 410 })) as typeof fetch });
  await assert.rejects(nt.send("00000000-0000-0000-0000-000000000000", ["x"]), (e: unknown) => e instanceof NearTradeError && e.status === 410 && e.code === "quote_expired");
});

test("signQuote signs every transaction as returned, with increasing nonces", async () => {
  const keyPair = KeyPair.fromRandom("ed25519");
  const account = Buffer.from(keyPair.getPublicKey().data).toString("hex");
  const quote: Quote = {
    quoteId: "q", expiresAt: "", account, token: "token.rhealab.near", side: "buy", venue: "rhea", quoteAsset: "near", amountIn: "1", expectedOut: "1", minOut: "1", tokenDecimals: 18,
    fee: { yoctoNear: "1", bps: 100, partner: null },
    transactions: [
      { receiverId: "wrap.near", actions: [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "10000000000000", deposit: "1000" } }, { type: "FunctionCall", params: { methodName: "ft_transfer_call", args: { receiver_id: "dclv2.ref-labs.near", amount: "1000", msg: "{}" }, gas: "180000000000000", deposit: "1" } }] },
      { receiverId: "treasury.near", actions: [{ type: "Transfer", params: { deposit: "10" } }] },
    ],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const result = body.method === "query" ? { nonce: 41 } : { header: { hash: "11111111111111111111111111111111" } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  }) as typeof fetch;
  try {
    const nt = new NearTrade({ apiKey: "nt_live_test" });
    const signed = await nt.signQuote(quote, { signer: { accountId: account, secretKey: keyPair.toString() } });
    assert.equal(signed.length, 2);
    signed.forEach((item, index) => {
      const tx = decodeSignedTransaction(Buffer.from(item, "base64"));
      assert.equal(tx.transaction.signerId, account);
      assert.equal(tx.transaction.receiverId, quote.transactions[index]!.receiverId);
      assert.equal(BigInt(tx.transaction.nonce), 42n + BigInt(index));
      const hash = createHash("sha256").update(tx.transaction.encode()).digest();
      const sig = Uint8Array.from((tx.signature as unknown as { ed25519Signature: { data: ArrayLike<number> } }).ed25519Signature.data);
      assert.ok(keyPair.verify(hash, sig), "signature verifies");
    });
    const first = decodeSignedTransaction(Buffer.from(signed[0]!, "base64")).transaction.actions;
    assert.equal(first[0]!.functionCall!.methodName, "near_deposit");
    assert.equal(first[1]!.functionCall!.deposit, 1n);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("newAccount makes an implicit account whose id is its public key", async () => {
  const user = await NearTrade.newAccount();
  assert.match(user.accountId, /^[0-9a-f]{64}$/);
  const keyPair = KeyPair.fromString(user.secretKey as Parameters<typeof KeyPair.fromString>[0]);
  assert.equal(keyPair.getPublicKey().toString(), user.publicKey);
  assert.equal(Buffer.from(keyPair.getPublicKey().data).toString("hex"), user.accountId);
});

test("deposit posts the request and waitForTransfer stops at a final status", async () => {
  const seen: Array<{ url: string; body: unknown }> = [];
  const statuses = ["waiting", "processing", "done"];
  const fake = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith("/v1/deposit")) return new Response(JSON.stringify({ depositAddress: "0xabc", amountIn: "20000000" }));
    return new Response(JSON.stringify({ depositAddress: "0xabc", status: statuses.shift() }));
  }) as typeof fetch;
  const nt = new NearTrade({ apiKey: "nt_live_test", fetch: fake });
  const dep = await nt.deposit({ account: "a".repeat(64), chain: "base", asset: "USDC", amount: NearTrade.units(20, 6), refundTo: "0x1111111111111111111111111111111111111111" });
  assert.equal(dep.depositAddress, "0xabc");
  assert.deepEqual(seen[0]!.body, { account: "a".repeat(64), chain: "base", asset: "USDC", amount: "20000000", refundTo: "0x1111111111111111111111111111111111111111" });
  const done = await nt.waitForTransfer("0xabc", { intervalMs: 1 });
  assert.equal(done.status, "done");
  assert.ok(seen.slice(1).every((call) => call.url.endsWith("/v1/transfers/0xabc")));
});
