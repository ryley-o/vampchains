# Deployment

## Local development (verified working)

```bash
pnpm install
./scripts/dev-up.sh
```

This brings up Postgres + a local geth-based "home chain" (standing in for
Base) via `docker compose`, deploys a fresh `MockUSDC` + `VampChainRegistry` +
`VampBridge` to it, migrates the database, and starts `rpc-gateway`,
`relayer`, and `provisioner` as containers wired to each other. It prints
the deployed addresses and a ready-to-use `web/.env.local` block — paste
that in and run `pnpm --filter @vampchains/web dev` separately (kept off
docker-compose for normal Next.js hot-reload dev).

Tear down with `./scripts/dev-down.sh` — it also removes any per-vampchain
containers the provisioner created along the way, which aren't part of the
compose project.

**What "verified working" means here**: while building this, the full loop
was actually run against this stack — `createChain` on-chain, watched the
provisioner discover the event and spin up a real Docker container for the
new vampchain, deposited a token and watched the relayer mint the balance
on it (checked through the public rpc-gateway, not by reaching into the
container directly), then burned it back, watched the relayer sign a claim,
and submitted that claim to get the original token back on L1. Balances
matched exactly at every step, including state persisting correctly across
a container restart.

## Taking it to real infra

You'll need: a **Neon** account (Postgres), a **Vercel** account (web app),
a **Fly.io** account + org (everything else), a funded deployer wallet, and
an RPC endpoint for your home chain (Base mainnet or Base Sepolia to start).

### 1. Neon Postgres

Create a project, grab the **pooled** connection string (`DATABASE_URL`),
then run migrations against it:

```bash
DATABASE_URL="postgresql://...neon..." pnpm --filter @vampchains/db exec prisma migrate deploy
```

### 2. Deploy the contracts

```bash
cd contracts
PRIVATE_KEY=0x... \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913 \
RELAYER_ADDRESS=0x...  # the relayer's hot wallet address, see step 4
forge script script/Deploy.s.sol --rpc-url <base-rpc-url> --broadcast --verify
```

(The USDC address above is Base mainnet USDC — double check it against a
canonical source before using it; use Base Sepolia's testnet USDC instead if
deploying there first, which you should.)

Keep the printed `VampChainRegistry`/`VampBridge` addresses — every other
component needs them.

### 3. Fly.io: sidechain-node image + the three services

```bash
fly auth login
fly orgs create vampchains   # or use an existing org

# Build once, every vampchain reuses this same image. --platform
# linux/amd64 matters if you're building on Apple Silicon — Fly's fleet is
# amd64, and a plain `docker build` there produces an arm64-only image that
# fails machine creation with no obviously-architecture-related error (see
# the "real issues" list below).
fly auth docker
docker buildx build --platform linux/amd64 \
  -t registry.fly.io/vampchains-sidechain-node:latest \
  --push infra/sidechain-node
```

Deploy the three always-on services (each has a `fly.toml` + `Dockerfile`
already in its directory):

```bash
fly apps create vampchains-relayer
fly secrets set -a vampchains-relayer \
  DATABASE_URL=... L1_RPC_URL=... L1_CHAIN_ID=8453 \
  BRIDGE_ADDRESS=0x... RELAYER_PRIVATE_KEY=0x... TREASURY_PRIVATE_KEY=0x...
fly deploy --config infra/relayer/fly.toml --dockerfile infra/relayer/Dockerfile

fly apps create vampchains-provisioner
fly secrets set -a vampchains-provisioner \
  DATABASE_URL=... L1_RPC_URL=... L1_CHAIN_ID=8453 \
  REGISTRY_ADDRESS=0x... PROVISIONER_PRIVATE_KEY=0x... \
  CLIQUE_SIGNER_PRIVATE_KEY=0x... \
  PROVISION_BACKEND=fly FLY_API_TOKEN=... FLY_ORG_SLUG=vampchains \
  SIDECHAIN_IMAGE=registry.fly.io/vampchains-sidechain-node:latest
fly deploy --config infra/provisioner/fly.toml --dockerfile infra/provisioner/Dockerfile

fly apps create vampchains-rpc-gateway
fly secrets set -a vampchains-rpc-gateway DATABASE_URL=...
fly deploy --config infra/rpc-gateway/fly.toml --dockerfile infra/rpc-gateway/Dockerfile
```

