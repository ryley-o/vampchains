# sidechain-node

One Docker image, one persistent geth (Clique single-signer
proof-of-authority) instance = one vampchain. Reused unmodified for every
chain; all per-chain config comes from env vars (see `entrypoint.sh`). See
`docs/ARCHITECTURE.md`'s "Why geth Clique PoA" for the full reasoning,
including why this pins to geth `v1.13.15` specifically and why the
compiler side (`contracts/foundry.toml`) pins `evm_version = "london"` to
match.

## Build & run locally

```bash
docker build -t vampchains-sidechain-node .
docker run -d --name my-vampchain -p 8545:8545 \
  -v vampchain-data:/data \
  -e CHAIN_ID=99999 \
  -e CLIQUE_SIGNER_PRIVATE_KEY=0x... \
  vampchains-sidechain-node
```

`CHAIN_ID` and `CLIQUE_SIGNER_PRIVATE_KEY` are required. `TREASURY_ADDRESS`
defaults to the shared address used across every real vampchain (see
`docs/ARCHITECTURE.md`) — override only for a local/throwaway chain where
you want a different funded account, e.g. docker-compose's `l1` service,
which stands in for Base locally and needs a deployer key it actually
controls, not the shared production treasury.

Verified manually (see `docs/DEPLOYMENT.md` / session notes):
- `eth_chainId` reflects `CHAIN_ID`.
- Only `TREASURY_ADDRESS` gets a balance at genesis (a deliberately huge
  one) — nobody else gets free native currency; the only way to get native
  currency onto a real vampchain is through `VampBridge`.
- A real signed transfer from the treasury account (the relayer's mint
  primitive) works, including under Base's live EIP-1559 dynamic base fee.
- State (blocks, state trie, keystore) survives a container restart via the
  `/data` volume, and Clique mining resumes automatically on restart with
  no manual intervention.
- Runs correctly inside a 256MB-memory-limited container (`docker run
  --memory=256m`, matching the `shared-cpu-1x`/256MB Fly machine size) —
  this specifically needed `--lightkdf` on the one-time keystore import step
  (see `docs/DEPLOYMENT.md`'s "real issues" list for why).

## Fly.io

`infra/provisioner/src/provisioners/fly.ts` builds each vampchain's Fly app
+ Machine directly via the Fly Machines API (no toml file involved) and
deploys this same image. The RPC port is **not** exposed publicly — only
reachable over Fly's private network, from `infra/rpc-gateway`'s
rate-limited, method-allowlisted proxy and from the relayer. A Fly volume is
mounted at `/data` for persistence across machine restarts.

**If you build this image on Apple Silicon for a Fly deploy**, use
`docker buildx build --platform linux/amd64 ... --push` — a plain
`docker build` there produces an arm64-only image, and Fly's fleet is
amd64. Machine creation then fails with no obviously-architecture-related
error; see `docs/DEPLOYMENT.md` for how this was diagnosed.
