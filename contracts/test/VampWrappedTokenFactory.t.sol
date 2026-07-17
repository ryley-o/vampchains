// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VampWrappedTokenFactory} from "../src/VampWrappedTokenFactory.sol";
import {VampWrappedToken} from "../src/VampWrappedToken.sol";

contract VampWrappedTokenFactoryTest is Test {
    VampWrappedTokenFactory internal factory;
    address internal treasury;
    address internal user = address(0xBEEF);
    address internal l1Token = address(0xABCDEF);

    function setUp() public {
        // The factory and its implementation both live at fixed, compile
        // -time-constant addresses baked into every real vampchain's
        // genesis (see genesis.template.json). Tests etch the
        // implementation's real bytecode at that same fixed address so
        // clones (which delegate to it) behave exactly as they would on a
        // real chain, then deploy the factory normally (its own address
        // doesn't need to match production for these tests — only
        // IMPLEMENTATION does, since that address is baked into the
        // factory's bytecode as a constant).
        factory = new VampWrappedTokenFactory();
        treasury = factory.TREASURY();
        vm.etch(factory.IMPLEMENTATION(), address(new VampWrappedToken()).code);
    }

    function test_wrappedAddressOf_dependsOnlyOnL1Token() public view {
        address a = factory.wrappedAddressOf(l1Token);
        address b = factory.wrappedAddressOf(l1Token);
        assertEq(a, b);
    }

    function test_wrappedAddressOf_matchesActualDeployment() public {
        address predicted = factory.wrappedAddressOf(l1Token);
        vm.prank(treasury);
        address deployed = factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
        assertEq(predicted, deployed);
    }

    function test_deploy_setsCorrectMetadata() public {
        vm.prank(treasury);
        address wrapped = factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
        VampWrappedToken w = VampWrappedToken(wrapped);
        assertEq(w.name(), "Vampchain Meme Coin");
        assertEq(w.symbol(), "vMEME");
        assertEq(w.decimals(), 9);
        assertEq(w.l1Token(), l1Token);
        assertEq(w.factory(), address(factory));
    }

    function test_deploy_isIdempotent() public {
        vm.startPrank(treasury);
        address first = factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
        address second = factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
        vm.stopPrank();
        assertEq(first, second);
    }

    /// @notice Later `deploy` calls with different metadata for the same
    /// `l1Token` must not overwrite what's already there — the address is
    /// fixed by `l1Token` alone, but the *content* at that address is
    /// set-once, not caller-refreshable, so a compromised or buggy relayer
    /// call can't quietly rebrand an existing wrapped token.
    function test_deploy_ignoresMetadataOnRepeatCalls() public {
        vm.startPrank(treasury);
        address wrapped = factory.deploy(l1Token, "Original Name", "ORIG", 18);
        factory.deploy(l1Token, "Different Name", "DIFF", 6);
        vm.stopPrank();

        VampWrappedToken w = VampWrappedToken(wrapped);
        assertEq(w.name(), "Original Name");
        assertEq(w.symbol(), "ORIG");
        assertEq(w.decimals(), 18);
    }

    function test_deploy_revertsIfNotTreasury() public {
        vm.prank(user);
        vm.expectRevert(VampWrappedTokenFactory.OnlyTreasury.selector);
        factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
    }

    function test_differentTokens_getDifferentAddresses() public {
        vm.startPrank(treasury);
        address a = factory.deploy(l1Token, "A", "A", 18);
        address b = factory.deploy(address(0x1234), "B", "B", 18);
        vm.stopPrank();
        assertTrue(a != b);
    }

    function test_mintWrapped_revertsIfNotTreasury() public {
        vm.prank(user);
        vm.expectRevert(VampWrappedTokenFactory.OnlyTreasury.selector);
        factory.mintWrapped(l1Token, "Vampchain Meme Coin", "vMEME", 9, user, 100);
    }

    function test_mintWrapped_deploysAndMints() public {
        vm.prank(treasury);
        address wrapped = factory.mintWrapped(l1Token, "Vampchain Meme Coin", "vMEME", 9, user, 500e9);
        assertEq(VampWrappedToken(wrapped).balanceOf(user), 500e9);
    }

    function test_mintWrapped_worksAfterManualDeploy() public {
        vm.startPrank(treasury);
        address predeployed = factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
        address wrapped = factory.mintWrapped(l1Token, "Vampchain Meme Coin", "vMEME", 9, user, 42);
        vm.stopPrank();
        assertEq(wrapped, predeployed);
        assertEq(VampWrappedToken(wrapped).balanceOf(user), 42);
    }

    function test_mint_revertsIfNotCalledByFactory() public {
        vm.prank(treasury);
        address wrapped = factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
        vm.expectRevert(VampWrappedToken.OnlyFactory.selector);
        VampWrappedToken(wrapped).mint(user, 1);
    }

    function test_initialize_revertsIfCalledTwice() public {
        vm.prank(treasury);
        address wrapped = factory.deploy(l1Token, "Vampchain Meme Coin", "vMEME", 9);
        vm.expectRevert(VampWrappedToken.AlreadyInitialized.selector);
        VampWrappedToken(wrapped).initialize(l1Token, "Hijacked", "HACK", 18);
    }

    function testFuzz_wrappedAddressIsDeterministic(address token) public view {
        address predicted1 = factory.wrappedAddressOf(token);
        address predicted2 = factory.wrappedAddressOf(token);
        assertEq(predicted1, predicted2);
    }

    function testFuzz_deploy_matchesPrediction(address token, uint8 decimals) public {
        vm.assume(token != address(0));
        address predicted = factory.wrappedAddressOf(token);
        vm.prank(treasury);
        address deployed = factory.deploy(token, "Name", "SYM", decimals);
        assertEq(predicted, deployed);
    }
}
