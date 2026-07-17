#!/bin/sh
# Copies just the ABI arrays out of Foundry's build artifacts into the web
# app, so the web app never needs Foundry installed (e.g. on Vercel) and its
# ABIs can't silently drift from the deployed contracts. Re-run this after
# any contract change, before committing.
set -eu

cd "$(dirname "$0")/.."

(cd contracts && forge build >/dev/null)

mkdir -p web/src/lib/abis

for name in VampChainRegistry VampBridge; do
  python3 -c "
import json
with open('contracts/out/${name}.sol/${name}.json') as f:
    abi = json.load(f)['abi']
with open('web/src/lib/abis/${name}.json', 'w') as f:
    json.dump(abi, f, indent=2)
    f.write('\n')
"
  echo "synced web/src/lib/abis/${name}.json"
done
