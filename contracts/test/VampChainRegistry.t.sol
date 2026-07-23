// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VampChainRegistry} from "../src/VampChainRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MaliciousReentrantToken} from "./mocks/MaliciousReentrantToken.sol";

contract VampChainRegistryTest is Test {
    VampChainRegistry internal registry;
    MockERC20 internal usdc;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal runwayTreasury = makeAddr("runwayTreasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant ANNUAL_FEE = 1_000e6; // $1,000/yr, USDC has 6 decimals
    uint256 internal constant YEAR = 365 days;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        registry = new VampChainRegistry(address(usdc), ANNUAL_FEE, treasury, runwayTreasury, owner);

        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(registry), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(registry), type(uint256).max);
    }

    function _memeToken() internal returns (MockERC20) {
        return new MockERC20("Doge Base", "DOGB", 18);
    }

    // ---------------------------------------------------------------------
    // constructor
    // ---------------------------------------------------------------------

    function test_constructor_revertsOnZeroUsdc() public {
        vm.expectRevert(VampChainRegistry.ZeroAddress.selector);
        new VampChainRegistry(address(0), ANNUAL_FEE, treasury, runwayTreasury, owner);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(VampChainRegistry.ZeroAddress.selector);
        new VampChainRegistry(address(usdc), ANNUAL_FEE, treasury, runwayTreasury, address(0));
    }

    function test_constructor_defaultsTreasuryToOwnerIfZero() public {
        VampChainRegistry r = new VampChainRegistry(address(usdc), ANNUAL_FEE, address(0), runwayTreasury, owner);
        assertEq(r.protocolTreasury(), owner);
    }

    function test_constructor_defaultsRunwayTreasuryToOwnerIfZero() public {
        VampChainRegistry r = new VampChainRegistry(address(usdc), ANNUAL_FEE, treasury, address(0), owner);
        assertEq(r.runwayTreasury(), owner);
    }

    // ---------------------------------------------------------------------
    // createChain
    // ---------------------------------------------------------------------

    function test_createChain_happyPath() public {
        MockERC20 meme = _memeToken();
        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        assertEq(chainId, 1);
        assertEq(registry.nextChainId(), 2);
        assertEq(registry.activeChainByToken(address(meme)), 1);
        assertEq(usdc.balanceOf(alice), aliceBalBefore - ANNUAL_FEE);
        assertEq(usdc.balanceOf(address(registry)), ANNUAL_FEE);

        VampChainRegistry.VampChain memory c = registry.getChain(1);
        assertEq(c.baseToken, address(meme));
        assertEq(c.creator, alice);
        assertEq(c.name, "Dogeblock");
        assertEq(c.symbol, "DOGB");
        assertEq(c.fundingBalance, ANNUAL_FEE);
        assertEq(c.annualFeeUSDC, ANNUAL_FEE);
        assertTrue(c.active);
        assertEq(c.createdAt, block.timestamp);
        assertEq(c.lastAccrualAt, block.timestamp);

        assertTrue(registry.isActive(1));
        assertEq(registry.remainingRuntime(1), YEAR);
    }

    function test_createChain_emitsEvent() public {
        MockERC20 meme = _memeToken();
        vm.expectEmit(true, true, true, true);
        emit VampChainRegistry.ChainCreated(1, address(meme), alice, "Dogeblock", "DOGB", ANNUAL_FEE, ANNUAL_FEE);
        vm.prank(alice);
        registry.createChain(address(meme), "Dogeblock", "DOGB");
    }

    function test_createChain_zeroFeeChainNeedsNoTransfer() public {
        vm.prank(owner);
        registry.setDefaultAnnualFee(0);

        MockERC20 meme = _memeToken();
        uint256 aliceBalBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Free Chain", "FREE");

        assertEq(usdc.balanceOf(alice), aliceBalBefore);
        assertEq(registry.remainingRuntime(chainId), type(uint256).max);
        assertTrue(registry.isActive(chainId));
    }

    function test_createChain_revertsOnZeroToken() public {
        vm.expectRevert(VampChainRegistry.InvalidToken.selector);
        vm.prank(alice);
        registry.createChain(address(0), "x", "X");
    }

    function test_createChain_revertsIfBaseTokenIsUsdc() public {
        vm.expectRevert(VampChainRegistry.InvalidToken.selector);
        vm.prank(alice);
        registry.createChain(address(usdc), "x", "X");
    }

    function test_createChain_revertsOnEmptyName() public {
        MockERC20 meme = _memeToken();
        vm.expectRevert(VampChainRegistry.InvalidLabel.selector);
        vm.prank(alice);
        registry.createChain(address(meme), "", "X");
    }

    function test_createChain_revertsOnOversizedName() public {
        MockERC20 meme = _memeToken();
        string memory tooLong = "this name is way way way way way way way too long for a chain name";
        assertGt(bytes(tooLong).length, 64);
        vm.expectRevert(VampChainRegistry.InvalidLabel.selector);
        vm.prank(alice);
        registry.createChain(address(meme), tooLong, "X");
    }

    function test_createChain_revertsOnOversizedSymbol() public {
        MockERC20 meme = _memeToken();
        vm.expectRevert(VampChainRegistry.InvalidLabel.selector);
        vm.prank(alice);
        registry.createChain(address(meme), "name", "WAYTOOLONGSYMBOLXX");
    }

    function test_createChain_revertsOnDuplicateActiveToken() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        registry.createChain(address(meme), "First", "F");

        vm.expectRevert(VampChainRegistry.TokenAlreadyActive.selector);
        vm.prank(bob);
        registry.createChain(address(meme), "Second", "S");
    }

    function test_createChain_allowsRecreationAfterDeactivation() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "First", "F");

        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);
        assertFalse(registry.isActive(chainId));

        vm.prank(bob);
        uint256 newChainId = registry.createChain(address(meme), "Second", "S");
        assertEq(newChainId, chainId + 1);
        assertTrue(registry.isActive(newChainId));
    }

    function test_createChain_revertsOnNonErc20Token() public {
        vm.expectRevert();
        vm.prank(alice);
        registry.createChain(address(0xdead), "x", "X");
    }

    function test_createChain_revertsOnTooManyDecimals() public {
        MockERC20 tooPrecise = new MockERC20("Too Precise", "PREC", 19);
        vm.expectRevert(VampChainRegistry.InvalidDecimals.selector);
        vm.prank(alice);
        registry.createChain(address(tooPrecise), "Precise", "PREC");
    }

    function test_createChain_revertsOnTooFewDecimals() public {
        MockERC20 wholeUnitsOnly = new MockERC20("Whole Units", "WHOLE", 1);
        vm.expectRevert(VampChainRegistry.InvalidDecimals.selector);
        vm.prank(alice);
        registry.createChain(address(wholeUnitsOnly), "Whole", "WHOLE");
    }

    function test_createChain_allowsBoundaryDecimals() public {
        MockERC20 minDecimals = new MockERC20("Min Decimals", "MIN", 2);
        vm.prank(alice);
        registry.createChain(address(minDecimals), "Min", "MIN");

        MockERC20 maxDecimals = new MockERC20("Max Decimals", "MAX", 18);
        vm.prank(alice);
        registry.createChain(address(maxDecimals), "Max", "MAX");
    }

    // ---------------------------------------------------------------------
    // topUp
    // ---------------------------------------------------------------------

    function test_topUp_happyPath() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.prank(bob);
        registry.topUp(chainId, 500e6);

        VampChainRegistry.VampChain memory c = registry.getChain(chainId);
        assertEq(c.fundingBalance, ANNUAL_FEE + 500e6);
    }

    function test_topUp_extendsRuntimeByExactAmount() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        uint256 before = registry.remainingRuntime(chainId);
        vm.prank(bob);
        registry.topUp(chainId, ANNUAL_FEE); // one more year's worth
        uint256 afterRuntime = registry.remainingRuntime(chainId);

        assertEq(afterRuntime, before + YEAR);
    }

    function test_topUp_revertsOnZeroAmount() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.expectRevert(VampChainRegistry.ZeroAmount.selector);
        vm.prank(bob);
        registry.topUp(chainId, 0);
    }

    function test_topUp_revertsOnUnknownChain() public {
        vm.expectRevert(VampChainRegistry.ChainNotFound.selector);
        registry.topUp(999, 1e6);
    }

    function test_topUp_revertsOnInactiveChain() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");
        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);

        vm.expectRevert(VampChainRegistry.ChainNotActive.selector);
        vm.prank(bob);
        registry.topUp(chainId, 1e6);
    }

    /// @notice The core "rescue" property of the grace period: a top-up
    /// while depleted-but-still-in-grace both keeps the chain active
    /// throughout (it never actually stopped) and pushes the grace
    /// deadline back out, computed fresh from the new funding balance —
    /// no special-cased "un-grace" logic needed, it just falls out of
    /// `depletionInstant`/`graceDeadline` being pure functions of balance.
    function test_topUp_duringGrace_rescuesChain() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR + 1); // depleted, but still within grace
        assertTrue(registry.isActive(chainId));
        assertFalse(registry.isPastGrace(chainId));

        vm.prank(bob);
        registry.topUp(chainId, ANNUAL_FEE);

        // fundingBalance is now 2x ANNUAL_FEE (the original untouched
        // balance plus the top-up — nothing auto-drains it over time,
        // only withdrawEarned/topUp ever change it), so the new
        // depletion instant is a full extra year out from creation, one
        // second later than "now".
        assertTrue(registry.isActive(chainId));
        assertEq(registry.remainingRuntime(chainId), YEAR - 1);
        assertGt(registry.graceDeadline(chainId), block.timestamp + YEAR);

        // Grace-expiry deactivation no longer fires now that it's funded again.
        assertFalse(registry.deactivateIfGraceExpired(chainId));
    }

    // ---------------------------------------------------------------------
    // accrual / earned / remainingRuntime
    // ---------------------------------------------------------------------

    function test_earned_zeroImmediatelyAfterCreation() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");
        assertEq(registry.earned(chainId), 0);
    }

    function test_earned_linearAccrual() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR / 2);
        assertApproxEqAbs(registry.earned(chainId), ANNUAL_FEE / 2, 1);
    }

    function test_earned_capsAtFundingBalance() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR * 5);
        assertEq(registry.earned(chainId), ANNUAL_FEE);
    }

    function test_remainingRuntime_fullAtCreation() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");
        assertEq(registry.remainingRuntime(chainId), YEAR);
    }

    function test_remainingRuntime_countsDown() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + 10 days);
        assertEq(registry.remainingRuntime(chainId), YEAR - 10 days);
    }

    function test_remainingRuntime_zeroAfterFullYear() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR);
        assertEq(registry.remainingRuntime(chainId), 0);
        // Paid runtime hitting zero does NOT deactivate on its own anymore —
        // the chain stays open throughout its grace period. See the
        // "grace period" test section below.
        assertTrue(registry.isActive(chainId));
    }

    // ---------------------------------------------------------------------
    // grace period
    // ---------------------------------------------------------------------

    function test_gracePeriod_isActiveThroughoutGraceWindow() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR); // exactly depleted
        assertTrue(registry.isActive(chainId));
        assertFalse(registry.isPastGrace(chainId));

        vm.warp(block.timestamp + registry.GRACE_PERIOD()); // right at the edge
        assertTrue(registry.isActive(chainId));
        assertFalse(registry.isPastGrace(chainId));

        vm.warp(block.timestamp + 1); // one second past grace
        assertFalse(registry.isActive(chainId));
        assertTrue(registry.isPastGrace(chainId));
    }

    function test_gracePeriod_deactivateIfGraceExpired_falseWhileInGrace() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD()); // depleted, still exactly in grace
        assertFalse(registry.deactivateIfGraceExpired(chainId));
        assertTrue(registry.isActive(chainId));
    }

    function test_gracePeriod_deactivateIfGraceExpired_trueOncePastGrace() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        assertTrue(registry.deactivateIfGraceExpired(chainId));
        assertFalse(registry.isActive(chainId));
    }

    function test_gracePeriod_zeroFeeChainNeverEntersGrace() public {
        vm.prank(owner);
        registry.setDefaultAnnualFee(0);
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Free Chain", "FREE");

        assertEq(registry.depletionInstant(chainId), type(uint256).max);
        assertEq(registry.graceDeadline(chainId), type(uint256).max);

        vm.warp(block.timestamp + 100 * YEAR);
        assertFalse(registry.isPastGrace(chainId));
        assertTrue(registry.isActive(chainId));
        assertFalse(registry.deactivateIfGraceExpired(chainId));
    }

    function test_gracePeriod_depletionInstantAndGraceDeadlineMatchExpectedOffset() public {
        MockERC20 meme = _memeToken();
        uint256 createdAt = block.timestamp;
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        assertEq(registry.depletionInstant(chainId), createdAt + YEAR);
        assertEq(registry.graceDeadline(chainId), createdAt + YEAR + registry.GRACE_PERIOD());
    }

    function testFuzz_gracePeriod_isPastGraceExactlyAtDeadlinePlusOne(uint32 extraWarp) public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        uint256 deadline = registry.graceDeadline(chainId);
        vm.warp(deadline + extraWarp);
        assertEq(registry.isPastGrace(chainId), extraWarp > 0);
        assertEq(registry.isActive(chainId), extraWarp == 0);
    }

    function testFuzz_remainingRuntime_neverExceedsFundingRuntime(uint32 warpSeconds, uint96 topUpAmount) public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.assume(topUpAmount < 1_000_000_000e6);
        usdc.mint(bob, topUpAmount);
        vm.prank(bob);
        usdc.approve(address(registry), topUpAmount);
        if (topUpAmount > 0) {
            vm.prank(bob);
            registry.topUp(chainId, topUpAmount);
        }

        vm.warp(block.timestamp + warpSeconds);
        uint256 runtime = registry.remainingRuntime(chainId);
        uint256 totalRuntimeBudget = ((uint256(ANNUAL_FEE) + topUpAmount) * YEAR) / ANNUAL_FEE;
        assertLe(runtime, totalRuntimeBudget);
    }

    // ---------------------------------------------------------------------
    // withdrawEarned / deactivateIfGraceExpired
    // ---------------------------------------------------------------------

    function test_withdrawEarned_onlyOwner() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");
        vm.warp(block.timestamp + 1 days);

        vm.expectRevert();
        vm.prank(alice);
        registry.withdrawEarned(chainId);
    }

    function test_withdrawEarned_revertsWhenNothingEarned() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.expectRevert(VampChainRegistry.NothingToWithdraw.selector);
        vm.prank(owner);
        registry.withdrawEarned(chainId);
    }

    function test_withdrawEarned_partial() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR / 4);
        uint256 expected = ANNUAL_FEE / 4;

        vm.prank(owner);
        uint256 withdrawn = registry.withdrawEarned(chainId);

        assertApproxEqAbs(withdrawn, expected, 1);
        assertEq(usdc.balanceOf(treasury), withdrawn);

        VampChainRegistry.VampChain memory c = registry.getChain(chainId);
        assertEq(c.fundingBalance, ANNUAL_FEE - withdrawn);
        assertEq(c.lastAccrualAt, block.timestamp);
        assertTrue(c.active);
    }

    function test_withdrawEarned_doesNotChangeRemainingRuntimeInvariant() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + 30 days);
        uint256 runtimeBefore = registry.remainingRuntime(chainId);

        vm.prank(owner);
        registry.withdrawEarned(chainId);

        uint256 runtimeAfter = registry.remainingRuntime(chainId);
        assertEq(runtimeAfter, runtimeBefore);
    }

    /// @notice Fully draining `fundingBalance` no longer auto-deactivates —
    /// that used to bypass the grace period entirely (a routine protocol
    /// fee withdrawal, timed any time after nominal depletion, would
    /// instantly and permanently kill a chain even one second into its
    /// grace window). The chain stays `active` in storage and — since it's
    /// still within grace at YEAR+1 — `isActive()` correctly stays true.
    /// Only `deactivateIfGraceExpired`, once grace has genuinely elapsed,
    /// ever flips that.
    function test_withdrawEarned_fullDrainDoesNotBypassGracePeriod() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR + 1); // depleted, but still within grace

        vm.prank(owner);
        uint256 withdrawn = registry.withdrawEarned(chainId);
        assertEq(withdrawn, ANNUAL_FEE);

        VampChainRegistry.VampChain memory c = registry.getChain(chainId);
        assertEq(c.fundingBalance, 0);
        assertTrue(c.active);
        assertEq(registry.activeChainByToken(address(meme)), chainId);
        assertTrue(registry.isActive(chainId));

        // Once grace genuinely expires, deactivation still works correctly
        // even with fundingBalance already at zero.
        vm.warp(block.timestamp + registry.GRACE_PERIOD() + 1);
        assertTrue(registry.deactivateIfGraceExpired(chainId));
        assertFalse(registry.isActive(chainId));
        assertEq(registry.activeChainByToken(address(meme)), 0);
    }

    // ---------------------------------------------------------------------
    // setChainAnnualFee
    // ---------------------------------------------------------------------

    function test_setChainAnnualFee_onlyOwner() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.expectRevert();
        vm.prank(alice);
        registry.setChainAnnualFee(chainId, ANNUAL_FEE * 2);
    }

    function test_setChainAnnualFee_revertsOnInactiveChain() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");
        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);

        vm.expectRevert(VampChainRegistry.ChainNotActive.selector);
        vm.prank(owner);
        registry.setChainAnnualFee(chainId, ANNUAL_FEE * 2);
    }

    function test_setChainAnnualFee_worksWithNothingAccruedYet() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        // Unlike withdrawEarned, a zero-settlement change is not an error —
        // there's nothing wrong with adjusting a brand new chain's rate.
        vm.prank(owner);
        registry.setChainAnnualFee(chainId, ANNUAL_FEE * 2);

        VampChainRegistry.VampChain memory c = registry.getChain(chainId);
        assertEq(c.annualFeeUSDC, ANNUAL_FEE * 2);
        assertEq(c.fundingBalance, ANNUAL_FEE);
    }

    function test_setChainAnnualFee_settlesAccruedAmountAtOldRateBeforeChanging() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR / 4);
        uint256 expectedSettled = ANNUAL_FEE / 4;

        vm.prank(owner);
        registry.setChainAnnualFee(chainId, ANNUAL_FEE * 2);

        assertApproxEqAbs(usdc.balanceOf(treasury), expectedSettled, 1);

        VampChainRegistry.VampChain memory c = registry.getChain(chainId);
        assertApproxEqAbs(c.fundingBalance, ANNUAL_FEE - expectedSettled, 1);
        assertEq(c.lastAccrualAt, block.timestamp);
        assertEq(c.annualFeeUSDC, ANNUAL_FEE * 2);
    }

    /// @notice The core non-retroactivity property: total earned across a
    /// rate change always matches (old rate × time before) + (new rate ×
    /// time after) — never one rate applied to the whole elapsed period.
    /// Halves the rate (rather than raising it) specifically so the
    /// second period's accrual stays comfortably under the remaining
    /// `fundingBalance` — a bigger multiplier would hit the "can't earn
    /// more than what's left" cap and mask the property being tested.
    function test_setChainAnnualFee_newRateOnlyAppliesGoingForward() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR / 4);
        uint256 earnedBeforeChange = ANNUAL_FEE / 4;

        vm.prank(owner);
        registry.setChainAnnualFee(chainId, ANNUAL_FEE / 2);

        vm.warp(block.timestamp + YEAR / 4);
        vm.prank(owner);
        uint256 earnedAfterChange = registry.withdrawEarned(chainId);

        // A quarter-year at half the original rate, not at the original rate.
        assertApproxEqAbs(earnedAfterChange, ANNUAL_FEE / 8, 1);
        assertApproxEqAbs(usdc.balanceOf(treasury), earnedBeforeChange + earnedAfterChange, 2);
    }

    function test_setChainAnnualFee_emitsEvent() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.warp(block.timestamp + YEAR / 4);

        vm.expectEmit(true, true, true, true);
        emit VampChainRegistry.ChainAnnualFeeUpdated(chainId, ANNUAL_FEE, ANNUAL_FEE * 2, ANNUAL_FEE / 4);
        vm.prank(owner);
        registry.setChainAnnualFee(chainId, ANNUAL_FEE * 2);
    }

    function test_setChainAnnualFee_revertsOnUnknownChain() public {
        vm.expectRevert(VampChainRegistry.ChainNotFound.selector);
        vm.prank(owner);
        registry.setChainAnnualFee(42, ANNUAL_FEE);
    }

    function test_deactivateIfGraceExpired_permissionless() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");
        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);

        vm.prank(bob); // anyone can call this, not just owner
        bool deactivated = registry.deactivateIfGraceExpired(chainId);
        assertTrue(deactivated);
        assertFalse(registry.isActive(chainId));
    }

    function test_deactivateIfGraceExpired_falseWhileStillFunded() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        bool deactivated = registry.deactivateIfGraceExpired(chainId);
        assertFalse(deactivated);
        assertTrue(registry.isActive(chainId));
    }

    function test_deactivateIfGraceExpired_revertsOnUnknownChain() public {
        vm.expectRevert(VampChainRegistry.ChainNotFound.selector);
        registry.deactivateIfGraceExpired(999);
    }

    // ---------------------------------------------------------------------
    // owner admin
    // ---------------------------------------------------------------------

    function test_setDefaultAnnualFee_onlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        registry.setDefaultAnnualFee(1);
    }

    function test_setDefaultAnnualFee_doesNotAffectExistingChains() public {
        MockERC20 meme = _memeToken();
        vm.prank(alice);
        uint256 chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        vm.prank(owner);
        registry.setDefaultAnnualFee(ANNUAL_FEE * 10);

        VampChainRegistry.VampChain memory c = registry.getChain(chainId);
        assertEq(c.annualFeeUSDC, ANNUAL_FEE);
    }

    function test_setProtocolTreasury_onlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        registry.setProtocolTreasury(bob);
    }

    function test_setProtocolTreasury_revertsOnZero() public {
        vm.expectRevert(VampChainRegistry.ZeroAddress.selector);
        vm.prank(owner);
        registry.setProtocolTreasury(address(0));
    }

    function test_setProtocolTreasury_updatesAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit VampChainRegistry.ProtocolTreasuryUpdated(treasury, bob);
        vm.prank(owner);
        registry.setProtocolTreasury(bob);
        assertEq(registry.protocolTreasury(), bob);
    }

    function test_setRunwayTreasury_onlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        registry.setRunwayTreasury(bob);
    }

    function test_setRunwayTreasury_revertsOnZero() public {
        vm.expectRevert(VampChainRegistry.ZeroAddress.selector);
        vm.prank(owner);
        registry.setRunwayTreasury(address(0));
    }

    function test_setRunwayTreasury_updatesAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit VampChainRegistry.RunwayTreasuryUpdated(runwayTreasury, bob);
        vm.prank(owner);
        registry.setRunwayTreasury(bob);
        assertEq(registry.runwayTreasury(), bob);
    }

    function test_chainCount() public {
        MockERC20 memeA = _memeToken();
        MockERC20 memeB = _memeToken();
        assertEq(registry.chainCount(), 0);
        vm.prank(alice);
        registry.createChain(address(memeA), "A", "A");
        assertEq(registry.chainCount(), 1);
        vm.prank(alice);
        registry.createChain(address(memeB), "B", "B");
        assertEq(registry.chainCount(), 2);
    }

    // ---------------------------------------------------------------------
    // views on unknown chains
    // ---------------------------------------------------------------------

    function test_getChain_revertsOnUnknown() public {
        vm.expectRevert(VampChainRegistry.ChainNotFound.selector);
        registry.getChain(42);
    }

    function test_isActive_falseForUnknownChain() public view {
        assertFalse(registry.isActive(42));
    }

    // ---------------------------------------------------------------------
    // reentrancy
    // ---------------------------------------------------------------------

    function test_createChain_blocksReentrancy() public {
        MaliciousReentrantToken evilUsdc = new MaliciousReentrantToken();
        VampChainRegistry evilRegistry = new VampChainRegistry(address(evilUsdc), ANNUAL_FEE, treasury, runwayTreasury, owner);
        MockERC20 meme = _memeToken();

        evilUsdc.mint(alice, ANNUAL_FEE * 2);
        evilUsdc.arm(
            address(evilRegistry), abi.encodeCall(VampChainRegistry.createChain, (address(meme), "Reentrant", "RE"))
        );

        vm.prank(alice);
        evilRegistry.createChain(address(meme), "Dogeblock", "DOGB");

        assertTrue(evilUsdc.callbackAttempted());
        assertFalse(evilUsdc.callbackSucceeded());
    }
}
