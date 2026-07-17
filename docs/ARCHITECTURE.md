# Architecture

## Concept

1. Anyone picks an existing ERC20 token on our home chain (default: **Base**,
   configurable — the contracts are chain-agnostic).
2. They call `VampChainRegistry.createChain(token, name, symbol)` and pay an
   annual fee in USDC (default $1,000/yr, owner-adjustable to track real
   infra cost — see "Economics" below).
3. That pays for us to run a **vampchain**: a single-node EVM sidechain whose
   native gas currency is that ERC20 token. One geth node (Clique
   proof-of-authority) in Docker, one rate-limited RPC endpoint, one tiny
   built-in block explorer, all served from Fly.io.
4. To get the base currency onto the vampchain, you deposit the ERC20 into
   `VampBridge` on the home chain. Our relayer sees the deposit and mints you
   the equivalent native balance on the vampchain via a real signed transfer
   from a shared treasury account. To go back, you send native currency to
   that same treasury address on the vampchain (recapture, not destroy — see
   "Why geth Clique PoA" below); the relayer sees that and signs a claim you
   submit yourself to get the ERC20 back on the home chain.
5. Funding is public and permissionless top-up (`VampChainRegistry.topUp`).
   Anyone can watch a chain's remaining runway on-chain and prevent it being
   torn down by topping it up. We (the protocol) can only withdraw fee
   *already earned* by elapsed time, never the unearned/future portion — so
   the worst thing we can do is take money for time already served.

## Why geth Clique PoA, not a "real" L2 stack

