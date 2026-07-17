# relayer

Single shared process that bridges every vampchain (not one process per
chain — keeps cost down). Two polling loops per tick:

1. **Deposits**: scans `VampBridge.Deposited` events on L1, mints the
   equivalent native balance on the target vampchain via `anvil_setBalance`.
2. **Withdrawals**: for every `ACTIVE` chain in Postgres, scans its blocks
   for plain-value transfers to the burn address (`0x000...dEaD`) and calls
   `VampBridge.release` on L1 for each one.

Both loops are cursor-based (`IndexerCursor` table) and idempotent per-row
(`mintedAt` / `releasedAt`), so a crash mid-tick just re-scans a small
window on restart rather than double-minting or double-releasing.

This is the system's trust bottleneck by design — see "Trust model" in
`docs/ARCHITECTURE.md`. The relayer's private key must be able to call
`VampBridge.release`; treat it accordingly (secrets manager in production,
never committed).

## Run locally

```bash
cp .env.example .env   # point at your local anvil L1 + deployed contracts
pnpm install
pnpm dev
```

## Known gaps (documented, not silently ignored)

- No reorg handling beyond a fixed confirmation-depth delay (`CONFIRMATIONS`).
- Withdrawal scanning fetches one block at a time per chain per tick — fine
  at meme-chain traffic levels, would need batching for anything busier.
- Single relayer key, single process — no HA/failover yet.
