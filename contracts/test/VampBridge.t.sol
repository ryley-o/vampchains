// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VampChainRegistry} from "../src/VampChainRegistry.sol";
import {VampBridge} from "../src/VampBridge.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MaliciousReentrantToken} from "./mocks/MaliciousReentrantToken.sol";

contract VampBridgeTest is Test {
    VampChainRegistry internal registry;
    VampBridge internal bridge;
    MockERC20 internal usdc;
    MockERC20 internal meme;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant ANNUAL_FEE = 1_000e6;
    uint256 internal constant YEAR = 365 days;

    uint256 internal chainId;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        meme = new MockERC20("Doge Base", "DOGB", 18);
        registry = new VampChainRegistry(address(usdc), ANNUAL_FEE, treasury, owner);
        bridge = new VampBridge(address(registry), relayer, owner);

        usdc.mint(alice, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(registry), type(uint256).max);
        vm.prank(alice);
        chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        meme.mint(alice, 1_000_000e18);
        vm.prank(alice);
        meme.approve(address(bridge), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // constructor
    // ---------------------------------------------------------------------

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        new VampBridge(address(0), relayer, owner);

        vm.expectRevert(VampBridge.ZeroAddress.selector);
        new VampBridge(address(registry), address(0), owner);

        vm.expectRevert(VampBridge.ZeroAddress.selector);
        new VampBridge(address(registry), relayer, address(0));
    }

    // ---------------------------------------------------------------------
    // deposit
    // ---------------------------------------------------------------------

    function test_deposit_happyPath() public {
        vm.prank(alice);
        uint256 nonce = bridge.deposit(chainId, 100e18, bob);

        assertEq(nonce, 0);
        assertEq(bridge.lockedBalance(chainId), 100e18);
        assertEq(meme.balanceOf(address(bridge)), 100e18);
        assertEq(bridge.depositNonce(), 1);
    }

    function test_deposit_emitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit VampBridge.Deposited(chainId, alice, bob, 100e18, 0);
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, bob);
    }

    function test_deposit_incrementsNonceAcrossCalls() public {
        vm.startPrank(alice);
        assertEq(bridge.deposit(chainId, 1e18, alice), 0);
        assertEq(bridge.deposit(chainId, 1e18, alice), 1);
        assertEq(bridge.deposit(chainId, 1e18, alice), 2);
        vm.stopPrank();
    }

    function test_deposit_revertsOnZeroAmount() public {
        vm.expectRevert(VampBridge.ZeroAmount.selector);
        vm.prank(alice);
        bridge.deposit(chainId, 0, bob);
    }

    function test_deposit_revertsOnZeroRecipient() public {
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        vm.prank(alice);
        bridge.deposit(chainId, 1e18, address(0));
    }

    function test_deposit_revertsOnInactiveChain() public {
        vm.warp(block.timestamp + YEAR + 1);
        vm.expectRevert(VampBridge.ChainNotActive.selector);
        vm.prank(alice);
        bridge.deposit(chainId, 1e18, bob);
    }

    function test_deposit_revertsOnUnknownChain() public {
        vm.expectRevert(); // registry reverts with ChainNotFound from isActive's internal lookup
        vm.prank(alice);
        bridge.deposit(999, 1e18, bob);
    }

    function test_deposit_revertsWhenPaused() public {
        vm.prank(owner);
        bridge.setPaused(true);

        vm.expectRevert(VampBridge.BridgePaused.selector);
        vm.prank(alice);
        bridge.deposit(chainId, 1e18, bob);
    }

    function test_deposit_accountsSeparatelyPerChain() public {
        vm.prank(bob);
        usdc.mint(bob, 0); // no-op, bob doesn't need usdc
        MockERC20 meme2 = new MockERC20("Other Base", "OTH", 18);
        usdc.mint(bob, ANNUAL_FEE);
        vm.prank(bob);
        usdc.approve(address(registry), ANNUAL_FEE);
        vm.prank(bob);
        uint256 chainId2 = registry.createChain(address(meme2), "Other", "OTH");

        meme2.mint(bob, 100e18);
        vm.prank(bob);
        meme2.approve(address(bridge), type(uint256).max);

        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);
        vm.prank(bob);
        bridge.deposit(chainId2, 20e18, bob);

        assertEq(bridge.lockedBalance(chainId), 10e18);
        assertEq(bridge.lockedBalance(chainId2), 20e18);
    }

    // ---------------------------------------------------------------------
    // release
    // ---------------------------------------------------------------------

    function test_release_onlyRelayer() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.expectRevert(VampBridge.NotRelayer.selector);
        vm.prank(alice);
        bridge.release(chainId, alice, 50e18, keccak256("tx1"));
    }

    function test_release_happyPath() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.prank(relayer);
        bridge.release(chainId, bob, 40e18, keccak256("tx1"));

        assertEq(meme.balanceOf(bob), 40e18);
        assertEq(bridge.lockedBalance(chainId), 60e18);
        assertTrue(bridge.releaseProcessed(keccak256("tx1")));
    }

    function test_release_emitsEvent() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.expectEmit(true, true, true, true);
        emit VampBridge.Released(chainId, bob, 40e18, keccak256("tx1"));
        vm.prank(relayer);
        bridge.release(chainId, bob, 40e18, keccak256("tx1"));
    }

    function test_release_revertsOnReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.prank(relayer);
        bridge.release(chainId, bob, 40e18, keccak256("tx1"));

        vm.expectRevert(VampBridge.AlreadyReleased.selector);
        vm.prank(relayer);
        bridge.release(chainId, bob, 40e18, keccak256("tx1"));
    }

    function test_release_revertsWhenExceedsLocked() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        vm.expectRevert(VampBridge.InsufficientLocked.selector);
        vm.prank(relayer);
        bridge.release(chainId, bob, 20e18, keccak256("tx1"));
    }

    function test_release_revertsOnZeroAmountOrRecipient() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        vm.expectRevert(VampBridge.ZeroAmount.selector);
        vm.prank(relayer);
        bridge.release(chainId, bob, 0, keccak256("tx1"));

        vm.expectRevert(VampBridge.ZeroAddress.selector);
        vm.prank(relayer);
        bridge.release(chainId, address(0), 1e18, keccak256("tx1"));
    }

    function test_release_revertsWhenPaused() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);
        vm.prank(owner);
        bridge.setPaused(true);

        vm.expectRevert(VampBridge.BridgePaused.selector);
        vm.prank(relayer);
        bridge.release(chainId, bob, 1e18, keccak256("tx1"));
    }

    /// @notice The whole point of a lock-and-mint bridge: users must be able
    /// to redeem locked collateral even after the vampchain itself has been
    /// torn down for lack of funding. `release` must not depend on
    /// registry.isActive().
    function test_release_worksAfterChainDeactivated() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.warp(block.timestamp + YEAR + 1);
        registry.deactivateIfDepleted(chainId);
        assertFalse(registry.isActive(chainId));

        vm.prank(relayer);
        bridge.release(chainId, bob, 40e18, keccak256("tx1"));
        assertEq(meme.balanceOf(bob), 40e18);
    }

    // ---------------------------------------------------------------------
    // owner admin
    // ---------------------------------------------------------------------

    function test_setRelayer_onlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        bridge.setRelayer(bob);
    }

    function test_setRelayer_updatesAndBlocksOldRelayer() public {
        vm.prank(owner);
        bridge.setRelayer(bob);

        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        vm.expectRevert(VampBridge.NotRelayer.selector);
        vm.prank(relayer);
        bridge.release(chainId, alice, 1e18, keccak256("tx1"));

        vm.prank(bob);
        bridge.release(chainId, alice, 1e18, keccak256("tx1"));
    }

    function test_setRelayer_revertsOnZero() public {
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        vm.prank(owner);
        bridge.setRelayer(address(0));
    }

    function test_setPaused_onlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        bridge.setPaused(true);
    }

    // ---------------------------------------------------------------------
    // reentrancy
    // ---------------------------------------------------------------------

    function test_deposit_blocksReentrancy() public {
        MaliciousReentrantToken evilMeme = new MaliciousReentrantToken();
        MockERC20 feeToken = new MockERC20("USD Coin", "USDC", 6);
        VampChainRegistry evilRegistry = new VampChainRegistry(address(feeToken), ANNUAL_FEE, treasury, owner);
        VampBridge evilBridge = new VampBridge(address(evilRegistry), relayer, owner);

        feeToken.mint(alice, ANNUAL_FEE);
        vm.prank(alice);
        feeToken.approve(address(evilRegistry), ANNUAL_FEE);
        vm.prank(alice);
        uint256 evilChainId = evilRegistry.createChain(address(evilMeme), "Evil", "EVL");

        evilMeme.mint(alice, 100e18);
        evilMeme.arm(address(evilBridge), abi.encodeCall(VampBridge.deposit, (evilChainId, 1e18, alice)));

        vm.prank(alice);
        evilBridge.deposit(evilChainId, 10e18, alice);

        assertTrue(evilMeme.callbackAttempted());
        assertFalse(evilMeme.callbackSucceeded());
    }

    // ---------------------------------------------------------------------
    // fuzz
    // ---------------------------------------------------------------------

    function testFuzz_depositRelease_roundTrip(uint96 depositAmount, uint96 releaseAmount) public {
        vm.assume(depositAmount > 0 && depositAmount < 1_000_000_000e18);
        vm.assume(releaseAmount > 0 && releaseAmount <= depositAmount);

        meme.mint(alice, depositAmount);
        vm.prank(alice);
        bridge.deposit(chainId, depositAmount, alice);

        vm.prank(relayer);
        bridge.release(chainId, bob, releaseAmount, keccak256(abi.encode(depositAmount, releaseAmount)));

        assertEq(meme.balanceOf(bob), releaseAmount);
        assertEq(bridge.lockedBalance(chainId), depositAmount - releaseAmount);
    }
}
