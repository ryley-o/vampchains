// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VampChainRegistry} from "../src/VampChainRegistry.sol";
import {VampBridge} from "../src/VampBridge.sol";

/// @notice Deploys VampChainRegistry + VampBridge.
///
/// Required env vars:
///   PRIVATE_KEY          deployer/owner key
///   USDC_ADDRESS         USDC token on the target chain
///   RELAYER_ADDRESS      address of the relayer service's hot wallet
///   PROTOCOL_TREASURY    where earned fees go (defaults to deployer if unset)
///   ANNUAL_FEE_USDC      default annual fee in USDC's smallest unit (e.g. 1000e6), defaults to 1000e6
contract Deploy is Script {
    function run() external returns (VampChainRegistry registry, VampBridge bridge) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address usdc = vm.envAddress("USDC_ADDRESS");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address treasury = vm.envOr("PROTOCOL_TREASURY", deployer);
        uint256 annualFee = vm.envOr("ANNUAL_FEE_USDC", uint256(1_000e6));

        vm.startBroadcast(pk);

        registry = new VampChainRegistry(usdc, annualFee, treasury, deployer);
        bridge = new VampBridge(address(registry), relayer, deployer);

        vm.stopBroadcast();

        console.log("VampChainRegistry:", address(registry));
        console.log("VampBridge:", address(bridge));
    }
}
