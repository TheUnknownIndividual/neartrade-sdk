# @neartrade/sdk

Every NEAR launchpad and Rhea pool through one integration. Quote a buy or a sell, let your user's wallet sign it, and send it. neartrade keeps the launchpad and DEX connections working; your users stay in your app.

- **Every venue neartrade trades on:** Rhea (classic and DCL pools) and the launchpads' bonding curves: nearly.trade, Meme Cooking, gra.fun, AIdols, Nira, Shards, Nearrr, Umbra, plus Intear's DEX and routr. When a token graduates from its curve, the same call routes to its pool.
- **NEAR or USDC:** pay for a buy in USDC, or take a sell's proceeds in USDC (`quoteAsset: "usdc"`). The conversion is part of the same quote and carries no fee of its own.
- **Non-custodial:** neartrade never holds keys or funds. You get transactions; your user's key signs them.
- **Free to use:** no subscription. neartrade takes 1% of each swap, already inside the transactions a quote returns. Partner keys are paid an agreed share of that fee on every swap they route, on chain, in the same transaction.
- **Token discovery (partner keys):** trending, new and graduating tokens, search, each token's market and safety facts (Rug %, bundle and developer checks), prices and launchpads.

```sh
npm i @neartrade/sdk near-api-js   # near-api-js only for signing with a key on your server
```

Get a key at https://dev.neartrade.lol (it takes a few seconds). For partner access (discovery and a fee share), write to https://help.neartrade.lol.

## Buy in a browser or mobile wallet

```ts
import { NearTrade } from "@neartrade/sdk";

// On your server: the key stays there.
const nt = new NearTrade({ apiKey: process.env.NEARTRADE_KEY! });
const quote = await nt.quote({ account: "alice.near", token: "token.rhealab.near", side: "buy", amount: NearTrade.near(1) });

// In the client: the user's wallet (wallet-selector, HOT, Meteor, Intear...) signs and broadcasts the batch.
await wallet.signAndSendTransactions({ transactions: NearTrade.walletTransactions(quote) });
```

Show the user `quote.expectedOut` and `quote.minOut` (the token's smallest units, `quote.tokenDecimals`) before they sign. A quote lives 90 seconds.

## Pay with USDC, get USDC back

```ts
const buy = await nt.quote({ account, token, side: "buy", amount: NearTrade.usdc(25), quoteAsset: "usdc" });
const sell = await nt.quote({ account, token, side: "sell", amount: NearTrade.units(1000, 18), quoteAsset: "usdc" });
// sell.expectedOut and sell.minOut are USDC (6 decimals).
```

A USDC quote has a `conversion` block and a few more transactions (a storage registration when the account needs one, the USDC swap, and on a buy the unwrap of the NEAR it delivers). Sign and send them all, in order.

## Sign on your server

For custodial apps, bots and agents that hold the account's key (or sign through an HSM, MPC or custody service):

```ts
const result = await nt.signAndSend(quote, { signer: { accountId: "alice.near", secretKey: process.env.ALICE_KEY! } });
// or your own signer of a 32-byte transaction hash:
await nt.signAndSend(quote, { signer: { accountId, publicKey: "ed25519:...", sign: async (hash) => mySigner.sign(hash) } });

if (result.refunded) console.log("price moved past the slippage: nothing was traded");
const final = await nt.waitFor(result.transactions.at(-1)!.hash, quote.account);
```

`signAndSend` sends through neartrade's `/v1/send`, which broadcasts through several endpoints, waits for each transaction before the next and stops at a refunded swap.

## Discovery (partner keys)

```ts
const trending = await nt.tokens({ list: "trending", limit: 20 });
const fresh = await nt.tokens({ list: "new", launchpad: "memecooking" });
const found = await nt.search("rhea");
const token = await nt.token("token.rhealab.near");
token.safety?.rugScore;        // 0-100, null when too little is known
token.safety?.check?.verdict;  // "skip" (a red step), "small" (all green) or "unknown"
const { prices } = await nt.prices(["token.rhealab.near", "trade-2.nearlytrade.near"]);
```

## Errors

Every API error is a `NearTradeError` with `status`, `code` and a message that says what to do:
`key_required`, `scope_required`, `rate_limited`, `bad_account`, `bad_token`, `bad_side`, `bad_amount`, `bad_slippage`, `bad_quote_asset`, `no_quote`, `no_usdc_route`, `quote_unavailable`, `quote_expired`, `not_your_quote`, `incomplete`, `undecodable`, `changed`.

## Rules

- Sign and send the transactions exactly as returned. Every quote is checked on chain: a key whose swaps arrive without neartrade's fee is revoked automatically.
- Keep the API key on a server.
- Discovery data is for showing tokens to people who trade them through neartrade, not for resale.

Full reference: https://dev.neartrade.lol
