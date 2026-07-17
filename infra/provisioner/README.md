# provisioner

Reconciler loop, one shared process:

1. **Discover** — scans `VampChainRegistry.ChainCreated` events, queues each
   new chain as `PENDING_PROVISION` in Postgres (reads the base token's
   `name()`/`symbol()`/`decimals()` at the same time).
2. **Provision** — for every `PENDING_PROVISION` row, spins up infra via the
   configured backend and flips the row to `ACTIVE` with its `rpcUrl`.
3. **Detect depletion** — for every `ACTIVE` row, checks the registry's
   `isActive(chainId)`. Once false, calls the permissionless
   `deactivateIfDepleted` on-chain and moves the row to `DEACTIVATING`.
4. **Tear down** — for every `DEACTIVATING` row (including ones left over
   from a previous crashed run), destroys the infra and marks it
   `DEACTIVATED` — terminal, matching "once funding hits zero, gone for
   good."

## Backends

- `local-docker` (`PROVISION_BACKEND=local-docker`, default) — shells out to
  the `docker` CLI directly. **Exercised live in this session**: provisioned
  a container from `vampchains-sidechain-node`, waited for its healthcheck,
  and tore it down again.
- `fly` (`PROVISION_BACKEND=fly`) — talks to the Fly Machines REST API
  (`api.machines.dev/v1`). Written against Fly's documented API shape but
  **not exercised against a real Fly org** (no credentials available in this
  session) — smoke-test it with a real `FLY_API_TOKEN`/`FLY_ORG_SLUG` before
  relying on it.

## Run locally

```bash
cp .env.example .env
pnpm install
pnpm dev
```
