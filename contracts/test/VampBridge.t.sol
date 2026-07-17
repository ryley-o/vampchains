// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VampChainRegistry} from "../src/VampChainRegistry.sol";
import {VampBridge} from "../src/VampBridge.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeeOnTransferERC20} from "./mocks/MockFeeOnTransferERC20.sol";
import {MaliciousReentrantToken} from "./mocks/MaliciousReentrantToken.sol";

contract VampBridgeTest is Test {
    VampChainRegistry internal registry;
    VampBridge internal bridge;
    MockERC20 internal usdc;
    MockERC20 internal meme;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    uint256 internal signerKey = 0xB1DE12; // arbitrary nonzero private key
    address internal signer;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant ANNUAL_FEE = 1_000e6;
    uint256 internal constant YEAR = 365 days;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    uint256 internal chainId;

    function setUp() public {
        signer = vm.addr(signerKey);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        meme = new MockERC20("Doge Base", "DOGB", 18);
        registry = new VampChainRegistry(address(usdc), ANNUAL_FEE, treasury, owner);
        bridge = new VampBridge(address(registry), signer, owner);

        usdc.mint(alice, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(registry), type(uint256).max);
        vm.prank(alice);
        chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        meme.mint(alice, 1_000_000e18);
        vm.prank(alice);
        meme.approve(address(bridge), type(uint256).max);
    }

    function _domainSeparator(address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("VampBridge")), keccak256(bytes("1")), block.chainid, verifyingContract
            )
        );
    }

    function _signClaim(
        uint256 pk,
        address verifyingContract,
        uint256 vampChainId,
        address to,
        uint256 amount,
        bytes32 sidechainTxHash
    ) internal view returns (bytes memory signature) {
        bytes32 structHash = keccak256(abi.encode(bridge.CLAIM_TYPEHASH(), vampChainId, to, amount, sidechainTxHash));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifyingContract), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _validSignature(uint256 vampChainId, address to, uint256 amount, bytes32 sidechainTxHash)
        internal
        view
        returns (bytes memory)
    {
        return _signClaim(signerKey, address(bridge), vampChainId, to, amount, sidechainTxHash);
    }

    // ---------------------------------------------------------------------
    // constructor
    // ---------------------------------------------------------------------

    function test_constructor_revertsOnZeroAddresses() public {
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        new VampBridge(address(0), signer, owner);

        vm.expectRevert(VampBridge.ZeroAddress.selector);
        new VampBridge(address(registry), address(0), owner);

        vm.expectRevert(VampBridge.ZeroAddress.selector);
        new VampBridge(address(registry), signer, address(0));
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

    /// @notice The whole point of measuring the actual balance delta: a
    /// fee-on-transfer token must never let lockedBalance claim more than
    /// the bridge actually holds.
    function test_deposit_feeOnTransferToken_creditsActualAmountReceived() public {
        MockFeeOnTransferERC20 feeToken = new MockFeeOnTransferERC20("Fee Token", "FEE", 18, 1_000); // 10% fee
        usdc.mint(alice, ANNUAL_FEE);
        vm.prank(alice);
        usdc.approve(address(registry), ANNUAL_FEE);
        vm.prank(alice);
        uint256 feeChainId = registry.createChain(address(feeToken), "Fee Chain", "FEE");

        feeToken.mint(alice, 1_000e18);
        vm.prank(alice);
        feeToken.approve(address(bridge), type(uint256).max);

        vm.expectEmit(true, true, true, true);
        emit VampBridge.Deposited(feeChainId, alice, bob, 90e18, 0); // 100e18 requested, 10% fee burned
        vm.prank(alice);
        uint256 nonce = bridge.deposit(feeChainId, 100e18, bob);

        assertEq(nonce, 0);
        assertEq(bridge.lockedBalance(feeChainId), 90e18);
        assertEq(feeToken.balanceOf(address(bridge)), 90e18);
    }

    // ---------------------------------------------------------------------
    // claim
    // ---------------------------------------------------------------------

    function test_claim_happyPath() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);

        bridge.claim(chainId, bob, 40e18, txHash, sig);

        assertEq(meme.balanceOf(bob), 40e18);
        assertEq(bridge.lockedBalance(chainId), 60e18);
        assertTrue(bridge.claimed(txHash));
    }

    function test_claim_callableByAnyone_fundsAlwaysGoToBoundToAddress() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);

        // A totally unrelated third party submits it — funds still land on `bob`.
        vm.prank(makeAddr("randomSubmitter"));
        bridge.claim(chainId, bob, 40e18, txHash, sig);

        assertEq(meme.balanceOf(bob), 40e18);
    }

    function test_claim_emitsEvent() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);

        vm.expectEmit(true, true, true, true);
        emit VampBridge.Claimed(chainId, bob, 40e18, txHash);
        bridge.claim(chainId, bob, 40e18, txHash, sig);
    }

    function test_claim_revertsOnReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);
        bridge.claim(chainId, bob, 40e18, txHash, sig);

        vm.expectRevert(VampBridge.AlreadyClaimed.selector);
        bridge.claim(chainId, bob, 40e18, txHash, sig);
    }

    function test_claim_revertsOnWrongSigner() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        uint256 attackerKey = 0xBADBAD;
        bytes memory sig = _signClaim(attackerKey, address(bridge), chainId, bob, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId, bob, 40e18, txHash, sig);
    }

    function test_claim_revertsIfToTampered() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);

        // Signature was for `bob`; try to redirect to `alice`.
        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId, alice, 40e18, txHash, sig);
    }

    function test_claim_revertsIfAmountTampered() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId, bob, 41e18, txHash, sig);
    }

    function test_claim_revertsIfChainIdTampered() public {
        // Second chain, funded with its own locked balance, so the tampered
        // claim below fails on signature mismatch specifically — not merely
        // because the target chain happens to have insufficient funds.
        MockERC20 meme2 = new MockERC20("Other Base", "OTH", 18);
        usdc.mint(bob, ANNUAL_FEE);
        vm.prank(bob);
        usdc.approve(address(registry), ANNUAL_FEE);
        vm.prank(bob);
        uint256 chainId2 = registry.createChain(address(meme2), "Other", "OTH");
        meme2.mint(bob, 100e18);
        vm.prank(bob);
        meme2.approve(address(bridge), type(uint256).max);
        vm.prank(bob);
        bridge.deposit(chainId2, 100e18, bob);

        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId2, bob, 40e18, txHash, sig);
    }

    function test_claim_revertsIfTxHashTampered() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId, bob, 40e18, keccak256("tx2"), sig);
    }

    /// @notice A signature valid for a DIFFERENT VampBridge deployment must
    /// not be replayable here — proves the domain separator's
    /// `verifyingContract` binding actually does its job.
    function test_claim_revertsOnCrossContractReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        address otherBridgeAddress = makeAddr("otherBridge");
        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _signClaim(signerKey, otherBridgeAddress, chainId, bob, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId, bob, 40e18, txHash, sig);
    }

    /// @notice Same idea for chainId — a signature produced for a different
    /// EVM chain (e.g. mainnet vs. a testnet) must not replay here.
    function test_claim_revertsOnCrossChainReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes32 structHash = keccak256(abi.encode(bridge.CLAIM_TYPEHASH(), chainId, bob, uint256(40e18), txHash));
        bytes32 wrongChainDomain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("VampBridge")), keccak256(bytes("1")), uint256(999999), address(bridge)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", wrongChainDomain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId, bob, 40e18, txHash, sig);
    }

    function test_claim_revertsWhenExceedsLocked() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 20e18, txHash);

        vm.expectRevert(VampBridge.InsufficientLocked.selector);
        bridge.claim(chainId, bob, 20e18, txHash, sig);
    }

    function test_claim_revertsOnZeroAmountOrRecipient() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory zeroAmountSig = _validSignature(chainId, bob, 0, txHash);
        vm.expectRevert(VampBridge.ZeroAmount.selector);
        bridge.claim(chainId, bob, 0, txHash, zeroAmountSig);

        bytes memory zeroToSig = _validSignature(chainId, address(0), 1e18, txHash);
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        bridge.claim(chainId, address(0), 1e18, txHash, zeroToSig);
    }

    function test_claim_revertsWhenPaused() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);
        vm.prank(owner);
        bridge.setPaused(true);

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 1e18, txHash);

        vm.expectRevert(VampBridge.BridgePaused.selector);
        bridge.claim(chainId, bob, 1e18, txHash, sig);
    }

    /// @notice The whole point of a lock-and-mint bridge: users must be able
    /// to redeem locked collateral even after the vampchain itself has been
    /// torn down for lack of funding. `claim` must not depend on
    /// registry.isActive().
    function test_claim_worksAfterChainDeactivated() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.warp(block.timestamp + YEAR + 1);
        registry.deactivateIfDepleted(chainId);
        assertFalse(registry.isActive(chainId));

        bytes32 txHash = keccak256("tx1");
        bytes memory sig = _validSignature(chainId, bob, 40e18, txHash);
        bridge.claim(chainId, bob, 40e18, txHash, sig);
        assertEq(meme.balanceOf(bob), 40e18);
    }

    // ---------------------------------------------------------------------
    // owner admin
    // ---------------------------------------------------------------------

    function test_setSigner_onlyOwner() public {
        vm.expectRevert();
        vm.prank(alice);
        bridge.setSigner(bob);
    }

    function test_setSigner_updatesAndOldSignatureNoLongerValid() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        bytes32 txHash = keccak256("tx1");
        bytes memory oldSig = _validSignature(chainId, bob, 1e18, txHash);

        vm.prank(owner);
        bridge.setSigner(makeAddr("newSigner"));

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claim(chainId, bob, 1e18, txHash, oldSig);
    }

    function test_setSigner_revertsOnZero() public {
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        vm.prank(owner);
        bridge.setSigner(address(0));
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
        VampBridge evilBridge = new VampBridge(address(evilRegistry), signer, owner);

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

    function testFuzz_depositClaim_roundTrip(uint96 depositAmount, uint96 claimAmount) public {
        vm.assume(depositAmount > 0 && depositAmount < 1_000_000_000e18);
        vm.assume(claimAmount > 0 && claimAmount <= depositAmount);

        meme.mint(alice, depositAmount);
        vm.prank(alice);
        bridge.deposit(chainId, depositAmount, alice);

        bytes32 txHash = keccak256(abi.encode(depositAmount, claimAmount));
        bytes memory sig = _validSignature(chainId, bob, claimAmount, txHash);
        bridge.claim(chainId, bob, claimAmount, txHash, sig);

        assertEq(meme.balanceOf(bob), claimAmount);
        assertEq(bridge.lockedBalance(chainId), depositAmount - claimAmount);
    }
}
