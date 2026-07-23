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
    MockERC20 internal randomToken;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal runwayTreasury = makeAddr("runwayTreasury");
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
        registry = new VampChainRegistry(address(usdc), ANNUAL_FEE, treasury, runwayTreasury, owner);
        bridge = new VampBridge(address(registry), signer, owner);

        usdc.mint(alice, 1_000_000e6);
        vm.prank(alice);
        usdc.approve(address(registry), type(uint256).max);
        vm.prank(alice);
        chainId = registry.createChain(address(meme), "Dogeblock", "DOGB");

        meme.mint(alice, 1_000_000e18);
        vm.prank(alice);
        meme.approve(address(bridge), type(uint256).max);

        randomToken = new MockERC20("Random Token", "RND", 8);
        randomToken.mint(alice, 1_000_000e8);
        vm.prank(alice);
        randomToken.approve(address(bridge), type(uint256).max);
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

    function _signClaimToken(
        uint256 pk,
        address verifyingContract,
        uint256 vampChainId,
        address token,
        address to,
        uint256 amount,
        bytes32 sidechainTxHash
    ) internal view returns (bytes memory signature) {
        bytes32 structHash = keccak256(
            abi.encode(bridge.CLAIM_TOKEN_TYPEHASH(), vampChainId, token, to, amount, sidechainTxHash)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifyingContract), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _validTokenSignature(uint256 vampChainId, address token, address to, uint256 amount, bytes32 txHash)
        internal
        view
        returns (bytes memory)
    {
        return _signClaimToken(signerKey, address(bridge), vampChainId, token, to, amount, txHash);
    }

    function _signClaimSwept(
        uint256 pk,
        address verifyingContract,
        uint256 vampChainId,
        uint256 amount,
        bytes32 sidechainTxHash
    ) internal view returns (bytes memory signature) {
        bytes32 structHash = keccak256(abi.encode(bridge.CLAIM_SWEPT_TYPEHASH(), vampChainId, amount, sidechainTxHash));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifyingContract), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _validSweptSignature(uint256 vampChainId, uint256 amount, bytes32 sidechainTxHash)
        internal
        view
        returns (bytes memory)
    {
        return _signClaimSwept(signerKey, address(bridge), vampChainId, amount, sidechainTxHash);
    }

    function _signBurnedFees(
        uint256 pk,
        address verifyingContract,
        uint256 vampChainId,
        uint256 cumulativeBurned,
        uint256 asOfBlock
    ) internal view returns (bytes memory signature) {
        bytes32 structHash =
            keccak256(abi.encode(bridge.BURNED_FEES_TYPEHASH(), vampChainId, cumulativeBurned, asOfBlock));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifyingContract), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _validBurnedFeesSignature(uint256 vampChainId, uint256 cumulativeBurned, uint256 asOfBlock)
        internal
        view
        returns (bytes memory)
    {
        return _signBurnedFees(signerKey, address(bridge), vampChainId, cumulativeBurned, asOfBlock);
    }

    function _signSnapshot(uint256 pk, address verifyingContract, uint256 vampChainId, bytes32 root)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 structHash = keccak256(abi.encode(bridge.SNAPSHOT_TYPEHASH(), vampChainId, root));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(verifyingContract), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _validSnapshotSignature(uint256 vampChainId, bytes32 root) internal view returns (bytes memory) {
        return _signSnapshot(signerKey, address(bridge), vampChainId, root);
    }

    /// @notice Must match VampBridge.sol's leaf/pair-hashing exactly:
    /// double-hashed leaves (OZ-style second-preimage mitigation) and
    /// sorted-pair internal nodes (solady's MerkleProofLib convention).
    function _leaf(uint256 vampChainId, address token, address to, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(vampChainId, token, to, amount))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
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
        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
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

        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);
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
        VampChainRegistry evilRegistry = new VampChainRegistry(address(feeToken), ANNUAL_FEE, treasury, runwayTreasury, owner);
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

    // ---------------------------------------------------------------------
    // general ERC20 bridging: depositToken / claimToken
    // ---------------------------------------------------------------------

    function test_depositToken_happyPath() public {
        vm.prank(alice);
        uint256 nonce = bridge.depositToken(chainId, address(randomToken), 100e8, bob);

        assertEq(nonce, 0);
        assertEq(bridge.lockedBalanceGeneral(chainId, address(randomToken)), 100e8);
        assertEq(randomToken.balanceOf(address(bridge)), 100e8);
    }

    function test_depositToken_emitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit VampBridge.DepositedToken(chainId, address(randomToken), bob, alice, 100e8, 0);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, bob);
    }

    function test_depositToken_revertsIfTokenIsBaseToken() public {
        vm.expectRevert(VampBridge.TokenIsBaseToken.selector);
        vm.prank(alice);
        bridge.depositToken(chainId, address(meme), 100e18, bob);
    }

    function test_depositToken_revertsOnZeroAmount() public {
        vm.expectRevert(VampBridge.ZeroAmount.selector);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 0, bob);
    }

    function test_depositToken_revertsOnZeroRecipient() public {
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 1e8, address(0));
    }

    function test_depositToken_revertsOnInactiveChain() public {
        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        vm.expectRevert(VampBridge.ChainNotActive.selector);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 1e8, bob);
    }

    function test_depositToken_revertsWhenPaused() public {
        vm.prank(owner);
        bridge.setPaused(true);
        vm.expectRevert(VampBridge.BridgePaused.selector);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 1e8, bob);
    }

    /// @notice Two different tokens for the same chain must not share
    /// accounting, and neither must clash with the native-token mapping.
    function test_depositToken_accountsSeparatelyPerToken() public {
        MockERC20 second = new MockERC20("Second Token", "SEC", 18);
        second.mint(alice, 100e18);
        vm.prank(alice);
        second.approve(address(bridge), type(uint256).max);

        vm.prank(alice);
        bridge.deposit(chainId, 5e18, alice); // native path
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 10e8, alice);
        vm.prank(alice);
        bridge.depositToken(chainId, address(second), 20e18, alice);

        assertEq(bridge.lockedBalance(chainId), 5e18);
        assertEq(bridge.lockedBalanceGeneral(chainId, address(randomToken)), 10e8);
        assertEq(bridge.lockedBalanceGeneral(chainId, address(second)), 20e18);
    }

    function test_depositToken_feeOnTransferToken_creditsActualAmountReceived() public {
        MockFeeOnTransferERC20 feeToken = new MockFeeOnTransferERC20("Fee Token", "FEE", 18, 1_000); // 10% fee
        feeToken.mint(alice, 1_000e18);
        vm.prank(alice);
        feeToken.approve(address(bridge), type(uint256).max);

        vm.prank(alice);
        uint256 nonce = bridge.depositToken(chainId, address(feeToken), 100e18, bob);

        assertEq(nonce, 0);
        assertEq(bridge.lockedBalanceGeneral(chainId, address(feeToken)), 90e18);
        assertEq(feeToken.balanceOf(address(bridge)), 90e18);
    }

    function test_claimToken_happyPath() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);

        assertEq(randomToken.balanceOf(bob), 40e8);
        assertEq(bridge.lockedBalanceGeneral(chainId, address(randomToken)), 60e8);
        assertTrue(bridge.claimed(txHash));
    }

    function test_claimToken_callableByAnyone_fundsAlwaysGoToBoundToAddress() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);

        vm.prank(makeAddr("randomSubmitter"));
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);

        assertEq(randomToken.balanceOf(bob), 40e8);
    }

    function test_claimToken_emitsEvent() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectEmit(true, true, true, true);
        emit VampBridge.ClaimedToken(chainId, address(randomToken), bob, 40e8, txHash);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);
    }

    function test_claimToken_revertsOnReplay() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);

        vm.expectRevert(VampBridge.AlreadyClaimed.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);
    }

    function test_claimToken_revertsOnWrongSigner() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        uint256 attackerKey = 0xBADBAD;
        bytes memory sig = _signClaimToken(attackerKey, address(bridge), chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);
    }

    function test_claimToken_revertsIfTokenTampered() public {
        MockERC20 second = new MockERC20("Second Token", "SEC", 18);
        second.mint(alice, 100e18);
        vm.prank(alice);
        second.approve(address(bridge), type(uint256).max);
        vm.prank(alice);
        bridge.depositToken(chainId, address(second), 100e18, alice);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        // Signature was minted for `randomToken`; try to redeem `second` with it.
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId, address(second), bob, 40e8, txHash, sig);
    }

    function test_claimToken_revertsIfToTampered() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId, address(randomToken), alice, 40e8, txHash, sig);
    }

    function test_claimToken_revertsIfAmountTampered() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 41e8, txHash, sig);
    }

    function test_claimToken_revertsIfChainIdTampered() public {
        MockERC20 meme2 = new MockERC20("Other Base", "OTH", 18);
        usdc.mint(bob, ANNUAL_FEE);
        vm.prank(bob);
        usdc.approve(address(registry), ANNUAL_FEE);
        vm.prank(bob);
        uint256 chainId2 = registry.createChain(address(meme2), "Other", "OTH");

        randomToken.mint(bob, 100e8);
        vm.prank(bob);
        randomToken.approve(address(bridge), type(uint256).max);
        vm.prank(bob);
        bridge.depositToken(chainId2, address(randomToken), 100e8, bob);

        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId2, address(randomToken), bob, 40e8, txHash, sig);
    }

    function test_claimToken_revertsIfTxHashTampered() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, keccak256("wtok2"), sig);
    }

    /// @notice A `claim` (native) signature must never be redeemable via
    /// `claimToken`, and vice versa — proves the distinct typehashes
    /// actually isolate the two message spaces, not just the two functions'
    /// argument-level checks.
    function test_claimToken_revertsOnCrossPathReplayFromNativeClaim() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        // Deposit enough raw randomToken units to exceed the 40e18 claim
        // amount below (in real units that'd be an absurd amount of an
        // 8-decimal token, but the contract only deals in raw uint256
        // units — the point here is isolating the InvalidSignature check,
        // not modeling a realistic deposit).
        randomToken.mint(alice, 1_000e18);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 1_000e18, alice);

        bytes32 txHash = keccak256("shared-hash");
        bytes memory nativeSig = _validSignature(chainId, bob, 40e18, txHash);

        // Same signer, same chain, same recipient, same tx hash — but a
        // native `claim` signature, not a `claimToken` one.
        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 40e18, txHash, nativeSig);
    }

    function test_claimToken_revertsOnCrossContractReplay() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        address otherBridgeAddress = makeAddr("otherBridge");
        bytes32 txHash = keccak256("wtok1");
        bytes memory sig =
            _signClaimToken(signerKey, otherBridgeAddress, chainId, address(randomToken), bob, 40e8, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);
    }

    function test_claimToken_revertsWhenExceedsLocked() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 10e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 20e8, txHash);

        vm.expectRevert(VampBridge.InsufficientLocked.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 20e8, txHash, sig);
    }

    function test_claimToken_revertsOnZeroAmountOrRecipient() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 10e8, alice);

        bytes32 txHash = keccak256("wtok1");
        bytes memory zeroAmountSig = _validTokenSignature(chainId, address(randomToken), bob, 0, txHash);
        vm.expectRevert(VampBridge.ZeroAmount.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 0, txHash, zeroAmountSig);

        bytes memory zeroToSig = _validTokenSignature(chainId, address(randomToken), address(0), 1e8, txHash);
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        bridge.claimToken(chainId, address(randomToken), address(0), 1e8, txHash, zeroToSig);
    }

    function test_claimToken_revertsWhenPaused() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 10e8, alice);
        vm.prank(owner);
        bridge.setPaused(true);

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 1e8, txHash);

        vm.expectRevert(VampBridge.BridgePaused.selector);
        bridge.claimToken(chainId, address(randomToken), bob, 1e8, txHash, sig);
    }

    function test_claimToken_worksAfterChainDeactivated() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);
        assertFalse(registry.isActive(chainId));

        bytes32 txHash = keccak256("wtok1");
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, 40e8, txHash);
        bridge.claimToken(chainId, address(randomToken), bob, 40e8, txHash, sig);
        assertEq(randomToken.balanceOf(bob), 40e8);
    }

    function testFuzz_depositTokenClaimToken_roundTrip(uint96 depositAmount, uint96 claimAmount) public {
        vm.assume(depositAmount > 0 && depositAmount < 1_000_000_000e8);
        vm.assume(claimAmount > 0 && claimAmount <= depositAmount);

        randomToken.mint(alice, depositAmount);
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), depositAmount, alice);

        bytes32 txHash = keccak256(abi.encode("fuzz", depositAmount, claimAmount));
        bytes memory sig = _validTokenSignature(chainId, address(randomToken), bob, claimAmount, txHash);
        bridge.claimToken(chainId, address(randomToken), bob, claimAmount, txHash, sig);

        assertEq(randomToken.balanceOf(bob), claimAmount);
        assertEq(bridge.lockedBalanceGeneral(chainId, address(randomToken)), depositAmount - claimAmount);
    }

    // ---------------------------------------------------------------------
    // protocol fee revenue: claimSwept (tips)
    // ---------------------------------------------------------------------

    function test_claimSwept_happyPath_splitsThreeWaysWithCreatorAndRunway() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice); // alice is also this chain's creator

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 90e18, txHash);

        (uint256 toProtocol, uint256 toCreator, uint256 toRunway) = bridge.claimSwept(chainId, 90e18, txHash, sig);

        assertEq(toProtocol, 30e18);
        assertEq(toCreator, 30e18);
        assertEq(toRunway, 30e18);
        assertEq(meme.balanceOf(treasury), 30e18);
        assertEq(meme.balanceOf(runwayTreasury), 30e18);
        assertEq(meme.balanceOf(alice), 1_000_000e18 - 100e18 + 30e18); // minted, deposited, then paid back their share
        assertEq(bridge.lockedBalance(chainId), 10e18);
        assertTrue(bridge.claimed(txHash));
    }

    function test_claimSwept_oddAmount_runwayGetsExtraUnits() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("sweep-odd");
        bytes memory sig = _validSweptSignature(chainId, 7, txHash);

        (uint256 toProtocol, uint256 toCreator, uint256 toRunway) = bridge.claimSwept(chainId, 7, txHash, sig);

        assertEq(toCreator, 2);
        assertEq(toProtocol, 2);
        assertEq(toRunway, 3);
    }

    function test_claimSwept_emitsEvent() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 90e18, txHash);

        vm.expectEmit(true, true, true, true);
        emit VampBridge.SweptClaimed(chainId, 30e18, 30e18, 30e18, txHash);
        bridge.claimSwept(chainId, 90e18, txHash, sig);
    }

    function test_claimSwept_callableByAnyone() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 90e18, txHash);

        vm.prank(makeAddr("randomSubmitter"));
        bridge.claimSwept(chainId, 90e18, txHash, sig);

        assertEq(meme.balanceOf(treasury), 30e18);
        assertEq(meme.balanceOf(runwayTreasury), 30e18);
    }

    function test_claimSwept_revertsOnReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 40e18, txHash);
        bridge.claimSwept(chainId, 40e18, txHash, sig);

        vm.expectRevert(VampBridge.AlreadyClaimed.selector);
        bridge.claimSwept(chainId, 40e18, txHash, sig);
    }

    /// @notice A tip-sweep tx hash and a normal user-withdrawal tx hash share
    /// the same `claimed` mapping by design — proves a `claim()` signature
    /// can't be replayed through `claimSwept` (distinct typehash) even if
    /// someone reused the same sidechainTxHash value across both.
    function test_claimSwept_revertsOnCrossPathReplayFromNormalClaim() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("shared-hash");
        bytes memory normalSig = _validSignature(chainId, bob, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimSwept(chainId, 40e18, txHash, normalSig);
    }

    function test_claimSwept_revertsOnWrongSigner() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("sweep1");
        uint256 attackerKey = 0xBADBAD;
        bytes memory sig = _signClaimSwept(attackerKey, address(bridge), chainId, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimSwept(chainId, 40e18, txHash, sig);
    }

    function test_claimSwept_revertsIfAmountTampered() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimSwept(chainId, 41e18, txHash, sig);
    }

    function test_claimSwept_revertsIfChainIdTampered() public {
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

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimSwept(chainId2, 40e18, txHash, sig);
    }

    function test_claimSwept_revertsOnCrossContractReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        address otherBridgeAddress = makeAddr("otherBridge");
        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _signClaimSwept(signerKey, otherBridgeAddress, chainId, 40e18, txHash);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimSwept(chainId, 40e18, txHash, sig);
    }

    function test_claimSwept_revertsWhenExceedsLocked() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 20e18, txHash);

        vm.expectRevert(VampBridge.InsufficientLocked.selector);
        bridge.claimSwept(chainId, 20e18, txHash, sig);
    }

    function test_claimSwept_revertsOnZeroAmount() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 0, txHash);

        vm.expectRevert(VampBridge.ZeroAmount.selector);
        bridge.claimSwept(chainId, 0, txHash, sig);
    }

    function test_claimSwept_revertsWhenPaused() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);
        vm.prank(owner);
        bridge.setPaused(true);

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 1e18, txHash);

        vm.expectRevert(VampBridge.BridgePaused.selector);
        bridge.claimSwept(chainId, 1e18, txHash, sig);
    }

    function test_claimSwept_worksAfterChainDeactivated() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);
        assertFalse(registry.isActive(chainId));

        bytes32 txHash = keccak256("sweep1");
        bytes memory sig = _validSweptSignature(chainId, 90e18, txHash);
        bridge.claimSwept(chainId, 90e18, txHash, sig);

        assertEq(meme.balanceOf(treasury), 30e18);
    }

    // ---------------------------------------------------------------------
    // protocol fee revenue: claimBurnedFees (base fee)
    // ---------------------------------------------------------------------

    function test_claimBurnedFees_happyPath_splitsThreeWaysWithCreatorAndRunway() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, 90e18, 12345);
        (uint256 toProtocol, uint256 toCreator, uint256 toRunway) = bridge.claimBurnedFees(chainId, 90e18, 12345, sig);

        assertEq(toProtocol, 30e18);
        assertEq(toCreator, 30e18);
        assertEq(toRunway, 30e18);
        assertEq(meme.balanceOf(treasury), 30e18);
        assertEq(meme.balanceOf(runwayTreasury), 30e18);
        assertEq(bridge.lockedBalance(chainId), 10e18);
        assertEq(bridge.burnedFeesClaimed(chainId), 90e18);
    }

    function test_claimBurnedFees_emitsEvent() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, 90e18, 12345);

        vm.expectEmit(true, true, true, true);
        emit VampBridge.BurnedFeesClaimed(chainId, 30e18, 30e18, 30e18, 90e18, 12345);
        bridge.claimBurnedFees(chainId, 90e18, 12345, sig);
    }

    /// @notice Only the increment over what's already been claimed gets
    /// paid out — the core "linear, exact, never double-pay" property.
    function test_claimBurnedFees_onlyPaysIncrementOnRepeatedCalls() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes memory sig1 = _validBurnedFeesSignature(chainId, 40e18, 100);
        bridge.claimBurnedFees(chainId, 40e18, 100, sig1);
        assertEq(bridge.lockedBalance(chainId), 60e18);

        bytes memory sig2 = _validBurnedFeesSignature(chainId, 55e18, 200);
        (uint256 toProtocol, uint256 toCreator, uint256 toRunway) = bridge.claimBurnedFees(chainId, 55e18, 200, sig2);

        assertEq(toProtocol + toCreator + toRunway, 15e18); // only the new 15e18 increment, not the full 55e18 again
        assertEq(bridge.lockedBalance(chainId), 45e18);
        assertEq(bridge.burnedFeesClaimed(chainId), 55e18);
    }

    /// @notice A stale or equal attestation is a harmless no-op revert, not
    /// a double-pay — proves resubmission safety.
    function test_claimBurnedFees_revertsOnStaleOrEqualAttestation() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, 40e18, 100);
        bridge.claimBurnedFees(chainId, 40e18, 100, sig);

        vm.expectRevert(VampBridge.NothingToClaim.selector);
        bridge.claimBurnedFees(chainId, 40e18, 100, sig);

        bytes memory staleSig = _validBurnedFeesSignature(chainId, 30e18, 50);
        vm.expectRevert(VampBridge.NothingToClaim.selector);
        bridge.claimBurnedFees(chainId, 30e18, 50, staleSig);
    }

    /// @notice A miscomputed attestation claiming more than is actually
    /// locked gets clamped to what's available rather than reverting or
    /// over-draining — the ceiling is defensive, not a hard failure.
    function test_claimBurnedFees_clampsToAvailableLockedBalance() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, 40e18, 100);
        (uint256 toProtocol, uint256 toCreator, uint256 toRunway) = bridge.claimBurnedFees(chainId, 40e18, 100, sig);

        assertEq(toProtocol + toCreator + toRunway, 10e18);
        assertEq(bridge.lockedBalance(chainId), 0);
        assertEq(bridge.burnedFeesClaimed(chainId), 10e18); // only what was actually paid, not the full 40e18 attested

        // A later, higher attestation can still collect the remainder once
        // more balance becomes available.
        meme.mint(alice, 100e18);
        vm.prank(alice);
        bridge.deposit(chainId, 20e18, alice);

        bytes memory sig2 = _validBurnedFeesSignature(chainId, 40e18, 200);
        (uint256 toProtocol2, uint256 toCreator2, uint256 toRunway2) = bridge.claimBurnedFees(chainId, 40e18, 200, sig2);
        assertEq(toProtocol2 + toCreator2 + toRunway2, 20e18);
        assertEq(bridge.burnedFeesClaimed(chainId), 30e18);
    }

    function test_claimBurnedFees_callableByAnyone() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, 90e18, 100);
        vm.prank(makeAddr("randomSubmitter"));
        bridge.claimBurnedFees(chainId, 90e18, 100, sig);

        assertEq(meme.balanceOf(treasury), 30e18);
    }

    function test_claimBurnedFees_revertsOnWrongSigner() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        uint256 attackerKey = 0xBADBAD;
        bytes memory sig = _signBurnedFees(attackerKey, address(bridge), chainId, 40e18, 100);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimBurnedFees(chainId, 40e18, 100, sig);
    }

    function test_claimBurnedFees_revertsIfCumulativeTampered() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, 40e18, 100);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimBurnedFees(chainId, 41e18, 100, sig);
    }

    function test_claimBurnedFees_revertsIfAsOfBlockTampered() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, 40e18, 100);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimBurnedFees(chainId, 40e18, 101, sig);
    }

    function test_claimBurnedFees_revertsIfChainIdTampered() public {
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

        bytes memory sig = _validBurnedFeesSignature(chainId, 40e18, 100);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimBurnedFees(chainId2, 40e18, 100, sig);
    }

    function test_claimBurnedFees_revertsOnCrossContractReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        address otherBridgeAddress = makeAddr("otherBridge");
        bytes memory sig = _signBurnedFees(signerKey, otherBridgeAddress, chainId, 40e18, 100);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.claimBurnedFees(chainId, 40e18, 100, sig);
    }

    function test_claimBurnedFees_revertsWhenPaused() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        vm.prank(owner);
        bridge.setPaused(true);

        bytes memory sig = _validBurnedFeesSignature(chainId, 40e18, 100);

        vm.expectRevert(VampBridge.BridgePaused.selector);
        bridge.claimBurnedFees(chainId, 40e18, 100, sig);
    }

    function test_claimBurnedFees_worksAfterChainDeactivated() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);
        assertFalse(registry.isActive(chainId));

        bytes memory sig = _validBurnedFeesSignature(chainId, 90e18, 100);
        bridge.claimBurnedFees(chainId, 90e18, 100, sig);

        assertEq(meme.balanceOf(treasury), 30e18);
    }

    function testFuzz_claimBurnedFees_neverExceedsLockedBalance(uint96 depositAmount, uint96 cumulativeBurned)
        public
    {
        vm.assume(depositAmount > 0 && depositAmount < 1_000_000_000e18);

        meme.mint(alice, depositAmount);
        vm.prank(alice);
        bridge.deposit(chainId, depositAmount, alice);

        bytes memory sig = _validBurnedFeesSignature(chainId, cumulativeBurned, 1);
        if (cumulativeBurned == 0) {
            vm.expectRevert(VampBridge.NothingToClaim.selector);
            bridge.claimBurnedFees(chainId, cumulativeBurned, 1, sig);
            return;
        }

        (uint256 toProtocol, uint256 toCreator, uint256 toRunway) = bridge.claimBurnedFees(chainId, cumulativeBurned, 1, sig);
        assertLe(toProtocol + toCreator + toRunway, depositAmount);
        assertGe(bridge.lockedBalance(chainId), 0);
    }

    // ---------------------------------------------------------------------
    // snapshot claims: publishSnapshot / claimSnapshot / sweepUnclaimed
    // ---------------------------------------------------------------------

    function test_publishSnapshot_happyPath() public {
        bytes32 leaf = _leaf(chainId, address(0), bob, 40e18);
        bytes memory sig = _validSnapshotSignature(chainId, leaf);

        bridge.publishSnapshot(chainId, leaf, sig);

        assertEq(bridge.snapshotRoot(chainId), leaf);
        assertEq(bridge.snapshotPublishedAt(chainId), block.timestamp);
    }

    function test_publishSnapshot_emitsEvent() public {
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bytes memory sig = _validSnapshotSignature(chainId, root);

        vm.expectEmit(true, true, true, true);
        emit VampBridge.SnapshotPublished(chainId, root, block.timestamp);
        bridge.publishSnapshot(chainId, root, sig);
    }

    function test_publishSnapshot_callableByAnyone() public {
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bytes memory sig = _validSnapshotSignature(chainId, root);

        vm.prank(makeAddr("randomSubmitter"));
        bridge.publishSnapshot(chainId, root, sig);
        assertEq(bridge.snapshotRoot(chainId), root);
    }

    function test_publishSnapshot_revertsOnWrongSigner() public {
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        uint256 attackerKey = 0xBADBAD;
        bytes memory sig = _signSnapshot(attackerKey, address(bridge), chainId, root);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.publishSnapshot(chainId, root, sig);
    }

    function test_publishSnapshot_revertsOnZeroRoot() public {
        bytes memory sig = _validSnapshotSignature(chainId, bytes32(0));
        vm.expectRevert(VampBridge.NoSnapshot.selector);
        bridge.publishSnapshot(chainId, bytes32(0), sig);
    }

    function test_publishSnapshot_revertsIfAlreadyPublished() public {
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bytes memory sig = _validSnapshotSignature(chainId, root);
        bridge.publishSnapshot(chainId, root, sig);

        bytes32 otherRoot = _leaf(chainId, address(0), bob, 41e18);
        bytes memory otherSig = _validSnapshotSignature(chainId, otherRoot);
        vm.expectRevert(VampBridge.SnapshotAlreadyPublished.selector);
        bridge.publishSnapshot(chainId, otherRoot, otherSig);
    }

    function test_publishSnapshot_revertsIfChainIdTampered() public {
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bytes memory sig = _validSnapshotSignature(chainId, root);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.publishSnapshot(chainId + 1, root, sig);
    }

    function test_publishSnapshot_revertsOnCrossContractReplay() public {
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        address otherBridgeAddress = makeAddr("otherBridge");
        bytes memory sig = _signSnapshot(signerKey, otherBridgeAddress, chainId, root);

        vm.expectRevert(VampBridge.InvalidSignature.selector);
        bridge.publishSnapshot(chainId, root, sig);
    }

    function test_claimSnapshot_happyPath_nativeToken_singleLeafTree() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        // Single-leaf tree: root == leaf, empty proof.
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));

        assertEq(meme.balanceOf(bob), 40e18);
        assertEq(bridge.lockedBalance(chainId), 60e18);
        assertTrue(bridge.snapshotClaimed(chainId, address(0), bob));
    }

    function test_claimSnapshot_happyPath_wrappedToken() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);

        bytes32 root = _leaf(chainId, address(randomToken), bob, 40e8);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        bridge.claimSnapshot(chainId, address(randomToken), bob, 40e8, new bytes32[](0));

        assertEq(randomToken.balanceOf(bob), 40e8);
        assertEq(bridge.lockedBalanceGeneral(chainId, address(randomToken)), 60e8);
    }

    /// @notice Two-leaf tree — proves a real (non-empty, non-degenerate)
    /// Merkle proof actually verifies both ways.
    function test_claimSnapshot_twoLeafTree_bothLeavesClaimable() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);

        bytes32 leafBob = _leaf(chainId, address(0), bob, 30e18);
        bytes32 leafAlice = _leaf(chainId, address(0), alice, 20e18);
        bytes32 root = _hashPair(leafBob, leafAlice);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        bytes32[] memory proofForBob = new bytes32[](1);
        proofForBob[0] = leafAlice;
        bridge.claimSnapshot(chainId, address(0), bob, 30e18, proofForBob);
        assertEq(meme.balanceOf(bob), 30e18);

        bytes32[] memory proofForAlice = new bytes32[](1);
        proofForAlice[0] = leafBob;
        uint256 aliceBalBefore = meme.balanceOf(alice);
        bridge.claimSnapshot(chainId, address(0), alice, 20e18, proofForAlice);
        assertEq(meme.balanceOf(alice), aliceBalBefore + 20e18);

        assertEq(bridge.lockedBalance(chainId), 50e18);
    }

    /// @notice Four-leaf tree — proves a multi-step proof (more than one
    /// sibling to consume) verifies correctly, not just the degenerate
    /// single-pair case.
    function test_claimSnapshot_fourLeafTree_multiStepProof() public {
        vm.prank(alice);
        bridge.deposit(chainId, 400e18, alice);

        address carol = makeAddr("carol");
        address dave = makeAddr("dave");

        bytes32 l0 = _leaf(chainId, address(0), alice, 10e18);
        bytes32 l1 = _leaf(chainId, address(0), bob, 20e18);
        bytes32 l2 = _leaf(chainId, address(0), carol, 30e18);
        bytes32 l3 = _leaf(chainId, address(0), dave, 40e18);
        bytes32 n0 = _hashPair(l0, l1);
        bytes32 n1 = _hashPair(l2, l3);
        bytes32 root = _hashPair(n0, n1);

        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        bytes32[] memory proofForCarol = new bytes32[](2);
        proofForCarol[0] = l3;
        proofForCarol[1] = n0;
        bridge.claimSnapshot(chainId, address(0), carol, 30e18, proofForCarol);
        assertEq(meme.balanceOf(carol), 30e18);

        bytes32[] memory proofForDave = new bytes32[](2);
        proofForDave[0] = l2;
        proofForDave[1] = n0;
        bridge.claimSnapshot(chainId, address(0), dave, 40e18, proofForDave);
        assertEq(meme.balanceOf(dave), 40e18);
    }

    function test_claimSnapshot_emitsEvent() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.expectEmit(true, true, true, true);
        emit VampBridge.SnapshotClaimed(chainId, address(0), bob, 40e18);
        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));
    }

    function test_claimSnapshot_callableByAnyone_fundsAlwaysGoToBoundToAddress() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.prank(makeAddr("randomSubmitter"));
        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));
        assertEq(meme.balanceOf(bob), 40e18);
    }

    function test_claimSnapshot_revertsOnReplay() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));

        vm.expectRevert(VampBridge.AlreadyClaimed.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));
    }

    function test_claimSnapshot_revertsOnWrongAmount() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.expectRevert(VampBridge.InvalidProof.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 41e18, new bytes32[](0));
    }

    function test_claimSnapshot_revertsOnWrongRecipient() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.expectRevert(VampBridge.InvalidProof.selector);
        bridge.claimSnapshot(chainId, address(0), alice, 40e18, new bytes32[](0));
    }

    function test_claimSnapshot_revertsOnWrongToken() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);
        bytes32 root = _leaf(chainId, address(randomToken), bob, 40e8);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        // Same chainId/to/amount, but claiming against the native path
        // instead of the wrapped token the leaf was actually built for.
        vm.expectRevert(VampBridge.InvalidProof.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 40e8, new bytes32[](0));
    }

    function test_claimSnapshot_revertsWithWrongProof() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 leafBob = _leaf(chainId, address(0), bob, 30e18);
        bytes32 leafAlice = _leaf(chainId, address(0), alice, 20e18);
        bytes32 root = _hashPair(leafBob, leafAlice);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        // Correct leaf, but a proof element that doesn't actually pair up to the root.
        bytes32[] memory wrongProof = new bytes32[](1);
        wrongProof[0] = keccak256("not a real sibling");
        vm.expectRevert(VampBridge.InvalidProof.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 30e18, wrongProof);
    }

    function test_claimSnapshot_revertsWhenNoSnapshotPublished() public {
        vm.expectRevert(VampBridge.NoSnapshot.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));
    }

    function test_claimSnapshot_revertsOnZeroAmountOrRecipient() public {
        bytes32 root = _leaf(chainId, address(0), bob, 0);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));
        vm.expectRevert(VampBridge.ZeroAmount.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 0, new bytes32[](0));

        bytes32 root2 = _leaf(chainId + 1, address(0), address(0), 1e18);
        bridge.publishSnapshot(chainId + 1, root2, _validSnapshotSignature(chainId + 1, root2));
        vm.expectRevert(VampBridge.ZeroAddress.selector);
        bridge.claimSnapshot(chainId + 1, address(0), address(0), 1e18, new bytes32[](0));
    }

    function test_claimSnapshot_revertsWhenExceedsLocked() public {
        vm.prank(alice);
        bridge.deposit(chainId, 10e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 20e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.expectRevert(VampBridge.InsufficientLocked.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 20e18, new bytes32[](0));
    }

    function test_claimSnapshot_revertsWhenPaused() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.prank(owner);
        bridge.setPaused(true);
        vm.expectRevert(VampBridge.BridgePaused.selector);
        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));
    }

    function test_claimSnapshot_worksAfterChainDeactivated() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        vm.warp(block.timestamp + YEAR + registry.GRACE_PERIOD() + 1);
        registry.deactivateIfGraceExpired(chainId);
        assertFalse(registry.isActive(chainId));

        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));
        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));
        assertEq(meme.balanceOf(bob), 40e18);
    }

    function testFuzz_claimSnapshot_roundTrip(uint96 depositAmount, uint96 claimAmount) public {
        vm.assume(depositAmount > 0 && depositAmount < 1_000_000_000e18);
        vm.assume(claimAmount > 0 && claimAmount <= depositAmount);

        meme.mint(alice, depositAmount);
        vm.prank(alice);
        bridge.deposit(chainId, depositAmount, alice);

        bytes32 root = _leaf(chainId, address(0), bob, claimAmount);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));
        bridge.claimSnapshot(chainId, address(0), bob, claimAmount, new bytes32[](0));

        assertEq(meme.balanceOf(bob), claimAmount);
        assertEq(bridge.lockedBalance(chainId), depositAmount - claimAmount);
    }

    // ---------------------------------------------------------------------
    // sweepUnclaimed
    // ---------------------------------------------------------------------

    function test_sweepUnclaimed_revertsBeforeWindowElapsed() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.expectRevert(VampBridge.ClaimWindowNotElapsed.selector);
        bridge.sweepUnclaimed(chainId, address(0));
    }

    function test_sweepUnclaimed_happyPath_afterWindowSweepsAllRemaining() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        // Bob claims his share before the window closes.
        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));

        vm.warp(block.timestamp + bridge.SNAPSHOT_CLAIM_WINDOW() + 1);
        uint256 swept = bridge.sweepUnclaimed(chainId, address(0));

        assertEq(swept, 60e18); // whatever bob never claimed
        assertEq(meme.balanceOf(treasury), 60e18);
        assertEq(bridge.lockedBalance(chainId), 0);
    }

    function test_sweepUnclaimed_wrappedToken() public {
        vm.prank(alice);
        bridge.depositToken(chainId, address(randomToken), 100e8, alice);
        bytes32 root = _leaf(chainId, address(randomToken), bob, 40e8);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.warp(block.timestamp + bridge.SNAPSHOT_CLAIM_WINDOW() + 1);
        uint256 swept = bridge.sweepUnclaimed(chainId, address(randomToken));

        assertEq(swept, 100e8);
        assertEq(randomToken.balanceOf(treasury), 100e8);
    }

    function test_sweepUnclaimed_callableByAnyone() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.warp(block.timestamp + bridge.SNAPSHOT_CLAIM_WINDOW() + 1);
        vm.prank(makeAddr("randomSubmitter"));
        bridge.sweepUnclaimed(chainId, address(0));
        assertEq(meme.balanceOf(treasury), 100e18);
    }

    function test_sweepUnclaimed_revertsWhenNoSnapshot() public {
        vm.expectRevert(VampBridge.NoSnapshot.selector);
        bridge.sweepUnclaimed(chainId, address(0));
    }

    function test_sweepUnclaimed_revertsOnZeroRemainingBalance() public {
        vm.prank(alice);
        bridge.deposit(chainId, 40e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        bridge.claimSnapshot(chainId, address(0), bob, 40e18, new bytes32[](0));

        vm.warp(block.timestamp + bridge.SNAPSHOT_CLAIM_WINDOW() + 1);
        vm.expectRevert(VampBridge.ZeroAmount.selector);
        bridge.sweepUnclaimed(chainId, address(0));
    }

    /// @notice Cross-implementation check: this exact root and these exact
    /// proofs were generated by `infra/provisioner/src/merkleTree.ts` (the
    /// real off-chain tree builder the provisioner uses to publish
    /// snapshots) for chainId=1 and this exact 5-leaf set — a 5-leaf tree
    /// specifically because it forces an odd-node-promotion at one level,
    /// not just the trivial power-of-two case every other test above uses.
    /// If solady's `MerkleProofLib` and the TS builder's hashing ever drift
    /// out of sync, this is what catches it — a bug here would otherwise
    /// only surface once a real chain tried to tear down for real.
    function test_claimSnapshot_matchesRealTypeScriptMerkleTreeBuilder() public {
        vm.prank(alice);
        bridge.deposit(chainId, 150e18, alice);

        bytes32 root = 0xd1abc48d62ef006c70cc69c5ad032bd7ca2d2a8f9babe01732653f0e984f7122;
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        address holder0 = 0x1111111111111111111111111111111111111111;
        bytes32[] memory proof0 = new bytes32[](3);
        proof0[0] = 0x2e1077e8cfe3acef9f6441e6fd5fc803166788e43a64cdff55340df404f50d9d;
        proof0[1] = 0x9423ca58899884ac6b3f3a30a103c8315acb25816ec245374ad9036a0d4adfc9;
        proof0[2] = 0x91e90b22299e7ce323a56089f85c535965b97202625ecb8a5cefbb103dcbc0ca;
        bridge.claimSnapshot(chainId, address(0), holder0, 10e18, proof0);
        assertEq(meme.balanceOf(holder0), 10e18);

        address holder4 = 0x6666666666666666666666666666666666666666;
        bytes32[] memory proof4 = new bytes32[](1);
        proof4[0] = 0xb9421a5724fcd847d970dfda5e405986aa50cd5cc21116843d71861b79ad442b;
        bridge.claimSnapshot(chainId, address(0), holder4, 50e18, proof4);
        assertEq(meme.balanceOf(holder4), 50e18);

        assertEq(bridge.lockedBalance(chainId), 150e18 - 10e18 - 50e18);
    }

    function test_sweepUnclaimed_emitsEvent() public {
        vm.prank(alice);
        bridge.deposit(chainId, 100e18, alice);
        bytes32 root = _leaf(chainId, address(0), bob, 40e18);
        bridge.publishSnapshot(chainId, root, _validSnapshotSignature(chainId, root));

        vm.warp(block.timestamp + bridge.SNAPSHOT_CLAIM_WINDOW() + 1);
        vm.expectEmit(true, true, true, true);
        emit VampBridge.UnclaimedSwept(chainId, address(0), 100e18);
        bridge.sweepUnclaimed(chainId, address(0));
    }
}
