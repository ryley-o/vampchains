# web

Next.js (App Router) site: browse vampchains, create one, bridge tokens in
and out, and a minimal built-in explorer per chain.

- Chain listing (`/`) and detail pages read Postgres directly via
  `@vampchains/db` (workspace package) for infra state, and read the
  registry contract live via viem for funding/runway — contracts are always
  the source of truth for anything financial, per `docs/ARCHITECTURE.md`.
- All wallet interaction (`create`, bridge deposit/withdraw, top-up) is
  wagmi + viem, injected-connector only for now (no WalletConnect project ID
  needed to run locally — see `src/lib/wagmiConfig.ts` for the easy upgrade
  path to RainbowKit/ConnectKit later).
- Talks to vampchains only through `infra/rpc-gateway`'s public URL, never
  directly — see the gateway's README for why.
- ABIs in `src/lib/abis/*.json` are generated from Foundry's build output,
  not hand-written — run `../scripts/sync-abis.sh` after any contract
  change.

## Run locally

```bash
cp .env.local.example .env.local   # fill in contract addresses after deploying
pnpm install
pnpm dev
```

Verified in this session: production build (`next build`) succeeds cleanly,
and `next start` against a real seeded Postgres correctly renders the chain
list, chain detail pages (including the "contracts not configured" fallback
state), the create flow, and the terms page, with no server errors.
