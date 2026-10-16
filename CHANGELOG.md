# Changelog

## 0.3.0 (2026-10-17)

- Onboarding from any chain through NEAR Intents: `deposit` (a deposit address on Ethereum, Base, Arbitrum, BNB Chain,
  Solana, Tron, TON, Bitcoin and more that delivers to a NEAR account; with `receive: "near"` it arrives as native NEAR
  and creates a new account), `withdraw` / `withdrawAndSend` (NEAR or USDC out to any chain), `transfer`,
  `waitForTransfer`, `submitTransfer`, `bridgeAssets`.
- `NearTrade.newAccount()`: a NEAR implicit account made locally, with no transaction and no fee.
- `account`: NEAR, every token with USD values, the total, and `canTrade`.

## 0.2.0 (2026-10-16)

- The API key is optional: reads and quotes work without one (20 requests a minute, 300 a day per address).
- Market data: `trades`, `holders`, `candles`, `topTraders`, `walletPnl`.

## 0.1.0 (2026-10-16)

- First release: quotes (NEAR or USDC), send, status and waitFor; token discovery for partner keys (tokens, search,
  token safety, prices, launchpads); signing with a key or your own signer, and the wallet-selector hand-off.
