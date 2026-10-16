# Security

The SDK never sends a private key anywhere: `signAndSend` signs on your machine and sends only signed transactions.
Keep your neartrade API key on a server.

Report a vulnerability privately through https://help.neartrade.lol (support chat), not in a public issue. We reply
within two working days.

Releases are published to npm from GitHub Actions with npm provenance: each version on npmjs.com links to the exact
commit and workflow run that built it.
