# rpc-gateway

The only *public* entrypoint into a vampchain's RPC. Small always-on Node
service (plain `node:http`, no framework) meant to run as its own Fly app in
the same org as the vampchain nodes, so it can reach their `.internal`
addresses.

`POST /rpc/:chainId` looks up the chain in Postgres, requires `status ===
"ACTIVE"`, strictly allowlists the JSON-RPC method(s) in the request against
`src/allowlist.ts` (rejects the whole request — batch or single — if
anything isn't allowlisted), rate-limits per client IP, then forwards
verbatim to the chain's internal RPC.

**This allowlist is a security boundary, not a convenience filter.** The
Clique signer's unlocked account is how deposits get minted; if
account-management methods were reachable here, anyone could self-mint
native currency and bypass `VampBridge` entirely. Verified live in this
session:

- `eth_chainId` (allowed) forwards correctly.
- `personal_unlockAccount` (not allowed) is rejected with a JSON-RPC error
  and never reaches the node — confirmed no account state changed
  afterward.
- Rate limiting: with `RATE_LIMIT_CAPACITY=5`, requests 1–5 returned `200`,
  requests 6–8 returned `429`.

## Run locally

```bash
cp .env.example .env
pnpm install
pnpm dev
```
