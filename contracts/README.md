# vampchains contracts

Foundry project, dependency-managed with soldeer (`solady`, `forge-std`).

```
src/
  VampChainRegistry.sol   chain creation, USDC fee accounting/accrual, funding lifecycle
  VampBridge.sol           lock-and-mint / burn-and-release bridge for a chain's base token
test/                      67 tests, 100% line coverage on VampBridge, ~95% on VampChainRegistry
script/Deploy.s.sol        deploy script (see env vars in the file header)
```

## Commands

```bash
forge install         # not needed day-to-day: deps are fetched via `forge soldeer install`
forge build
forge test
forge coverage --report summary
forge fmt
```

## Deploying

```bash
PRIVATE_KEY=0x... \
USDC_ADDRESS=0x... \
RELAYER_ADDRESS=0x... \
forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --verify
```

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the design
rationale (accrual math, trust model, why anvil-based sidechains).

**Not audited.** Do not deploy to mainnet with real funds without an audit.
