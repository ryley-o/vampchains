// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VampChainRegistry} from "../src/VampChainRegistry.sol";
import {VampBridge} from "../src/VampBridge.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice One-shot local dev deploy against the local geth-based L1
/// stand-in: a MockUSDC, the registry + bridge (deployer = anvil account #0,
/// relayer = account #1), and mints some MockUSDC to the deployer so it can
/// immediately try `createChain`. NOT for any real network —
/// script/Deploy.s.sol is the real deploy path against a real USDC.
///
/// Unlike anvil, the local geth L1 stand-in only funds one address at
/// genesis (TREASURY_ADDRESS on the `l1` compose service, set to this
/// script's deployer). So this script also forwards a slice of ETH to the
/// provisioner account, which needs its own L1 gas to submit
/// `deactivateIfDepleted` txs. The relayer no longer submits any L1 txs
/// (it only signs claims off-chain), so it needs none.
contract DeployLocal is Script {
    // anvil's well-known default mnemonic, accounts #0, #1, #2.
    uint256 internal constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant RELAYER_ADDRESS = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant PROVISIONER_ADDRESS = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function run() external returns (address usdc, address registry, address bridge) {
        address deployer = vm.addr(DEPLOYER_KEY);

        vm.startBroadcast(DEPLOYER_KEY);

        MockERC20 mockUsdc = new MockERC20("USD Coin", "USDC", 6);
        mockUsdc.mint(deployer, 1_000_000e6);

        VampChainRegistry registryContract = new VampChainRegistry(address(mockUsdc), 1_000e6, deployer, deployer);
        VampBridge bridgeContract = new VampBridge(address(registryContract), RELAYER_ADDRESS, deployer);

        payable(PROVISIONER_ADDRESS).transfer(10 ether);

        vm.stopBroadcast();

        usdc = address(mockUsdc);
        registry = address(registryContract);
        bridge = address(bridgeContract);

        console.log("MockUSDC:", usdc);
        console.log("VampChainRegistry:", registry);
        console.log("VampBridge:", bridge);
    }
}
