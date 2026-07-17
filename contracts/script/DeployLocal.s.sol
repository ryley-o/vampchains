// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VampChainRegistry} from "../src/VampChainRegistry.sol";
import {VampBridge} from "../src/VampBridge.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice One-shot local dev deploy against a fresh anvil: a MockUSDC, the
/// registry + bridge (deployer = anvil account #0, relayer = account #1),
/// and mints some MockUSDC to the deployer so it can immediately try
/// `createChain`. NOT for any real network — script/Deploy.s.sol is the real
/// deploy path against a real USDC.
contract DeployLocal is Script {
    // anvil's well-known default mnemonic, accounts #0 and #1.
    uint256 internal constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant RELAYER_ADDRESS = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external returns (address usdc, address registry, address bridge) {
        address deployer = vm.addr(DEPLOYER_KEY);

        vm.startBroadcast(DEPLOYER_KEY);

        MockERC20 mockUsdc = new MockERC20("USD Coin", "USDC", 6);
        mockUsdc.mint(deployer, 1_000_000e6);

        VampChainRegistry registryContract = new VampChainRegistry(address(mockUsdc), 1_000e6, deployer, deployer);
        VampBridge bridgeContract = new VampBridge(address(registryContract), RELAYER_ADDRESS, deployer);

        vm.stopBroadcast();

        usdc = address(mockUsdc);
        registry = address(registryContract);
        bridge = address(bridgeContract);

        console.log("MockUSDC:", usdc);
        console.log("VampChainRegistry:", registry);
        console.log("VampBridge:", bridge);
    }
}
