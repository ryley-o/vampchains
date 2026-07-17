#!/bin/sh
# Brings up the full local stack: Postgres + a local geth-based "home chain"
# standing in for Base, deploys fresh contracts to it, wires the resulting
# addresses into docker-compose via a generated .env file, migrates the
# database, then starts the gateway/relayer/provisioner containers. Prints
# instructions for running the web app afterward (kept on the host for
# normal Next.js dev ergonomics — hot reload, etc).
set -eu
cd "$(dirname "$0")/.."

echo "==> starting postgres + l1..."
docker compose up -d --build postgres l1

echo "==> waiting for postgres..."
until docker compose exec -T postgres pg_isready -U vampchains >/dev/null 2>&1; do sleep 1; done

echo "==> waiting for l1 rpc..."
until curl -sf -X POST http://localhost:8545 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; do sleep 1; done

echo "==> deploying contracts to l1..."
(cd contracts && forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast -vv)

BROADCAST_FILE="contracts/broadcast/DeployLocal.s.sol/31337/run-latest.json"
addr_for() {
  python3 -c "
import json
txs = json.load(open('$BROADCAST_FILE'))['transactions']
matches = [t['contractAddress'] for t in txs if t['transactionType'] == 'CREATE' and t['contractName'] == '$1']
print(matches[0])
"
}
USDC_ADDRESS=$(addr_for MockERC20)
REGISTRY_ADDRESS=$(addr_for VampChainRegistry)
BRIDGE_ADDRESS=$(addr_for VampBridge)

echo "    USDC:     $USDC_ADDRESS"
echo "    Registry: $REGISTRY_ADDRESS"
echo "    Bridge:   $BRIDGE_ADDRESS"

cat > .env <<EOF
USDC_ADDRESS=$USDC_ADDRESS
REGISTRY_ADDRESS=$REGISTRY_ADDRESS
BRIDGE_ADDRESS=$BRIDGE_ADDRESS
RELAYER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
PROVISIONER_PRIVATE_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
# Must control the private key for the address baked into
# infra/sidechain-node/entrypoint.sh's TREASURY_ADDRESS default, since every
# locally-provisioned vampchain funds that exact address at genesis. Reuses
# the real (testnet-only) treasury key from .secrets/testnet-wallets.json —
# safe to reuse locally since it's Base Sepolia-only and, by design, alone
# can't move real L1 funds (that requires the separate claim-signing key).
TREASURY_PRIVATE_KEY=0x9c0dda1495037bc06e6e5f00e992b9d42c7b0e4364b81f066dc41dae277d4f06
# Block-signing key baked into every locally-provisioned vampchain node.
# Arbitrary well-known test key — see infra/provisioner/.env.example.
CLIQUE_SIGNER_PRIVATE_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
EOF
echo "==> wrote .env with deployed addresses"

echo "==> migrating database..."
DATABASE_URL="postgresql://vampchains:vampchains@localhost:5432/vampchains" \
  pnpm --filter @vampchains/db exec prisma migrate deploy

echo "==> starting gateway, relayer, provisioner..."
docker compose up -d --build rpc-gateway relayer provisioner

cat <<EOF

==> stack is up.
    postgres:    localhost:5432
    l1 (home):   http://localhost:8545
    rpc-gateway: http://localhost:18080
    USDC:        $USDC_ADDRESS
    Registry:    $REGISTRY_ADDRESS
    Bridge:      $BRIDGE_ADDRESS

To run the web app:
    cat > web/.env.local <<ENVEOF
NEXT_PUBLIC_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
NEXT_PUBLIC_BRIDGE_ADDRESS=$BRIDGE_ADDRESS
NEXT_PUBLIC_USDC_ADDRESS=$USDC_ADDRESS
NEXT_PUBLIC_USDC_DECIMALS=6
NEXT_PUBLIC_L1_CHAIN_ID=31337
NEXT_PUBLIC_L1_RPC_URL=http://localhost:8545
NEXT_PUBLIC_GATEWAY_URL=http://localhost:18080
DATABASE_URL=postgresql://vampchains:vampchains@localhost:5432/vampchains
ENVEOF
    pnpm --filter @vampchains/web dev

Tear down with: docker compose down -v
EOF
