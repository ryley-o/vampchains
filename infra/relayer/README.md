# relayer

Single shared process that bridges every vampchain (not one process per
chain — keeps cost down). Two polling loops per tick:

1. **Deposits**: scans `VampBridge.Deposited` events on L1, mints the
   equivalent native balance on the target vampchain by sending a real,
   signed transfer from the treasury account (`depositWatcher.ts`) — no
   cheat code, this is a real signed transaction on a real chain. Scaled to
   18 decimals regardless of the base token's own decimals — see
   `scaleToNativeUnits`, needed for correct display for anything that isn't
   18-decimal, e.g. USDC/USDT.
2. **Withdrawals**: for every `ACTIVE` chain in Postgres, scans its blocks
   for plain-value transfers to the withdrawal-signal address (the treasury
   account itself — see below) and signs an EIP-712 claim for each one
   (`eip712Domain` in `eip712.ts`, matching `VampBridge.sol`'s domain and
   `CLAIM_TYPEHASH` exactly) — persisted to `WithdrawalEvent.signature` for
   `infra/rpc-gateway` to serve.

**This process never submits an L1 transaction and never needs L1 ETH.**
`RELAYER_PRIVATE_KEY` is a pure EIP-712 signing key for withdrawal claims —
whoever holds the recipient's private key submits `VampBridge.claim()`
themselves, paying their own gas (see "Bridge withdrawals: pull, not push"
in `docs/ARCHITECTURE.md`). `TREASURY_PRIVATE_KEY` submits real transactions,
but only ever *on a vampchain*, spending that chain's own pre-funded native
currency — never L1 gas either (see "Why geth Clique PoA" in
`docs/ARCHITECTURE.md`).

**Withdrawal signal is recapture, not destroy.** `BURN_ADDRESS` defaults to
the treasury account's own address, not a real dead address — since we
control genesis on every vampchain anyway, there's no reason to actually
incinerate value when a user "burns" to withdraw. It lands back in the same
account deposits are minted from, so a full deposit-then-withdraw round
trip nets to no change in that account's balance.

Both loops are cursor-based (`IndexerCursor` table) and idempotent per-row
(`mintedAt` / `signature` presence), so a crash mid-tick just re-scans a
small window on restart rather than double-minting or double-signing.

This is the system's trust bottleneck by design — see "Trust model" in
`docs/ARCHITECTURE.md`. `RELAYER_PRIVATE_KEY` is the thing that determines
whose withdrawal claims are valid; `TREASURY_PRIVATE_KEY` directly custodies
every vampchain's native currency supply. Treat both accordingly (secrets
manager in production, never committed) — `TREASURY_PRIVATE_KEY` especially,
since unlike the signing key it's never meant to be exposed to a sidechain
node at all, only to this process.

## Run locally

```bash
cp .env.example .env   # point at your local L1 + deployed contracts
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
- Deposit minting is now a real sequential-per-tick transaction (waits for a
  receipt before moving on) rather than an instant cheat-code call — fine
  at expected volumes, would need a proper nonce-managed queue if deposit
  throughput ever became meaningful.
