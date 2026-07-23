#!/bin/sh
# Copies just the ABI arrays out of Foundry's build artifacts into
# packages/contract-abis, so nothing that consumes an ABI (web/, scan/,
# infra/verifier) ever needs Foundry installed and ABIs can't silently
# drift from the deployed contracts. Re-run this after any contract
# change, before committing.
set -eu

cd "$(dirname "$0")/.."

(cd contracts && forge build >/dev/null)

mkdir -p packages/contract-abis/src/abis

for name in VampChainRegistry VampBridge VampWrappedToken VampWrappedTokenFactory; do
  python3 -c "
import json
with open('contracts/out/${name}.sol/${name}.json') as f:
    abi = json.load(f)['abi']
with open('packages/contract-abis/src/abis/${name}.json', 'w') as f:
    json.dump(abi, f, indent=2)
    f.write('\n')
"
  echo "synced packages/contract-abis/src/abis/${name}.json"
done
