# Architecture

## Concept

1. Anyone picks an existing ERC20 token on our home chain (default: **Base**,
   configurable — the contracts are chain-agnostic).
2. They call `VampChainRegistry.createChain(token, name, symbol)` and pay an
   annual fee in USDC (default $1,000/yr, owner-adjustable to track real
   infra cost — see "Economics" below).
3. That pays for us to run a **vampchain**: a single-node EVM sidechain whose
   native gas currency is that ERC20 token. One anvil node in Docker, one
   rate-limited RPC endpoint, one tiny built-in block explorer, all served
   from Fly.io.
4. To get the base currency onto the vampchain, you deposit the ERC20 into
   `VampBridge` on the home chain. Our relayer sees the deposit and mints you
   the equivalent native balance on the vampchain. To go back, you send native
   currency to a well-known burn address on the vampchain; the relayer sees
   that and releases the ERC20 back to you on the home chain.
5. Funding is public and permissionless top-up (`VampChainRegistry.topUp`).
   Anyone can watch a chain's remaining runway on-chain and prevent it being
   torn down by topping it up. We (the protocol) can only withdraw fee
   *already earned* by elapsed time, never the unearned/future portion — so
   the worst thing we can do is take money for time already served.

## Why anvil, not a "real" L2 stack

We explicitly do not run op-geth/reth/Polygon-Edge style rollup stacks for
v1. `anvil` (part of Foundry) run persistently with `--state <file>` is:

- a full EVM, JSON-RPC compatible, good enough for a meme chain
- trivial to run in a single Docker container
- has `anvil_setBalance`, which we (ab)use as the mint primitive for the
  bridge instead of building a custom precompile/genesis-alloc mechanism

The tradeoff: anvil is a dev tool, not hardened production infra. It has no
p2p, no real finality, and if we run more than one node they are not
consensus-connected — "two nodes" would just be two independent instances
behind a load balancer, which is *not* what the original single-node meme
chain premise wants anyway. This is a deliberate, documented MVP shortcut.
Swapping the node implementation later (e.g. to a minimal PoA geth chain with
custom genesis alloc, or a real rollup) is an infra-layer change that
shouldn't need to touch the registry/bridge contracts or the web app much,
since they only depend on "a chain with a JSON-RPC endpoint."

## Components

### `contracts/` — VampChainRegistry + VampBridge (Foundry, soldeer, solady)

**`VampChainRegistry.sol`**
- `createChain(address baseToken, string name, string symbol)` — pulls the
  first year's USDC fee, assigns a `chainId`, stores the chain record.
- `topUp(uint256 chainId, uint256 amount)` — permissionless funding top-up.
- Fee accrual is **linear over time**, not a step function: `earned(t) =
  min(fundingBalance, annualFeeUSDC * elapsed / 365 days)`. Protocol can
  `withdrawEarned(chainId)` at any time but only ever gets what's already
  accrued.
- `remainingRuntime(chainId)` / `isActive(chainId)` are pure views computed
  from balance + accrual rate — no keeper transaction needed to know whether
  a chain is (about to be) out of runway.
- `deactivateIfDepleted(chainId)` is permissionless and flips the on-chain
  `active` flag + emits `ChainDeactivated` once funding has actually run out.
  The provisioner calls this (or reacts to the event) to know when to tear
  down the Fly machine. Once deactivated a chain never comes back — a fresh
  `createChain` call (new chainId) is required, matching "if the balance
  goes to zero, that chain is gone."
- One active chain per base token at a time (prevents confusing duplicate
  chains for the same meme token).

**`VampBridge.sol`**
- `deposit(uint256 chainId, uint256 amount, address recipient)` — locks the
  chain's base token, requires the chain to be active, emits `Deposited`.
  Tracks `lockedBalance[chainId]` as an accounting ceiling for releases.
- `release(uint256 chainId, address to, uint256 amount, bytes32 sidechainTxHash)`
  — `onlyRelayer`, replay-guarded on `sidechainTxHash`, capped by
  `lockedBalance[chainId]`. This is the honest trust model: **the bridge's
  security is "trust us," full stop** — we're a single relayer key, not a
  light-client or multisig-verified bridge. That's fine for a meme project
  with token-native (not real-money) stakes, but it must never be
  soft-pedaled to users. The relayer key should live in a KMS/secrets
  manager, not a plaintext env var, once this is more than a toy.
- `onlyOwner` pause switch, solady `ReentrancyGuard` on both entry points.

Both contracts use solady (`Ownable`, `SafeTransferLib`, `ReentrancyGuard`)
pulled in via soldeer, plus `forge-std` for tests.

### `infra/sidechain-node/`

Dockerfile wrapping `anvil --chain-id <id> --state /data/state.json
--block-time <n> --host 0.0.0.0`. State volume persists balances/contracts
across restarts. One Fly app (or Fly machine) per vampchain.

### `infra/relayer/`

Node/TS service, single shared process for *all* vampchains (not one per
chain — keeps cost down). Loads active chains from Postgres, for each chain:
- watches `VampBridge` `Deposited` events filtered to that `chainId` on the
  home chain → calls `anvil_setBalance` on the vampchain RPC to credit
  `recipient`.
