# relayer

Single shared process that bridges every vampchain (not one process per
chain — keeps cost down). Two polling loops per tick:

1. **Deposits**: scans `VampBridge.Deposited` events on L1, mints the
   equivalent native balance on the target vampchain via `anvil_setBalance`
   (scaled to 18 decimals regardless of the base token's own decimals — see
   `scaleToNativeUnits` in `depositWatcher.ts`, needed for correct display
   for anything that isn't 18-decimal, e.g. USDC/USDT).
2. **Withdrawals**: for every `ACTIVE` chain in Postgres, scans its blocks
   for plain-value transfers to the burn address (`0x000...dEaD`) and signs
   an EIP-712 claim for each one (`eip712Domain` in `eip712.ts`, matching
   `VampBridge.sol`'s domain and `CLAIM_TYPEHASH` exactly) — persisted to
   `WithdrawalEvent.signature` for `infra/rpc-gateway` to serve.

**This process never submits an L1 transaction and never needs ETH.**
Minting is `anvil_setBalance` (free, not a real tx). Withdrawals used to be
a pushed `release()` call the relayer paid gas for; that's gone — the
relayer only signs, and whoever holds the recipient's private key submits
`VampBridge.claim()` themselves, paying their own gas. See "Bridge
withdrawals: pull, not push" in `docs/ARCHITECTURE.md` for the full
rationale.

Both loops are cursor-based (`IndexerCursor` table) and idempotent per-row
(`mintedAt` / `signature` presence), so a crash mid-tick just re-scans a
small window on restart rather than double-minting or double-signing.

This is the system's trust bottleneck by design — see "Trust model" in
`docs/ARCHITECTURE.md`. The relayer's private key is a pure signing key (it
never needs a funded wallet), but it's still the thing that determines
whose claims are valid; treat it accordingly (secrets manager in
production, never committed).

## Run locally

```bash
cp .env.example .env   # point at your local anvil L1 + deployed contracts
pnpm install
pnpm dev
```

## Known gaps (documented, not silently ignored)

- No reorg handling beyond a fixed confirmation-depth delay (`CONFIRMATIONS`,
  L1 side only — the sidechain side deliberately has none, see
  `withdrawalWatcher.ts`).
- Withdrawal scanning fetches one block at a time per chain per tick — fine
  at meme-chain traffic levels, would need batching for anything busier.
- Single signing key, single process — no HA/failover yet.
- Burning an amount that isn't an exact multiple of `10^(18-decimals)`
  raw units loses the remainder as unclaimable dust (rounds down).
- We don't yet index the on-chain `Claimed` event back into
  `WithdrawalEvent.claimTxHash`/`claimedAt` — `VampBridge.claimed(txHash)` on
  chain is the real source of truth for whether a claim has happened.
