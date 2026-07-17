# vampchains contracts

Foundry project, dependency-managed with soldeer (`solady`, `forge-std`).

```
src/
  VampChainRegistry.sol      chain creation, USDC fee accounting/accrual, funding lifecycle
  VampBridge.sol              lock-and-mint / burn-and-claim bridge — a chain's own base token
                               (native currency) plus depositToken/claimToken for any other ERC20
  VampWrappedToken.sol        wrapped-ERC20 implementation for general-bridged tokens (clones only)
  VampWrappedTokenFactory.sol genesis-baked factory that deploys/mints those clones deterministically
test/                      115 tests, 100% line coverage on VampBridge and VampWrappedTokenFactory,
                            ~95% on VampChainRegistry
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
rationale (accrual math, trust model, why geth Clique PoA sidechains).

**Not audited.** Do not deploy to mainnet with real funds without an audit.
