/**
 * A real round trip through the neartrade API with this SDK: buy a token for a small amount of NEAR, then sell what
 * arrived, timing every step. Spends real NEAR (the amount, 1% fee, gas): run it only with a wallet meant for testing.
 *
 *   npx tsx examples/live-trade.ts --key-file <file> [--token token.rhealab.near] [--near 0.05] [--yes]
 *
 * --key-file: a NEAR key file, either near-cli's JSON ({"account_id": "...", "private_key": "ed25519:..."}) or a file
 *   holding the account id on line 1 and the "ed25519:..." secret on line 2. The key is read here and never printed.
 * The neartrade API key: NEARTRADE_KEY, else the file ~/.neartrade/dev-api-key.
 * Without --yes it only quotes (nothing is signed or sent).
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { NearTrade, type Quote } from "../src/index.js";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const yes = process.argv.includes("--yes");
const keyFile = arg("key-file");
if (!keyFile) { console.error("--key-file <file> is required"); process.exit(1); }
const raw = readFileSync(keyFile, "utf8").trim();
let accountId: string, secretKey: string;
try {
  const json = JSON.parse(raw) as { account_id?: string; private_key?: string; secret_key?: string };
  accountId = String(json.account_id ?? ""); secretKey = String(json.private_key ?? json.secret_key ?? "");
} catch {
  const [first, second] = raw.split(/\r?\n/).map((l) => l.trim());
  accountId = first ?? ""; secretKey = second ?? "";
}
if (!/^[a-z0-9._-]{2,64}$/.test(accountId) || !secretKey.startsWith("ed25519:")) { console.error("The key file must hold the account id and an ed25519:... secret."); process.exit(1); }

const apiKey = process.env.NEARTRADE_KEY ?? (() => { try { return readFileSync(join(homedir(), ".neartrade", "dev-api-key"), "utf8").trim(); } catch { return ""; } })();
if (!apiKey) { console.error("No neartrade API key: set NEARTRADE_KEY or write it to ~/.neartrade/dev-api-key"); process.exit(1); }

const token = arg("token") ?? "token.rhealab.near";
const near = arg("near") ?? "0.05";
const nt = new NearTrade({ apiKey });
const signer = { accountId, secretKey };
const t = () => performance.now();
const ms = (from: number) => `${Math.round(t() - from)} ms`;
const show = (q: Quote) => `${q.venue}, ${q.transactions.length} tx, expected ${q.expectedOut}, at least ${q.minOut}, fee ${Number(q.fee.yoctoNear) / 1e24} NEAR`;

async function trade(side: "buy" | "sell", amount: string) {
  const startQuote = t();
  const quote = await nt.quote({ account: accountId, token, side, amount, slippageBps: 500 });
  console.log(`${side} quote in ${ms(startQuote)}: ${show(quote)}`);
  if (!yes) return null;
  const startSign = t();
  const signed = await nt.signQuote(quote, { signer });
  console.log(`${side} signed in ${ms(startSign)}`);
  const startSend = t();
  const result = await nt.send(quote.quoteId, signed);
  console.log(`${side} sent: answered in ${ms(startSend)}, complete ${result.complete}, refunded ${result.refunded}`);
  for (const tx of result.transactions) console.log(`  ${tx.status} https://nearblocks.io/txns/${tx.hash}${tx.error ? `  ${tx.error}` : ""}`);
  const last = result.transactions.at(-1);
  if (last && last.status !== "failed") {
    const final = await nt.waitFor(last.hash, accountId, { until: "EXECUTED_OPTIMISTIC", timeoutMs: 30_000, intervalMs: 150 });
    console.log(`${side} executed ${ms(startSend)} after the send (${final.status})`);
  }
  return { quote, result };
}

console.log(`account ${accountId}, token ${token}, ${near} NEAR${yes ? "" : " (dry run: add --yes to trade)"}`);
const bought = await trade("buy", NearTrade.near(near));
if (yes && bought?.result.complete) {
  // Sell what the buy delivered at least: the quote's minimum (what is above it stays in the wallet).
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await trade("sell", bought.quote.minOut);
} else if (!yes) {
  await trade("sell", NearTrade.units(10, 18));
}