We explicitly do not run op-geth/reth/Polygon-Edge style rollup stacks —
no state posting, no sequencer, no L1 data-availability cost, which
doesn't make sense for a meme chain. Instead, each vampchain is
**geth in Clique (single-signer proof-of-authority) mode**: a real embedded
database (LevelDB via geth's own storage layer), still lightweight to run —
one small Docker container, no p2p peers beyond the single signer
(`--nodiscover --maxpeers 0`).

Two mechanisms make this work as a real execution client rather than a dev
sandbox:

- **Minting**: deposits mint via a real signed transaction — `value`-only,
  no calldata — from a shared **treasury** account that's pre-funded with a
  large balance at each vampchain's genesis. Real transaction, real gas,
  but the gas is paid in the vampchain's own native currency, which we
  already control, so it costs us nothing external.
- **Withdrawals ("burn-and-claim") recapture instead of destroy**: the
  withdrawal-signal address is the **treasury account itself**, not the
  conventional dead address (`0x000...dEaD`). A user "burns" by sending
  native currency to the treasury; the relayer watches for that and signs a
  claim. Nothing is actually destroyed — it goes back into the same pool
  deposits are minted from. Given each vampchain is over-provisioned by
  design at genesis (a deliberately huge balance nobody could plausibly
  drain), the small accounting benefit of recapture isn't the point; the
  point is that EIP-1559's *base fee* is still burned unconditionally by
  the protocol itself (that part can't be redirected, on any EVM chain) —
  so gas is not literally free, it's a documented, accepted cost against a
  treasury sized to absorb it indefinitely. Priority fees (tips), by
  contrast, go to whoever mines the block — see `--miner.etherbase` below.

### Version pinning and its reasons (read before touching this)

Getting a *legacy, single-signer, auto-mining* Clique network working on a
recent geth turned out to have two separate traps, both confirmed by direct
testing, not just reading changelogs:

1. **geth v1.16.3+ removes `--unlock`/`--allow-insecure-unlock`.** Account
   management moved to requiring an external Clef signer process for
   security. That's real added operational complexity (a second process,
   rule-based auto-approval config) not worth it for a low-stakes automated
   meme-chain signer, so this project pins to an older line that still
   supports the simple in-process unlock flow.
2. **Any geth version that still has `--unlock`/`--mine` also requires the
   chain to already be genesis-configured as fully post-London with no
   `terminalTotalDifficulty` set (v1.16.0 fails outright without it — the
   error message itself says "Please transition legacy networks using Geth
   v1.13.x").** That's why this pins specifically to **v1.13.15**.
3. **A pure legacy `--mine`-based Clique chain (no `terminalTotalDifficulty`
   set) can never activate Shanghai or later.** Any *timestamp-based* fork
   (Shanghai onward — needed for the `PUSH0` opcode Solidity now emits by
   default) only turns on once geth considers the chain "post-merge," and
   setting `terminalTotalDifficulty` to mark it as such flips block
   production over to requiring Engine-API calls from an external
   consensus client — the legacy auto-sealing loop stops firing entirely
   (confirmed directly: block production froze at block 0 the moment TTD
   was set). So the chain's genesis intentionally stops at London, and
   `contracts/foundry.toml` pins `evm_version = "london"` to match —
   Solidity compiled for an older EVM target still runs fine on any newer
   chain (Base included), so this costs nothing on the L1 side.

`--miner.etherbase` (where block rewards/tips go) must be an account geth
holds the key for locally — it can't be set to an arbitrary external
address. So it's set to the Clique signer's own address, not the treasury;
this is a deliberate side benefit, not a workaround, because it means the
treasury private key never has to be present on a sidechain-node container
at all — it's only ever known to the relayer, which signs mint transfers
off-node. Fee revenue this way is small and simply accrues to the (already
shared, single) signer address across every vampchain.

Swapping the node implementation again later (e.g. to a real rollup) is an
infra-layer change that shouldn't need to touch the registry/bridge
contracts or the web app much, since they only depend on "a chain with a
JSON-RPC endpoint."

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
or withdrawals. It only ever signs (or, for deposits, submits a
sidechain-only transaction — see "Why geth Clique PoA" below for why that's
not an L1 cost). Concretely:
- Deposits mint via a real signed transfer from a treasury account, but
  *on the vampchain*, never on the home chain — so this redesign doesn't
  change that side at all.
- Withdrawals: the relayer watches for a burn (transfer to the treasury
  address) on the vampchain, then signs
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

#### General ERC20 bridging

`deposit`/`claim` are exclusively for a chain's own designated base token,
which gets special treatment: it becomes the vampchain's *native gas
currency*. Every other ERC20 goes through `depositToken`/`claimToken`
instead — same pull-based EIP-712 pattern, same trust model, keyed by
`(chainId, token)` instead of only `chainId`, with its own typehash
(`CLAIM_TOKEN_TYPEHASH`) so a claim signature can never be replayed across
the two paths (`lockedBalance` and `lockedBalanceGeneral` are also separate
mappings — a chain's base token can never be deposited through
`depositToken`, enforced by `TokenIsBaseToken`).

Instead of native currency, a general deposit mints a **wrapped ERC20** on
the vampchain — `VampWrappedToken`, deployed by `VampWrappedTokenFactory`.
Both are baked directly into every vampchain's genesis `alloc`, at fixed
addresses, exactly like the treasury account:

- **Why genesis, not a deploy transaction**: a transaction-deployed CREATE2
  factory would leave a window between "chain exists" and "factory
  deployed" where anyone who knew the deployer address and nonce in advance
  could front-run deployment and squat a token's canonical address with
  malicious bytecode. Baking it into genesis means it exists at block 0 —
  no deployment transaction, so no front-running window, ever.
- **Why the address only depends on the L1 token**: the factory deploys
  EIP-1167 minimal proxy clones (via solady's `LibClone`) of a single
  genesis-baked `VampWrappedToken` implementation. A clone's address is a
  function of `salt` (`keccak256(l1Token)`) and the fixed
  factory+implementation pair — never of token metadata (name/symbol/
  decimals). That matters mechanically, not just for tidiness: metadata
  can't be fetched on-chain here at all, since the factory runs on an
  isolated vampchain with no visibility into L1 state to call the real
  `l1Token` contract. The relayer (which does have L1 visibility) supplies
  metadata when deploying. Because the address never depends on that
  caller-supplied value, `wrappedAddressOf(l1Token)` is a pure, publishable
  view — and because every vampchain's genesis bakes in the identical
  factory+implementation bytecode at the identical addresses, a given L1
  token's wrapped address is the same across every vampchain, for free.
- **Why `deploy`/`mintWrapped` are TREASURY-gated despite the address being
  safe either way**: this is the "permissioned deploy + deterministic
  bytecode" mitigation. The bytecode (and therefore the address) is fixed
  and squat-proof regardless of caller. But the *content* written into that
  address — the name/symbol/decimals a relayer-supplied caller asserts —
  isn't independently verifiable on-chain, so a malicious caller could
  otherwise deploy correct-address-but-wrong-metadata tokens (e.g. claiming
  a scam token is "Wrapped USDC"). Gating to TREASURY closes that; `deploy`
  is also idempotent and ignores metadata on repeat calls, so a compromised
  or buggy relayer call can't quietly rebrand an already-deployed token
  either (see `contracts/test/VampWrappedTokenFactory.t.sol`'s
  `test_deploy_ignoresMetadataOnRepeatCalls`).
- **Minting** mirrors the native path: a real signed `mintWrapped` call from
  the treasury account, gas paid in the vampchain's own native currency.
- **Withdrawal** mirrors it too, deliberately: no `burn` function exists on
  `VampWrappedToken` at all. Withdrawing is a plain `transfer` to the
  treasury address — the exact same signal shape as native-currency
  recapture — so the relayer watches both with one mental model ("transfer
  to treasury") instead of two different mechanisms.
- **Decimals are preserved, not normalized.** Unlike native currency (always
  treated as 18-decimal, since that's what wallets assume for any EVM
  chain's native asset), a wrapped ERC20 keeps the real L1 token's own
  `decimals()` — there's no wallet-level assumption to work around, and
  preserving it means no scaling math (and no rounding-dust edge case) on
  either side of this particular bridge path.

### `infra/sidechain-node/`

Dockerfile wrapping geth (pinned `v1.13.15`, see "Why geth Clique PoA"
above) in Clique single-signer mode: `--mine --miner.etherbase <signer>
--unlock <signer> --http --http.addr :: ...`. Bound to the IPv6 wildcard,
not `0.0.0.0` — Fly's private network is IPv6-only, and a process bound
only to the IPv4 wildcard is unreachable from other apps over `.internal`
even though it works fine locally (this bit us during the first real
deployment; see `docs/DEPLOYMENT.md`). `entrypoint.sh` idempotently imports
the Clique signer key into geth's keystore and runs `geth init` against a
templated genesis (`genesis.template.json`, substituting chain id, signer
address, and a large treasury pre-fund) on first boot only. State volume
persists the full chain (blocks, state, keystore) across restarts. One Fly
app (and machine) per vampchain.

### `infra/relayer/`

Node/TS service, single shared process for *all* vampchains (not one per
chain — keeps cost down), and — as of the pull-claim redesign above — one
with no L1 gas dependency at all. Loads active chains from Postgres, for
each chain:
- watches `VampBridge` `Deposited` events filtered to that `chainId` on the
  home chain → sends a real signed transfer, from the shared treasury
  account, on the vampchain RPC to credit `recipient`, scaled to 18
  decimals regardless of the base token's own `decimals()` (native currency
  on any EVM chain is always assumed 18-decimal by wallets/tooling;
  USDC/USDT-style 6-decimal tokens would otherwise mint a balance that
  displays as roughly zero).
- watches the vampchain RPC for transfers to the treasury address (the
  withdrawal-signal/"burn" address — see "Why geth Clique PoA" above for
  why it's the treasury, not a dead address) → signs an EIP-712 claim
  (scaled back down to the base token's own decimals) for the recipient to
  submit to `VampBridge.claim()`.

Deliberately simple/polling-based for v1 (no reorg handling beyond a
confirmation-depth delay on the L1 side; deliberately *no* confirmation
delay on the sidechain side, since a single-node Clique chain has no reorg
risk and waiting for confirmations that only accrue on new activity can
stall forever on a quiet chain) — documented as a known gap, not silently
ignored.

**Must run somewhere on Fly's private network** (deployed as its own small
Fly app, in the same Fly org as the vampchain nodes) because it needs to
reach each vampchain's `.internal` address directly, both to send treasury
mint transfers and to watch for burns. It cannot run on Vercel. Its
`TREASURY_PRIVATE_KEY` is a separate secret from `RELAYER_PRIVATE_KEY` (the
EIP-712 claim-signing key) — see "Why geth Clique PoA" above for why the
treasury key specifically must never be given to a sidechain-node
container.

### `infra/rpc-gateway/`

The system's only *public* entrypoint into a vampchain's RPC, and a load-
bearing security boundary, not just a convenience proxy. Two facts drove
this being its own always-on Fly service rather than a Vercel API route:

1. **Vercel can't reach `.internal` addresses.** Vampchain nodes intentionally
   have no public port (see `infra/provisioner/src/provisioners/fly.ts`,
   which builds each vampchain's Machine config directly via the Fly
   Machines API — no `[[services.ports]]` public handler) —
   only reachable over Fly's private 6PN network. Something on that network
   has to be the bridge to the public internet.
2. **The public RPC surface must never include geth's admin/account
   namespace.** The Clique signer's unlocked account is how deposits get
   minted — if a vampchain's raw RPC were reachable by end users, anyone
   with access to `personal_*`/`miner_*`-style methods could mint unlimited
   native currency, completely bypassing `VampBridge`. The gateway is an
   **allowlist**, not a denylist (`infra/rpc-gateway/src/allowlist.ts`) — it
   accepts only a fixed, explicit set of read/submit `eth_*`/`net_*`/`web3_*`
   methods, so nothing admin-shaped can reach it regardless of what the
   underlying client exposes.

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
- General ERC20 bridging (any token besides a chain's own base token) mints
  a wrapped ERC20 on the vampchain rather than native currency — see
  "General ERC20 bridging" below. Fee-on-transfer/deflationary-token
  handling and the fee-on-transfer caveat below apply to it the same way.
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
- Single-signer Clique PoA: no real multi-node consensus, no fault
  tolerance if the one signer node goes down (matches the single-node
  premise deliberately, but worth being explicit about).
- The rpc-gateway's per-IP rate limiting is in-process memory; fine at one
  or two instances, would need a shared store (e.g. Redis) if it's ever
  scaled horizontally.
- Deployed and verified end to end on **Base Sepolia (testnet)** — real
  chain creation, provisioning, deposit/mint, and burn/claim all confirmed
  working against live Fly + Vercel + Neon infra. Still no mainnet
  deployment and no external audit; see `docs/DEPLOYMENT.md`'s "Update: the
  `fly` backend has since been run for real" note for what that real
  deployment actually shook out (and fixed).
