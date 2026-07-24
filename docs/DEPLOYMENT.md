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
- **Fly's `iad` region can hit real capacity limits** — seen twice in one
  session as two different errors (`insufficient resources to create new
  machine with existing volume`, then `insufficient CPUs available to
  fulfill request`) on plain retries of the exact same machine spec that
  had worked minutes earlier. Confirmed it wasn't our config by manually
  running `fly machine run` by hand and hitting the identical error.
  Creating a fresh app + volume in `ord` instead worked immediately.
  `vampchains-provisioner`'s `FLY_REGION` secret is set to `ord` for this
  reason — if provisioning starts failing with an "insufficient
  resources"/"insufficient CPUs" error again, it's very likely this, not a
  bug; try a different region before debugging the code.
- **Redeploying `VampChainRegistry` while chains are live under the old one
  auto-tears down every chain the moment the new address is configured** —
  not a separate bug, just a mechanical consequence of how the lifecycle
  worker checks liveness. `detectGraceExpiredChains` reads `isActive` from
  whichever registry address is *currently* configured; the instant that's
  swapped to a fresh (empty) registry, every existing chain's `chainId`
  resolves to Solidity's mapping default (`isActive() == false`) there, and
  the lifecycle worker can't distinguish "doesn't exist on this registry"
  from "grace period genuinely expired" — it proceeds through the full
  automatic teardown (volume snapshot, deactivation, real Fly app
  destruction) either way. Confirmed live: swapping
  `vampchains-provisioner`'s `BASE_REGISTRY_ADDRESS` secret to a
  freshly-deployed registry destroyed the existing demo chain's Fly app
  within one lifecycle tick. Harmless on testnet with nothing of value at
  stake, but budget for it (recreate any chains you care about on the new
  registry right after swapping, don't assume they'll survive).
- **A registry redeploy also breaks the provisioner's own dedup logic,
  independent of the teardown above.** `VampChainRegistry.chainId` is a
  bare counter that restarts from 1 on every redeploy (it's only ever
  unique within one registry deployment), but `chainWatcher.ts`'s check for
  "have I already seen this chain" used to match on `(homeChainId,
  chainId)` alone. A freshly created chain on the new registry with
  `chainId == 1` collided with the *old* registry's already-existing
  `chainId == 1` row, so `pollNewChains` silently treated it as
  already-known and never queued it for provisioning — no error, no log,
  the chain just sat live on-chain with zero off-chain tracking
  indefinitely. Fixed by adding `registryAddress` to the `Chain` model and
  scoping the unique key/dedup lookup to `(homeChainId, registryAddress,
  chainId)` instead. After any future registry redeploy, rewind that
  registry's `registry-chains-<homeChainId>-<registryAddress>` cursor
  (`IndexerCursor` row) to just before any chain-creation transaction sent
  before the fix was live, so `pollNewChains` rescans it under the
  corrected dedup logic rather than skipping it forever (its own cursor
  only rescans blocks once).

### 4. Vercel: the web app

- New Vercel project, **Root Directory** set to `web/` (Vercel handles the
  pnpm workspace automatically from there).
- Environment variables: `NEXT_PUBLIC_REGISTRY_ADDRESS`,
  `NEXT_PUBLIC_BRIDGE_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS`,
  `NEXT_PUBLIC_USDC_DECIMALS`, `NEXT_PUBLIC_L1_CHAIN_ID`,
  `NEXT_PUBLIC_L1_RPC_URL`, `NEXT_PUBLIC_GATEWAY_URL` (your
  `vampchains-rpc-gateway.fly.dev` URL), `DATABASE_URL` (Neon). Add the
  `NEXT_PUBLIC_*` ones as regular (non-sensitive) variables — Vercel's
  "Sensitive" flag doesn't affect build-time availability, but there's no
  reason to use it for values that are, by definition (the `NEXT_PUBLIC_`
  prefix), going to be readable in the public client bundle anyway.