Use **separate** keys for `RELAYER_PRIVATE_KEY`, `PROVISIONER_PRIVATE_KEY`,
`TREASURY_PRIVATE_KEY`, and `CLIQUE_SIGNER_PRIVATE_KEY`. `RELAYER_PRIVATE_KEY`
is a pure EIP-712 signing key — it authorizes `VampBridge.claim()` calls
(whoever holds it decides what's claimable) but never submits a transaction
itself and never needs ETH. `PROVISIONER_PRIVATE_KEY` calls the
permissionless `deactivateIfDepleted` and does need a small amount of gas
money. `TREASURY_PRIVATE_KEY` mints/recaptures native currency on every
vampchain (gas paid in the vampchain's own native currency, never L1 ETH) —
give it to the relayer only, never to `infra/sidechain-node`, so it never
has to be present on a container reachable via the RPC gateway.
`CLIQUE_SIGNER_PRIVATE_KEY` is baked into every vampchain node the
provisioner creates and is deliberately the *same* key reused across every
chain — it only proves block authorship on our own isolated single-node
chains, it doesn't custody funds, so reuse here is fine (unlike the other
three). Don't reuse the contract deployer's key for any of these in
production.

`FLY_API_TOKEN` for the provisioner needs org-level permission to create
apps/machines/volumes — treat it like the relayer key, not a throwaway.

**Update: the `fly` backend has since been run for real** — this whole stack
was deployed to a live Fly org + Base Sepolia and the full create → deposit →
mint → burn → claim loop was verified end to end, including
`infra/provisioner`'s `fly` backend actually creating a real per-chain Fly
app/machine. A number of real issues only showed up at that point, all now
fixed in the code (not just worked around manually) — worth knowing about if
you hit something similar:

- **`fly deploy` + Depot 401s**: this environment's `fly deploy` kept failing
  with `ensure depot builder failed (status 401)` on the remote/managed
  builder. Fix: pass `--depot=false` to force the legacy builder path. Every
  `fly deploy` command in this doc already includes it.
- **Sidechain nodes must bind the IPv6 wildcard, not just IPv4.** Fly's
  private 6PN network is IPv6-only, so a process bound only to
  `0.0.0.0`/IPv4 is invisible to other apps over `.internal` even though it
  works fine locally via a published port. `infra/sidechain-node/entrypoint.sh`
  binds geth's HTTP server to `--http.addr ::` for exactly this reason,
  which also still accepts IPv4 (needed for docker-compose's published
  ports). If you fork this and see "upstream node unreachable" from the
  gateway despite the machine showing `started`, check this first.
- **Public RPC `eth_getLogs` limits**: a fresh indexer cursor started at
  block 1, and a single unbounded `fromBlock..toBlock` query against a live
  chain's full history gets rejected outright by rate-limited/capped public
  RPCs (`query exceeds max block range 2000` on Base's own public RPC).
  Fixed in both `infra/relayer` and `infra/provisioner`: chunked
  `eth_getLogs` (`chunkedGetLogs.ts`, ~1900-block windows) plus a cursor
  that initializes to "now" instead of block 1 on a fresh deployment against
  a live chain.
- **Pick your L1 RPC provider carefully.** Several free public Base Sepolia
  RPCs turned out unusable for this workload: `sepolia.base.org` rate-limits
  aggressively (likely worse from Fly's shared egress IPs), and
  `base-sepolia-rpc.publicnode.com` rejects any `eth_getLogs` query more
  than a shallow window behind the chain tip as an "archive request"
  requiring a paid token. `https://base-sepolia.gateway.tenderly.co` worked
  reliably for this project's traffic with no key. For anything beyond a
  demo, get a real API key (Alchemy/Infura/QuickNode) rather than depending
  on any free public endpoint's goodwill.
- **Confirmations don't make sense for the sidechain side.** The withdrawal
  watcher originally reused the same `CONFIRMATIONS` value as the L1
  watchers. A single-signer Clique vampchain has no reorg risk at all, so
  waiting N confirmations serves no purpose and can add pointless latency on
  a chain that's designed to mine on a fixed period regardless of traffic.
  Fixed: `pollWithdrawals` in `infra/relayer` no longer takes a
  confirmations parameter; it always scans up to the sidechain's current
  tip.
- **Fund the provisioner wallet with gas ETH, not just the deployer.**
  Obvious in hindsight, easy to forget: `deactivateIfDepleted` is a real
  signed transaction the provisioner submits itself, so it needs its own
  small ETH balance — the deployer's balance doesn't cover it. (This used
  to apply to the relayer too, for `VampBridge.release`; the pull-claim
  redesign — see `docs/ARCHITECTURE.md` — removed that requirement
  entirely. `RELAYER_PRIVATE_KEY` only ever signs now, never needs ETH.)
- **`docker push` directly to `registry.fly.io/<app>` failed with `app
  repository not found`** even after `fly auth docker`, for a brand-new
  app's very first image. `fly deploy --build-only --push --local-only
  --depot=false --image-label latest` (from within the image's directory,
  with a throwaway `fly.toml` naming the app) went through a code path that
  worked; the same layers pushed via bare `docker push` afterward did not.
  Stick to `fly deploy` for pushing images, not raw `docker push`. (After
  the app already exists, a plain `docker build && fly auth docker &&
  docker push` does work for subsequent image updates — just not for that
  very first image.)
- **A plain `docker build` on Apple Silicon pushes an arm64-only image —
  Fly's fleet is amd64.** Machine creation failed silently from the
  provisioner's point of view (the Fly app and volume got created fine; only
  the machine-create API call failed) with no obviously-architecture-related
  error surfaced through `fly logs`. Confirmed via `docker manifest inspect
  registry.fly.io/<app>:latest` showing `"architecture": "arm64"` only, no
  `amd64` variant. Fix: build with `docker buildx build --platform
  linux/amd64 ... --push` (not plain `docker build`) whenever pushing an
  image built on an Apple Silicon Mac for Fly to run.
- **`geth account import`'s default (standard) scrypt KDF needs a single
  ~256MB allocation** for key-derivation alone — which by itself exceeds a
  `shared-cpu-1x`/256MB Fly machine's entire memory budget and crashes the
  Go runtime with an OOM panic (`runtime.throw` inside `mheap.alloc`) a few
  seconds after boot, right as `infra/sidechain-node/entrypoint.sh` imports
  the Clique signer key on first run. Reproduced locally with `docker run
  --memory=256m` before shipping the fix. Fixed: pass `--lightkdf` to `geth
  account import` (the resulting keystore file stores its own KDF
  parameters, so no corresponding flag is needed at unlock/startup time).
  The weaker KDF costs nothing security-wise here — the password only
  protects a keystore file at rest on our own volume; the real secret is the
  private key that went in, not the file encryption.

### 4. Vercel: the web app

- New Vercel project, **Root Directory** set to `web/` (Vercel handles the
  pnpm workspace automatically from there).
- Environment variables: `NEXT_PUBLIC_REGISTRY_ADDRESS`,
  `NEXT_PUBLIC_BRIDGE_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS`,
  `NEXT_PUBLIC_USDC_DECIMALS`, `NEXT_PUBLIC_L1_CHAIN_ID`,
  `NEXT_PUBLIC_L1_RPC_URL`, `NEXT_PUBLIC_GATEWAY_URL` (your
  `vampchains-rpc-gateway.fly.dev` URL), `DATABASE_URL` (Neon).
- Deploy.

## Cost notes

Everything above fits comfortably in free/near-free tiers to start: Neon's
free tier, Vercel's hobby tier, and each Fly app (relayer, provisioner,
rpc-gateway, plus one small `shared-cpu-1x`/256MB machine per vampchain) is
cheap — Fly's free allowance covers a handful of these outright, and each
additional one is a couple dollars a month at most. The annual USDC fee
(`VampChainRegistry`'s `defaultAnnualFeeUSDC`, owner-adjustable) should track
real observed cost plus a small margin — see "Economics" in
`docs/ARCHITECTURE.md`.
