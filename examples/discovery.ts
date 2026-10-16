/** Partner keys: the trending list, one token's safety facts and a USDC quote. NEARTRADE_KEY=... npx tsx examples/discovery.ts */
import { NearTrade } from "../src/index.js";

const nt = new NearTrade({ apiKey: process.env.NEARTRADE_KEY! });
console.log(await nt.me());
const { tokens } = await nt.tokens({ list: "trending", limit: 5 });
for (const t of tokens) console.log(t.symbol.padEnd(10), t.launchpad ?? "-", t.status, t.marketCapUsd ? `$${Math.round(t.marketCapUsd)}` : "-");
const detail = await nt.token(tokens[0]!.token);
console.log(detail.symbol, "rug", detail.safety?.rugScore, "check", detail.safety?.check?.verdict, detail.safety?.check?.steps.map((s) => `${s.label}: ${s.state}`).join(" | "));
const usdc = await nt.quote({ account: "tradenear.near", token: tokens[0]!.token, side: "buy", amount: NearTrade.usdc(10), quoteAsset: "usdc" });
console.log("10 USDC buys ~", usdc.expectedOut, "via", usdc.conversion?.venue, "then", usdc.venue, `(${usdc.transactions.length} transactions)`);
