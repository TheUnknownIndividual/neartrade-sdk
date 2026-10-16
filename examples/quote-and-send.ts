/**
 * Buy a token for 0.1 NEAR from a key held on this server, then wait for the swap.
 * NEARTRADE_KEY=nt_live_... ACCOUNT=you.near SECRET=ed25519:... TOKEN=token.rhealab.near npx tsx examples/quote-and-send.ts
 * Add DRY=1 to stop after the quote (nothing is signed or sent).
 */
import { NearTrade } from "../src/index.js";

const nt = new NearTrade({ apiKey: process.env.NEARTRADE_KEY! });
const account = process.env.ACCOUNT!;
const quote = await nt.quote({ account, token: process.env.TOKEN ?? "token.rhealab.near", side: "buy", amount: NearTrade.near(0.1), slippageBps: 300 });
console.log(`venue ${quote.venue}: ~${quote.expectedOut} (at least ${quote.minOut}), fee ${quote.fee.yoctoNear} yoctoNEAR, ${quote.transactions.length} transaction(s)`);
if (process.env.DRY === "1") process.exit(0);
const result = await nt.signAndSend(quote, { signer: { accountId: account, secretKey: process.env.SECRET! } });
console.log(result);
const last = result.transactions.at(-1);
if (last) console.log(await nt.waitFor(last.hash, account));
