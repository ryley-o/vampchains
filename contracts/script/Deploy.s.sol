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
///   RUNWAY_TREASURY      where the runway-earmarked third of gas-fee claims
///                        goes — deliberately a separate wallet from
///                        PROTOCOL_TREASURY (defaults to deployer if unset,
///                        but should always be set to a real distinct
///                        address for any deployment that matters)
///   ANNUAL_FEE_USDC      default annual fee in USDC's smallest unit (e.g. 1000e6), defaults to 1000e6
contract Deploy is Script {
    function run() external returns (VampChainRegistry registry, VampBridge bridge) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address usdc = vm.envAddress("USDC_ADDRESS");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address treasury = vm.envOr("PROTOCOL_TREASURY", deployer);
        address runwayTreasury = vm.envOr("RUNWAY_TREASURY", deployer);
        uint256 annualFee = vm.envOr("ANNUAL_FEE_USDC", uint256(1_000e6));

        vm.startBroadcast(pk);

        registry = new VampChainRegistry(usdc, annualFee, treasury, runwayTreasury, deployer);
        bridge = new VampBridge(address(registry), relayer, deployer);

        vm.stopBroadcast();

        console.log("VampChainRegistry:", address(registry));
        console.log("VampBridge:", address(bridge));
    }
}
