/**
 * Live checks against dev.neartrade.lol (not part of `npm test`): NEARTRADE_KEY=<a partner key> npx tsx test/live.ts
 * Nothing here can move funds: the one send is signed for a brand-new implicit account that does not exist on chain,
 * so the network refuses it; it checks that /v1/send accepts the SDK's signatures and reports the refusal.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { KeyPair } from "near-api-js";
import { NearTrade, NearTradeError } from "../src/index.js";

const nt = new NearTrade({ apiKey: process.env.NEARTRADE_KEY! });
const ok = (name: string, detail = "") => console.log(`ok   ${name}${detail ? `  ${detail}` : ""}`);
const TOKEN = "token.rhealab.near";
const HOLDER = "tradenear.near";

const me = await nt.me();
assert.ok(me.scopes.includes("discovery"));
ok("me", `${me.perMinute}/min, scopes ${me.scopes.join(",")}`);

for (const list of ["trending", "new", "graduating", "market_cap"] as const) {
  const page = await nt.tokens({ list, limit: 5 });
  assert.ok(page.tokens.length > 0 && page.tokens[0]!.token);
  ok(`tokens ${list}`, page.tokens.map((t) => t.symbol).join(" "));
}
const pads = await nt.launchpads();
assert.ok(pads.launchpads.length > 0 && pads.launchpads.every((p) => !p.id.startsWith("auto:")));
ok("launchpads", pads.launchpads.map((p) => p.id).join(" "));
const padTokens = await nt.tokens({ list: "new", launchpad: pads.launchpads[0]!.id, limit: 3 });
assert.ok(padTokens.tokens.every((t) => t.launchpad === pads.launchpads[0]!.id));
ok("tokens by launchpad", pads.launchpads[0]!.id);
const found = await nt.search("rhea");
assert.ok(found.tokens.some((t) => t.token === TOKEN));
ok("search", `${found.tokens.length} results`);
const detail = await nt.token(TOKEN);
assert.equal(detail.token, TOKEN);
ok("token", `price $${detail.priceUsd} rug ${detail.safety?.rugScore} check ${detail.safety?.check?.verdict}`);
const px = await nt.prices([TOKEN, "trade-2.nearlytrade.near", "not-a-token.near"]);
assert.ok(px.prices[TOKEN]!.priceNear! > 0);
ok("prices", JSON.stringify(px.prices[TOKEN]));
await assert.rejects(nt.token("this-token-does-not-exist-123.near"), (e: unknown) => e instanceof NearTradeError && e.status === 404);
ok("unknown token is a 404 NearTradeError");

const buy = await nt.quote({ account: HOLDER, token: TOKEN, side: "buy", amount: NearTrade.near(0.5) });
assert.ok(BigInt(buy.minOut) > 0n && buy.transactions.length > 0 && buy.fee.bps === 100);
ok("quote buy NEAR", `${buy.venue}, ${buy.transactions.length} tx, fee ${buy.fee.yoctoNear}`);
const ubuy = await nt.quote({ account: HOLDER, token: TOKEN, side: "buy", amount: NearTrade.usdc(5), quoteAsset: "usdc" });
assert.equal(ubuy.quoteAsset, "usdc"); assert.ok(ubuy.conversion);
ok("quote buy USDC", `${ubuy.transactions.length} tx via ${ubuy.conversion!.venue}`);
const sell = await nt.quote({ account: HOLDER, token: TOKEN, side: "sell", amount: NearTrade.units(50, 18) });
ok("quote sell NEAR", `min ${sell.minOut} yocto`);
const usell = await nt.quote({ account: HOLDER, token: TOKEN, side: "sell", amount: NearTrade.units(50, 18), quoteAsset: "usdc" });
ok("quote sell USDC", `min ${Number(usell.minOut) / 1e6} USDC`);
await assert.rejects(nt.quote({ account: HOLDER, token: TOKEN, side: "hold" as never, amount: "1" }), (e: unknown) => e instanceof NearTradeError && e.code === "bad_side");
await assert.rejects(nt.quote({ account: HOLDER, token: TOKEN, side: "buy", amount: "1", quoteAsset: "eur" as never }), (e: unknown) => e instanceof NearTradeError && e.code === "bad_quote_asset");
ok("bad inputs are NearTradeErrors with the API's codes");

// The wallet path: what a wallet-selector wallet is handed.
let handed: unknown = null;
await nt.signAndSendWithWallet({ signAndSendTransactions: async (p) => { handed = p; return []; } }, buy);
const txs = (handed as { transactions: Array<{ signerId: string; receiverId: string; actions: unknown[] }> }).transactions;
assert.equal(txs.length, buy.transactions.length); assert.ok(txs.every((t) => t.signerId === HOLDER));
ok("signAndSendWithWallet hands the batch unchanged");

// Server signing through /v1/send, for an account that does not exist: a node stand-in gives nonce 0 and a real block hash.
const fresh = KeyPair.fromRandom("ed25519");
const ghost = Buffer.from(fresh.getPublicKey().data).toString("hex");
const realBlock = await (await fetch("https://rpc.mainnet.fastnear.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "final" } }) })).json() as { result: unknown };
const node = createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const { id, method } = JSON.parse(body) as { id: unknown; method: string };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result: method === "query" ? { nonce: 0 } : realBlock.result }));
  });
}).listen(0);
const nodeUrl = `http://127.0.0.1:${(node.address() as { port: number }).port}`;
try {
  const gq = await nt.quote({ account: ghost, token: TOKEN, side: "buy", amount: NearTrade.near(0.1) });
  const signed = await nt.signQuote(gq, { signer: { accountId: ghost, secretKey: fresh.toString() }, nodeUrl });
  // A tampered transaction is refused before anything is broadcast.
  const tq = await nt.quote({ account: ghost, token: TOKEN, side: "buy", amount: NearTrade.near(0.1) });
  const tampered = structuredClone(tq);
  const call = tampered.transactions.at(-1)!.actions[0]!;
  if (call.type === "FunctionCall") call.params.deposit = "2"; else call.params.deposit = "2";
  const badSigned = await nt.signQuote(tampered, { signer: { accountId: ghost, secretKey: fresh.toString() }, nodeUrl });
  await assert.rejects(nt.send(tq.quoteId, badSigned), (e: unknown) => e instanceof NearTradeError && e.code === "changed");
  ok("a changed transaction is refused (400 changed)");
  await assert.rejects(nt.send(tq.quoteId, badSigned), (e: unknown) => e instanceof NearTradeError && e.code === "quote_expired");
  ok("a quote is single use (410 quote_expired)");
  const sent = await nt.send(gq.quoteId, signed);
  assert.equal(sent.complete, false); assert.equal(sent.transactions[0]!.status, "failed");
  ok("signed transactions pass /v1/send's checks; the chain refuses the non-existent account", sent.transactions[0]!.error?.slice(0, 80));
} finally {
  node.close();
}
const st = await nt.status("11111111111111111111111111111111111111111111", HOLDER);
assert.equal(st.known, false);
ok("status of an unknown hash");
console.log("all live checks passed");
