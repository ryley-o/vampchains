# sidechain-node

One Docker image, one persistent `anvil` instance = one vampchain. Reused
unmodified for every chain; all per-chain config comes from env vars (see
`entrypoint.sh`).

## Build & run locally

```bash
docker build -t vampchains-sidechain-node .
docker run -d --name my-vampchain -p 8545:8545 \
  -v vampchain-data:/data \
  -e CHAIN_ID=99999 \
  vampchains-sidechain-node
```

Verified manually (see docs/ARCHITECTURE.md / session notes):
- `eth_chainId` reflects `CHAIN_ID`.
- The well-known Foundry dev accounts start at **zero balance** by default
  (`--balance 0`) — nobody gets free native currency by importing the public
  anvil mnemonic; the only way to get native currency is through
  `VampBridge`. Set `DEV_ACCOUNT_BALANCE_ETH` to override this — only ever
  done for docker-compose's `l1` service, which stands in for Base locally
  and needs normally-funded test accounts, never for a real vampchain.
- `anvil_setBalance` (the relayer's mint primitive) works.
- State survives a container restart via `--state /data/state.json` with a
  periodic dump (`STATE_INTERVAL`), so an ungraceful kill loses at most one
  interval's worth of blocks — not the whole chain.

## Fly.io

`fly.toml.template` is filled in by `infra/provisioner` per chain and
deployed as its own Fly app. The RPC port is **not** exposed publicly — only
reachable over Fly's private network from the web app's rate-limited proxy.
A Fly volume is mounted at `/data` for persistence across machine restarts.