- Deploy.
- **If a page built from client components ("use client") ever shows a
  `NEXT_PUBLIC_*`-derived value as missing/zero while server-rendered pages
  show it fine**, check for a *dynamic* `process.env[name]` lookup
  somewhere in the code path first, before suspecting Vercel config. Next.js
  inlines `NEXT_PUBLIC_` vars into client bundles via static text
  replacement of a literal `process.env.NEXT_PUBLIC_X` expression at build
  time — there's no real env object shipped to the browser. A computed
  lookup can never be statically resolved, so it silently evaluates to
  `undefined` forever, regardless of what's actually configured. This
  shipped to production once already (`web/src/lib/contracts.ts`'s
  `envAddress` helper) — confirmed by literally fetching the deployed JS
  chunks and grepping for the expected address before and after the fix,
  since neither the build log nor a fresh `--force` deploy alone showed
  anything was wrong.

### 5. Fly.io + Vercel: `scan.vampchain.com` (block explorer + contract verification)

```bash
fly apps create vampchains-verifier
fly secrets set -a vampchains-verifier \
  DATABASE_URL=... GATEWAY_URL=https://vampchains-rpc-gateway.fly.dev
fly deploy --config infra/verifier/fly.toml --dockerfile infra/verifier/Dockerfile --depot=false
fly scale count 1 -a vampchains-verifier   # see fly.toml's own comment for why this must stay 1
```