- watches the vampchain RPC for transfers to the burn address
  (`0x000...dEaD`) → calls `VampBridge.release` on the home chain.

Deliberately simple/polling-based for v1 (no reorg handling beyond a
confirmation-depth delay) — documented as a known gap, not silently ignored.

**Must run somewhere on Fly's private network** (deployed as its own small
Fly app, in the same Fly org as the vampchain nodes) because it needs
unrestricted RPC access — including `anvil_setBalance` — to each vampchain's
`.internal` address. It cannot run on Vercel.

### `infra/rpc-gateway/`

The system's only *public* entrypoint into a vampchain's RPC, and a load-
bearing security boundary, not just a convenience proxy. Two facts drove
this being its own always-on Fly service rather than a Vercel API route:

1. **Vercel can't reach `.internal` addresses.** Vampchain nodes intentionally
   have no public port (see `infra/sidechain-node`'s `fly.toml.template`) —
   only reachable over Fly's private 6PN network. Something on that network
   has to be the bridge to the public internet.
2. **The public RPC surface must never include anvil's admin namespace.**
   `anvil_setBalance` is the relayer's mint primitive — if a vampchain's raw
   RPC were reachable by end users, anyone could call it themselves and mint
   unlimited native currency, completely bypassing `VampBridge`. The gateway
   strictly allowlists safe `eth_*`/`net_*`/`web3_*` methods and rejects
   `anvil_*`/`evm_*`/`debug_*` outright.

`GET/POST /rpc/:chainId` looks up `Chain.rpcUrl`/`status` from Postgres,
rejects if not `ACTIVE` or the method isn't allowlisted, rate-limits per IP
(in-process — valid here specifically because this is a small number of
persistent instances, not serverless, so there's no cross-instance state
problem to solve), and forwards the request. The web app's chain pages and
any wallet/dApp use this gateway's public URL directly as "the" RPC endpoint
for a vampchain — no separate proxy layer needed in Next.js.

### `infra/provisioner/`

Reconciler loop: watches `VampChainRegistry` for new `ChainCreated` events →
provisions a Fly machine from the sidechain-node image + writes a `Chain` row
to Postgres with its RPC URL. Also polls `remainingRuntime`/`isActive` for
existing chains → destroys the Fly machine and marks the chain inactive once
depleted. Has a `LOCAL` mode that drives `docker compose` instead of the Fly
API, so the whole system runs end-to-end on a laptop with no Fly account.

### `web/` — Next.js

- Landing page: list of vampchains (from Postgres, kept in sync by the
  provisioner/indexer), each showing live public funding balance/runway.
- Create-chain flow: pick a token (address → fetch name/symbol/decimals via
  viem), pay the annual fee (USDC approve + `createChain`).
- Chain detail page: funding balance/runway, top-up button, bridge
  (deposit/withdraw) UI, minimal explorer (latest blocks/txs/an address
  lookup) — all read directly from the vampchain's own RPC via viem, no
  separate explorer service needed at this scale.
- Talks to each vampchain via `infra/rpc-gateway`'s public URL, not directly
  — see that section above for why.
- Wallet connect via wagmi + viem + ConnectKit.
- Disclaimer/terms page + a required acknowledgement checkbox on chain
  creation (crypto project, keep the guardrails visible even at MVP scale).

### Data: Neon Postgres + Prisma

Off-chain index of on-chain state for fast reads (`Chain`, `DepositEvent`,
`WithdrawalEvent`, `FundingEvent`). Source of truth is always the contracts;
Postgres is a cache/index the provisioner and a lightweight indexer keep in
sync, never authoritative.

Provisioning shortcut worth knowing: `vercel install neon` (run from the web
app's linked project) provisions a real Neon Postgres database *through the
Vercel account itself* — no separate Neon signup, and `DATABASE_URL` lands
in the project's env vars automatically. That's the fastest path to a
production database for this project specifically; a standalone Neon
project works identically if you'd rather manage it outside Vercel.

## Economics / cost model

Each vampchain is one small Fly machine (shared-cpu-1x, ~256MB, likely
Fly's free allowance or a couple dollars/month) plus a slice of shared
relayer/provisioner/DB compute. The annual USDC fee is set with real
infra cost + a small protocol margin in mind, is owner-adjustable, and is
drawn down linearly so nobody can be charged for service not yet rendered.

## Known limitations (v1, by design — revisit before this holds real value)

- Bridge trust model is a single relayer key, not verified. Documented, not
  hidden.
- Only the chain's designated base token can bridge in/out. Bridging
  arbitrary other ERC20s onto a vampchain is future work (mentioned in the
  original brief as a "maybe eventually").
- anvil-based nodes: no p2p, no real multi-node consensus, dev-grade EVM
  implementation.
- The rpc-gateway's per-IP rate limiting is in-process memory; fine at one
  or two instances, would need a shared store (e.g. Redis) if it's ever
  scaled horizontally.
- Deployed and verified end to end on **Base Sepolia (testnet)** — real
  chain creation, provisioning, deposit/mint, and burn/release all confirmed
  working against live Fly + Vercel + Neon infra. Still no mainnet
  deployment and no external audit; see `docs/DEPLOYMENT.md`'s "Update: the
  `fly` backend has since been run for real" note for what that first real
  deployment actually shook out (and fixed).
