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
  Credits `lockedBalance[chainId]` with the *actual balance delta received*
  (measured before/after the transfer), not the nominal `amount` requested —
  safe against fee-on-transfer/deflationary tokens that deliver less than
  what was sent, so the bridge can never be tricked into thinking it holds
  more than it actually does. `SafeTransferLib` (not raw `IERC20` calls)
  handles tokens like USDT that don't return a `bool` from
  `transfer`/`transferFrom`/`approve`.
- **Withdrawals are pull-based, not push-based.** `claim(uint256 chainId,
  address to, uint256 amount, bytes32 sidechainTxHash, bytes signature)` is
  permissionless — anyone can call it — but only succeeds with a valid
  EIP-712 signature from `signer` over exactly `(chainId, to, amount,
  sidechainTxHash)`. In practice `to` calls it themselves from their own
  wallet, paying their own gas; funds always land on the `to` address bound
  into the signature regardless of who submits the transaction, so nothing
  is lost by making it callable by anyone. Replay-guarded on
  `sidechainTxHash` via a `claimed` mapping, capped by `lockedBalance[chainId]`.
  This replaced an earlier `release()` design where the relayer pushed the
  transaction itself — see "Bridge withdrawals: pull, not push" below for
  why.
- `onlyOwner` pause switch, solady `ReentrancyGuard` on both entry points.

Both contracts use solady (`Ownable`, `SafeTransferLib`, `ReentrancyGuard`,
`EIP712`, `ECDSA`) pulled in via soldeer, plus `forge-std` for tests.

#### Bridge withdrawals: pull, not push

The first version had the relayer call `release()` directly — a real,
relayer-submitted L1 transaction for every single withdrawal, paid for by
us, forever, scaling with volume. Nobody asked for that cost model; it was
just the simplest thing to build first, and it surfaced as a real problem
the moment this got deployed for real (the relayer's L1 wallet needed
constant gas top-ups to keep withdrawals flowing).

The fix: the relayer no longer submits *any* L1 transaction, for deposits
or withdrawals. It only ever signs. Concretely:
- Deposits mint via `anvil_setBalance` — never a real transaction, free
  either way, unaffected by this change.
- Withdrawals: the relayer watches for a burn on the vampchain, then signs
  an EIP-712 `Claim(uint256 vampChainId, address to, uint256 amount, bytes32
  sidechainTxHash)` message and publishes `{to, amount, sidechainTxHash,
  signature}` (via `infra/rpc-gateway`'s `/claims/:sidechainTxHash`). The
  recipient submits that to `VampBridge.claim()` themselves, from their own
  wallet, paying their own gas.

Net effect: the relayer's private key never needs to hold ETH at all — it's
a pure signing key. The **trust model is unchanged** (whoever holds that key
still unilaterally decides what's claimable; a compromised key is just as
bad as before), but the **cost model** moves from "we pay per withdrawal,
forever" to "we pay nothing, ever, for withdrawals." This is also just the
standard shape of most real L2 withdrawal UX (Arbitrum, Optimism, Hop all
work this way) — burn/initiate, wait briefly, claim — so it wasn't a novel
design, just one we should have started with.

The domain separator binds `verifyingContract` (this specific `VampBridge`
deployment) and `chainId` (the home chain's own EVM chain id, e.g. Base
Sepolia's `84532`) — a signature minted for one bridge deployment or one
network cannot be replayed against another. Every field of the signed
message — `vampChainId`, `to`, `amount`, `sidechainTxHash` — is covered, so
tampering with any single field on the way to `claim()` invalidates the
signature rather than silently doing the wrong thing. All of this is
exercised directly in `contracts/test/VampBridge.t.sol` (wrong signer,
every field tampered independently, cross-contract replay, cross-chain
replay, replay via `claimed`).

### `infra/sidechain-node/`

Dockerfile wrapping `anvil --chain-id <id> --state /data/state.json
--block-time <n> --host ::`. Bound to the IPv6 wildcard, not `0.0.0.0` —
Fly's private network is IPv6-only, and a process bound only to the IPv4
wildcard is unreachable from other apps over `.internal` even though it
works fine locally (this bit us during the first real deployment; see
`docs/DEPLOYMENT.md`). State volume persists balances/contracts across
restarts. One Fly app (and machine) per vampchain.

### `infra/relayer/`

Node/TS service, single shared process for *all* vampchains (not one per
chain — keeps cost down), and — as of the pull-claim redesign above — one
with no L1 gas dependency at all. Loads active chains from Postgres, for
each chain:
- watches `VampBridge` `Deposited` events filtered to that `chainId` on the
  home chain → calls `anvil_setBalance` on the vampchain RPC to credit
  `recipient`, scaled to 18 decimals regardless of the base token's own
  `decimals()` (native currency on any EVM chain is always assumed
  18-decimal by wallets/tooling; USDC/USDT-style 6-decimal tokens would
  otherwise mint a balance that displays as roughly zero).
- watches the vampchain RPC for transfers to the burn address
  (`0x000...dEaD`) → signs an EIP-712 claim (scaled back down to the base
  token's own decimals) for the recipient to submit to `VampBridge.claim()`.

Deliberately simple/polling-based for v1 (no reorg handling beyond a
confirmation-depth delay on the L1 side; deliberately *no* confirmation
delay on the sidechain side, since a single-node anvil chain has no reorg
risk and waiting for confirmations that only accrue on new activity can
stall forever on a quiet chain) — documented as a known gap, not silently
ignored.

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

`GET /claims/:sidechainTxHash` serves the signed withdrawal claim once the
relayer has produced one for that burn tx (`{status: "pending"}` until
then, `{status: "ready", chainId, to, amount, sidechainTxHash, signature}`
after) — the read side of the pull-claim design above. Rate-limited the
same way as the RPC path.

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

- Bridge trust model is a single signer key, not verified. Documented, not
  hidden — see "Bridge withdrawals: pull, not push" above. That redesign
  removed the relayer's ongoing L1 gas cost, but did **not** change who you
  have to trust: whoever holds the signer key still unilaterally decides
  what's claimable.
- Only the chain's designated base token can bridge in/out. Bridging
  arbitrary other ERC20s onto a vampchain is future work (mentioned in the
  original brief as a "maybe eventually").
- Fee-on-transfer/deflationary tokens are handled correctly on deposit
  (balance-delta accounting). **Rebasing tokens are not** — a token whose
  balance changes without a transfer (e.g. stETH-style) would drift out of
  sync with `lockedBalance` over time with no transfer event to trigger a
  resync. Don't create a vampchain backed by a rebasing token.
- Withdrawal amounts that aren't an exact multiple of the base token's
  `10^(18-decimals)` native-unit scale lose the remainder as unclaimable
  dust (rounds down). Negligible for anything with reasonable decimals, but
  real.
- The on-chain `Claimed` event isn't indexed back into Postgres yet
  (`WithdrawalEvent.claimTxHash`/`claimedAt` stay empty) — `VampBridge.claimed(sidechainTxHash)`
  on chain is the real source of truth for whether a claim happened.
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
