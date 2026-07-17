# vampchains

Pick any existing ERC20 token. Pay an annual USDC fee. We spin up a single-node
EVM sidechain ("vampchain") that uses your token as its native gas currency.
Deposit the token into our bridge contract, we mint you the equivalent native
balance on the vampchain, and you're off — a whole little blockchain for your
token to play in.

We're a meme-network provider: single node per chain, single rate-limited RPC,
tiny built-in explorer, run cheaply on Fly.io. The bridge is centralized (it's
just us) — that's a documented, deliberate MVP tradeoff, not an oversight. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and its
known limitations.

## Layout

```
contracts/   Foundry project: VampChainRegistry + VampBridge (soldeer + solady), 67 tests
web/         Next.js app: browse/create chains, bridge UI, minimal explorer
infra/
  sidechain-node/  Dockerized anvil node = one vampchain
  relayer/         watches L1 deposits -> mints on vampchain; watches burns -> releases on L1
  rpc-gateway/     the only public entrypoint into a vampchain's RPC (method-filtered, rate-limited)
  provisioner/     turns registry events into running containers/Fly machines, reaps unfunded chains
packages/db/ Prisma schema + client shared by web/relayer/provisioner
docs/        architecture, deployment
scripts/     dev-up.sh / dev-down.sh (local stack), sync-abis.sh
```

## Local development

```bash
pnpm install
./scripts/dev-up.sh      # postgres + local "home chain" + deploys contracts +
                          # gateway + relayer + provisioner, all via docker compose
pnpm --filter @vampchains/web dev   # separately, once dev-up.sh prints the web/.env.local block
```

`dev-up.sh` prints the exact `web/.env.local` to use and the deployed
contract addresses. Tear down with `./scripts/dev-down.sh` (also removes any
per-vampchain containers the provisioner created).

This full loop — create a chain, watch the provisioner spin up a real
container for it, bridge a token in and see the relayer mint it, burn it on
the vampchain and see the relayer release it back on L1, all through the
public rpc-gateway — was run end-to-end against the dockerized stack while
building this; see `docs/ARCHITECTURE.md` and each component's README for
what was specifically verified.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for taking this to real infra
(Neon, Vercel, Fly.io).

## Status

Early, unaudited, no live/mainnet deployments. Contracts have a full Foundry
test suite (`cd contracts && forge test`, 67 tests, 100% line coverage on
`VampBridge`) but have not been externally audited — do not point real funds
at this on mainnet without an audit.
