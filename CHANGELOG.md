# Changelog

## 0.2.0 (2026-10-16)

- The API key is optional: reads and quotes work without one (20 requests a minute, 300 a day per address).
- Market data: `trades`, `holders`, `candles`, `topTraders`, `walletPnl`.

## 0.1.0 (2026-10-16)

- First release: quotes (NEAR or USDC), send, status and waitFor; token discovery for partner keys (tokens, search,
  token safety, prices, launchpads); signing with a key or your own signer, and the wallet-selector hand-off.
