# @neartradelol/sdk

Every NEAR launchpad and Rhea pool through one integration. Quote a buy or a sell, let your user's wallet sign it, and send it. neartrade keeps the launchpad and DEX connections working; your users stay in your app.

- **Every venue neartrade trades on:** Rhea (classic and DCL pools) and the launchpads' bonding curves: nearly.trade, Meme Cooking, gra.fun, AIdols, Nira, Shards, Nearrr, Umbra, plus Intear's DEX and routr. When a token graduates from its curve, the same call routes to its pool.
- **NEAR or USDC:** pay for a buy in USDC, or take a sell's proceeds in USDC (`quoteAsset: "usdc"`). The conversion is part of the same quote and carries no fee of its own.
- **Users from any chain:** a user with nothing on NEAR gets an account in one call (`NearTrade.newAccount()`, no transaction) and funds it from Ethereum, Base, Arbitrum, BNB Chain, Solana, Tron, TON, Bitcoin and more through NEAR Intents. The first deposit arrives as NEAR, so it pays its own gas. Cash out goes back the same way.
- **Non-custodial:** neartrade never holds keys or funds. You get transactions; your user's key signs them.
- **Free to use:** no subscription. neartrade takes 1% of each swap, already inside the transactions a quote returns. Partner keys are paid an agreed share of that fee on every swap they route, on chain, in the same transaction.
- **Token discovery (partner keys):** trending, new and graduating tokens, search, each token's market and safety facts (Rug %, bundle and developer checks), prices and launchpads.

```sh
npm i @neartradelol/sdk near-api-js   # near-api-js only for signing with a key on your server
```

Get a key at https://dev.neartrade.lol (it takes a few seconds). For partner access (discovery and a fee share), write to https://help.neartrade.lol.

## Onboard a user from any chain

```ts
import { NearTrade } from "@neartradelol/sdk";
const nt = new NearTrade({ apiKey: process.env.NEARTRADE_KEY! });

// 1. A NEAR account, made locally: no transaction, no fee (or make the key yourself, see "Security" below).
const user = await NearTrade.newAccount();   // { accountId: 64 hex, publicKey, secretKey }

// 2. A deposit address on the user's chain. receive "near" (default) arrives as native NEAR and creates the account.
const dep = await nt.deposit({ account: user.accountId, chain: "base", asset: "USDC", amount: NearTrade.units(20, 6), refundTo: "0xUserBaseAddress" });
// the user (or your wallet) sends exactly dep.amountIn of USDC on Base to dep.depositAddress before dep.deadline

// 3. Wait for it, check the balance, trade.
await nt.waitForTransfer(dep.depositAddress, { onStatus: (s) => console.log(s.status) });
const { canTrade, totalUsd } = await nt.account(user.accountId);
const quote = await nt.quote({ account: user.accountId, token: "token.rhealab.near", side: "buy", amount: NearTrade.near(1) });
await nt.signAndSend(quote, { signer: user });

// Cash out: NEAR (or USDC) to an address on any chain, signed and sent here.
await nt.withdrawAndSend({ account: user.accountId, chain: "sol", asset: "USDC", to: "UserSolanaAddress", amount: NearTrade.near(2), from: "near" }, { signer: user });
```

### Security: make the key with NEAR's official call

The key controls your user's funds, so we recommend generating it in code you control with NEAR's official library, or inside your HSM or MPC service, rather than with any third party's helper, ours included. `NearTrade.newAccount()` runs exactly these lines in your process; the key is never sent anywhere, and the API never asks for one.

```ts
import { KeyPair } from "near-api-js";
const keyPair = KeyPair.fromRandom("ed25519");
const user = {
  accountId: Buffer.from(keyPair.getPublicKey().data).toString("hex"), // the implicit account (64 hex)
  secretKey: keyPair.toString(),                                       // keep it in your KMS / HSM / vault
};
```

To keep keys inside your custody service, pass `{ accountId, publicKey, sign: (hash) => ... }` as the signer instead.

### Minimums and timing

NEAR Intents sets a minimum per chain and can change it at any time, including temporary limits; neartrade adds none. On 17 Oct 2026: Ethereum, Base, Arbitrum and Solana took a few dollars, Tron $100 and BNB Chain $1,000 (temporary limits), Bitcoin 8,300 sats. Under the minimum, `deposit()` throws `no_bridge_quote` with `error.details.minimumUsd` (or `minimumUnits`). Funds arrive about 20 to 60 seconds after the source chain confirms (`etaSeconds`).

`nt.bridgeAssets()` lists every chain and asset. The answers state what the user sends, what arrives (`expectedOut`, `minOut`) and the bridge fee (`feeBps`) before anything moves; a deposit that cannot be delivered goes back to `refundTo`.

## Buy in a browser or mobile wallet

```ts
import { NearTrade } from "@neartradelol/sdk";

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

Every API error is a `NearTradeError` with `status`, `code`, a message that says what to do, and `details` (other fields, such as `minimumUsd`):
`key_required`, `scope_required`, `no_bridge_quote`, `insufficient`, `bad_asset`, `bad_refund`, `bad_recipient`, `unknown_account`, `unknown_transfer`, `rate_limited`, `bad_account`, `bad_token`, `bad_side`, `bad_amount`, `bad_slippage`, `bad_quote_asset`, `no_quote`, `no_usdc_route`, `quote_unavailable`, `quote_expired`, `not_your_quote`, `incomplete`, `undecodable`, `changed`.

## Rules

- Sign and send the transactions exactly as returned. Every quote is checked on chain: a key whose swaps arrive without neartrade's fee is revoked automatically.
- Keep the API key on a server.
- Discovery data is for showing tokens to people who trade them through neartrade, not for resale.

## Enterprise and high-volume integrations

Platforms bringing users onto NEAR at scale can agree terms with us directly: volume-based fee arrangements, dedicated rate limits, a partner fee share paid on chain, and integration support. Write to dev@neartrade.lol.

Full SDK reference (every method, type and error): https://dev.neartrade.lol/sdk
API guide: https://dev.neartrade.lol · OpenAPI 3.1: https://dev.neartrade.lol/openapi.json