New Vercel project, **Root Directory** set to `scan/`. Environment
variables: `DATABASE_URL` (same Neon DB), `NEXT_PUBLIC_GATEWAY_URL` (same
value as `web/`'s), `NEXT_PUBLIC_VERIFIER_URL` (your
`vampchains-verifier.fly.dev` URL — the browser calls this directly from
the verify-submission form, same reason RPC calls go straight from the
browser to the gateway rather than through this app's own server). Deploy.

Point `scan.vampchain.com`'s DNS at Vercel (an `A` record to `76.76.21.21`,
or delegate the subdomain's nameservers to Vercel) — Vercel's own domain
page shows the exact record it wants. Until that's done the app is still
fully live at its own `*.vercel.app` URL.

Real issues hit deploying this one, worth knowing about:

- **`fly deploy`'s remote builder can fail with `failed to parse daemon
  host "unix:///var/run/docker.sock": missing hostname`, then a local
  `--local-only` build can fail with `docker is unavailable to build the
  deployment image`.** Both come from the same root cause on a Mac running
  Docker Desktop: flyctl looks for a Docker socket at the standard
  `/var/run/docker.sock` path, but Docker Desktop's actual socket lives at
  `~/.docker/run/docker.sock` (confirm with `docker context ls`) and
  nothing symlinks the former to the latter in this setup. Fix: `export
  DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"` before `fly deploy
  --local-only`.
- **If `fly deploy` just hangs at "Waiting for remote builder
  `fly-builder-<name>`..." with no error, check `fly status -a
  fly-builder-<name>`** — Fly's own auto-created remote-builder app can
  itself be `suspended`, and `fly deploy` doesn't surface that; it just
  waits indefinitely trying to wake it. Confirmed this was the actual
  cause of a hang here, not a transient network issue. `--depot=false`
  alone doesn't fix this — it only forces the legacy remote/local builder
  path, and that path still tries to wake the same suspended app.
- **`fly deploy --local-only` and even a raw `docker push` (after `fly
  auth docker`) intermittently failed** with `error from registry: app
  repository not found`, a closed-connection mid-push, or a `502 Bad
  Gateway` from `registry.fly.io` — for an app that already had a working
  image, so this wasn't the documented "brand-new app" case above. These
  looked like transient registry-side flakiness rather than a real
  config problem (retries eventually got further each time, and a final
  `docker push` completed cleanly). **The reliable fallback**: build with
  `docker buildx build --platform linux/amd64 -t
  registry.fly.io/<app>:<tag> --push .` (one shot, no separate
  build-then-push step — plain `docker build` on Apple Silicon produces
  an arm64-only image, the same "Fly's fleet is amd64" issue noted
  earlier in this doc, and `--local-only`'s build path hits it too, not
  just the sidechain-node image), then `fly deploy --config <fly.toml> -a
  <app> --image registry.fly.io/<app>:<tag>` to deploy that already-pushed
  image directly — this sidesteps `fly deploy`'s own build/push
  orchestration (which was the flaky part) entirely.
- **This service needs real `forge build` (Foundry), unlike every other
  service in this repo** — `infra/verifier/Dockerfile` copies the `forge`
  binary from `ghcr.io/foundry-rs/foundry:latest` in a build stage rather
  than running `foundryup` at build time (slower, less deterministic), and
  pre-warms one common solc version into the image's shared cache so the
  common case skips a first-compile fetch from
  binaries.soliditylang.org — any other version is still fetched on
  demand at request time.

- **A Prisma schema migration means redeploying EVERY app that bundles the
  Prisma client — including `scan/`, which is its own separate Vercel
  project.** Each app ships a Prisma client generated against the schema at
  *its* build time, and Prisma emits explicit column lists in its SQL
  (`SELECT "col1", "col2", …`), not `SELECT *`. So the moment a migration
  drops or renames a column, any already-deployed app whose bundled client
  still references the old column starts 500-ing on every query that
  touches that table — even if that app never used the changed column
  directly (a bare `prisma.chain.findUnique` selects *all* Chain columns).
  Hit live: the unified-fee-revenue migration dropped several `Chain`
  columns; `web` and the Fly services were redeployed as part of that work,
  but `scan.vampchain.com` was not, and it went to a hard 500 on its
  landing page (which does `prisma.chain.findMany`) until redeployed. The
  fix is just a redeploy (the build's `postinstall` runs `prisma generate`
  against the current schema). **Checklist after any migration: redeploy
  `web`, `scan` (separate `vampchains-scan` Vercel project — deploy from
  repo root with the root re-linked to it via `vercel link --project
  vampchains-scan`, since its Root Directory is `scan/`), and every Fly
  service that imports `@vampchains/db` (relayer, provisioner, rpc-gateway,
  verifier).**

### Root-caused a stuck relayer, then applied the fix to every `tsx`-based service

`vampchains-relayer` (256MB, shared-cpu-1x — one shared instance for the
whole protocol, not per-chain) got stuck for 15+ minutes: sustained
`eth_blockNumber` timeouts to its L1 RPC provider *and* a Prisma
connection-pool timeout, simultaneously, while the identical calls
succeeded instantly from elsewhere. A plain `fly machine restart` fixed it
immediately, which was the first clue it wasn't an app-logic bug — a
restart doesn't fix broken code, it clears process/OS-level state.

Actually checked `/proc/meminfo` on the machine (freshly restarted): only
**~4.6MB free out of ~212MB usable**. Checking further, every relayer
watcher runs via `tsx src/index.ts` — on-the-fly TypeScript execution,
never a compiled build — and `tsx` spawns **3 extra Node/esbuild
processes** (a parent loader, a child executor, an esbuild transform
worker) purely to do that transformation at runtime, on top of the one
process actually doing the work. Measured: **~138MB of RSS total**, of
which only ~73MB was the real application. Under that little headroom,
generalized memory pressure (GC pauses, kernel reclaim) plausibly degrades
*all* socket I/O uniformly — L1 RPC, Postgres, everything — which matches
exactly what was observed. `gasContributionIntervalMs` had also just been
tightened from 24h to 30s earlier the same session, meaningfully
increasing how often this process does extra work — a plausible trigger
for tipping an already-razor-thin budget over the edge.

**Fix**: compile to a single JS bundle at Docker build time instead of
running via `tsx` at runtime (`dev` still uses `tsx watch` for hot-reload;
only the production image builds) —

```bash
esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 \
  --outfile=dist/index.js --external:@prisma/client --external:bufferutil --external:utf-8-validate
```

then `CMD ["node", "dist/index.js"]` instead of `CMD ["pnpm", "start"]`.
`@prisma/client` (and the two `ws` optional native deps `viem` can pull in)
stay external — Prisma's generated client loads a native query-engine
binary at runtime that bundling would break, and there's no reason to
bundle a package that's already plain, pre-built JS anyway. Everything
else — the relayer's own code, plus the small pure-TS workspace packages
(`@vampchains/db`, `@vampchains/chains`) it imports, which normally have no
build step at all and are consumed as raw `.ts` via `tsx` everywhere else
in this repo — bundles inline cleanly.

**One real gotcha hit doing this**: `@prisma/client` had to be added as an
**explicit, direct** dependency of `infra/relayer/package.json`, even
though the relayer's own code never imports it directly — only
`@vampchains/db` does. Under `tsx`, that import resolved fine because
Node resolves relative to `@vampchains/db`'s *own* location (which
legitimately declares `@prisma/client`). Once `@vampchains/db`'s code is
bundled into `infra/relayer/dist/index.js`, that import resolves relative
to `infra/relayer`'s *own* location instead — and pnpm's strict
`node_modules` layout doesn't allow phantom access to a sibling package's
undeclared transitive dependency. The fix is to declare it, honestly,
where it's actually now used.

**Result on `infra/relayer`, confirmed on real production hardware, not
just a local guess**: memory usage dropped from ~4.6MB free (post-restart)
to **~122MB available** on the exact same 256MB machine — no cost increase
at all. A local Docker test with `docker stats` showed the whole container
using just 52MB out of a 256MB limit. Only one process now (`node
dist/index.js`), confirmed via `/proc`. Zero errors of any kind in the
first 15+ minutes after the redeploy, where the same window had
previously shown repeated timeouts. `infra/relayer/fly.toml`'s machine
size was deliberately left at 256MB, not bumped — the whole point was
confirming this fix alone was sufficient, which it was.

**Same day: applied the identical fix to every other `tsx`-based service**
(`infra/provisioner`, `infra/rpc-gateway`, `infra/verifier`) rather than
waiting for each to hit its own version of this incident — all four
services in `infra/` share the exact same dependency shape (workspace
packages + viem, `@prisma/client` only ever reached transitively through
`@vampchains/db`), so the same `esbuild` bundle command, the same
`@prisma/client`-as-explicit-dependency fix, and the same Dockerfile
change (`RUN pnpm run build` + `CMD ["node", "dist/index.js"]`) applied
cleanly to each with no per-service surprises. Verified each on real
production hardware after deploying: exactly one `node` process on every
one (confirmed via `/proc`, zero stray `tsx`/`esbuild` processes),
`MemAvailable` at 52-73% of each machine's total afterward (was ~2% free
on `infra/relayer` before its fix). `infra/verifier` — the one with real
functional complexity, since it shells out to actual `forge build` at
request time — was verified with a full live `forge verify-contract` run
end to end (submit → poll → "Pass - Verified (full match)") against the
newly-compiled build, confirming the bundling change didn't disturb its
subprocess-based compile path at all. None of the four machines' `fly.toml`
sizes were changed — this was purely a "stop wasting memory on tooling
overhead" fix, not a capacity increase.

## Cost notes

Everything above fits comfortably in free/near-free tiers to start: Neon's
free tier, Vercel's hobby tier (two projects, `web/` and `scan/`, on the
same Neon DB costs nothing extra), and each Fly app (relayer, provisioner,
rpc-gateway, plus one small `shared-cpu-1x`/256MB machine per vampchain) is
cheap — Fly's free allowance covers a handful of these outright, and each
additional one is a couple dollars a month at most. `infra/verifier` is the
one exception worth sizing separately: `shared-cpu-2x`/1GB (compiling,
especially `via_ir`, is meaningfully heavier than everything else here),
single machine, no HA (see its `fly.toml`'s own comment for why) — still
inexpensive at this traffic level, just not "a couple dollars" cheap. The
annual USDC fee
(`VampChainRegistry`'s `defaultAnnualFeeUSDC`, owner-adjustable) should track
real observed cost plus a small margin — see "Economics" in
`docs/ARCHITECTURE.md`.
