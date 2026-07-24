// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {MerkleProofLib} from "solady/utils/MerkleProofLib.sol";
import {VampChainRegistry} from "./VampChainRegistry.sol";

/// @notice Minimal ERC20 balance probe — `balanceOf` is universally
/// implemented correctly even by non-standard tokens (USDT included), so
/// this carries none of the risk that non-standard `transfer`/`approve`
/// return values do.
interface IERC20BalanceOf {
    function balanceOf(address account) external view returns (uint256);
}

/// @title VampBridge
/// @notice Lock-and-mint / burn-and-claim bridge between the home chain and
/// every vampchain.
///
/// Deposit here locks a chain's base ERC20 and emits an event; an off-chain
/// relayer watches for it and mints the equivalent native balance on the
/// vampchain (a free operation on our own single-node sidechain — no
/// transaction, no gas). Withdrawals work the other way, and are
/// deliberately **pull-based**: the relayer watches for transfers to the
/// sidechain's burn address, and instead of submitting a release
/// transaction itself (which would mean the protocol pays L1 gas for every
/// withdrawal, forever), it signs an EIP-712 claim attesting to what
/// happened. Anyone can then submit that signature to `claim` — normally
/// the recipient themselves, from their own wallet, paying their own gas —
/// and the contract verifies the signature before releasing anything. The
/// relayer's claim-signing key therefore never needs to hold ETH or submit
/// a transaction at all; it only ever signs.
///
/// Trust model, stated plainly: this is a single trusted signer key, not a
/// light-client-verified or multisig-verified bridge. That is a deliberate
/// MVP tradeoff for a meme project, not an oversight — see
/// docs/ARCHITECTURE.md. `claim` is intentionally NOT gated on the chain
/// still being active: once a vampchain's funding runs out, its infra gets
/// torn down, but tokens users locked in this contract are still real and
/// must remain claimable independent of the sidechain's lifecycle (assuming
/// the signer attested to the burn before the chain was destroyed).
contract VampBridge is Ownable, ReentrancyGuard, EIP712 {
    using SafeTransferLib for address;

    VampChainRegistry public immutable registry;

    /// @notice The address whose EIP-712 signature authorizes a claim. Never
    /// needs ETH — it only ever signs off-chain, it doesn't submit
    /// transactions. Held by the same off-chain relayer service that mints
    /// deposits, kept under the same name for continuity with the deposit
    /// side, but its role here is "trusted attester", not "trusted sender".
    address public signer;
    bool public paused;
    uint256 public depositNonce;

    /// @notice Total base-token amount currently locked per chain (accounting
    /// ceiling for claims — a broken/malicious signer can never authorize
    /// releasing more than what's actually been deposited for that chain).
    mapping(uint256 => uint256) public lockedBalance;

    /// @notice Same accounting ceiling as `lockedBalance`, generalized to
    /// arbitrary tokens for the general-bridging path — see `depositToken`/
    /// `claimToken`. Keyed separately from `lockedBalance` (never the same
    /// mapping, even for the same token address) since a chain's base token
    /// always goes through the native-currency path, never this one — see
    /// `TokenIsBaseToken`.
    mapping(uint256 => mapping(address => uint256)) public lockedBalanceGeneral;

    /// @notice Sidechain burn tx hashes already claimed, to prevent replay.
    /// Shared between `claim` and `claimToken` — safe, since a native-burn
    /// tx hash and a wrapped-token-transfer tx hash can never collide (they
    /// come from genuinely distinct sidechain transactions).
    mapping(bytes32 => bool) public claimed;

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(uint256 vampChainId,address to,uint256 amount,bytes32 sidechainTxHash)");

    /// @notice Distinct typehash from CLAIM_TYPEHASH — includes `token` so a
    /// signature minted for one token/chain pair can never be replayed
    /// against another, even accidentally (different typehash means a
    /// completely different signed struct, not just different field values).
    bytes32 public constant CLAIM_TOKEN_TYPEHASH =
        keccak256("ClaimToken(uint256 vampChainId,address token,address to,uint256 amount,bytes32 sidechainTxHash)");

    event Deposited(
        uint256 indexed chainId, address indexed from, address indexed recipient, uint256 amount, uint256 nonce
    );
    event Claimed(uint256 indexed chainId, address indexed to, uint256 amount, bytes32 indexed sidechainTxHash);
    event DepositedToken(
        uint256 indexed chainId,
        address indexed token,
        address indexed recipient,
        address from,
        uint256 amount,
        uint256 nonce
    );
    event ClaimedToken(
        uint256 indexed chainId, address indexed token, address indexed to, uint256 amount, bytes32 sidechainTxHash
    );
    event SignerUpdated(address oldSigner, address newSigner);
    event PausedSet(bool paused);

    error ChainNotActive();
    error ZeroAmount();
    error ZeroAddress();
    error BridgePaused();
    error AlreadyClaimed();
    error InsufficientLocked();
    error InvalidSignature();
    error TokenIsBaseToken();

    modifier whenNotPaused() {
        if (paused) revert BridgePaused();
        _;
    }

    constructor(address registry_, address signer_, address owner_) {
        if (registry_ == address(0) || signer_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        registry = VampChainRegistry(registry_);
        signer = signer_;
        _initializeOwner(owner_);
    }

    function _domainNameAndVersion() internal pure override returns (string memory name, string memory version) {
        name = "VampBridge";
        version = "1";
    }

    /// @notice Lock `amount` of `chainId`'s base token, crediting `recipient`
    /// with the equivalent native balance on the vampchain once the relayer
    /// observes this event. Only allowed while the chain is active — don't
    /// let people lock funds into a chain that's already been torn down.
    ///
    /// Credits the *actual* amount received (measured by balance delta), not
    /// the nominal `amount` requested — safe against fee-on-transfer or
    /// deflationary tokens that deliver less than the transferred amount, so
    /// this never over-credits `lockedBalance` relative to what the contract
    /// actually holds.
    function deposit(uint256 chainId, uint256 amount, address recipient)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 nonce)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (!registry.isActive(chainId)) revert ChainNotActive();

        address baseToken = registry.baseTokenOf(chainId);
        uint256 balanceBefore = IERC20BalanceOf(baseToken).balanceOf(address(this));
        baseToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20BalanceOf(baseToken).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        lockedBalance[chainId] += received;

        nonce = depositNonce++;
        emit Deposited(chainId, msg.sender, recipient, received, nonce);
    }

    /// @notice Claim `amount` of `chainId`'s base token to `to`, authorized
    /// by an EIP-712 signature from `signer` attesting to a burn on the
    /// vampchain (identified by `sidechainTxHash`, replay-guarded).
    /// Permissionless: anyone can submit a valid signature (typically `to`
    /// themselves, from their own wallet, paying their own gas) — funds
    /// always go to the `to` address bound into the signed message
    /// regardless of who calls this. Deliberately works even if the chain
    /// is no longer active.
    function claim(uint256 chainId, address to, uint256 amount, bytes32 sidechainTxHash, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (claimed[sidechainTxHash]) revert AlreadyClaimed();
        if (lockedBalance[chainId] < amount) revert InsufficientLocked();

        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, chainId, to, amount, sidechainTxHash));
        address recovered = ECDSA.recoverCalldata(_hashTypedData(structHash), signature);
        if (recovered != signer) revert InvalidSignature();

        claimed[sidechainTxHash] = true;
        lockedBalance[chainId] -= amount;

        address baseToken = registry.baseTokenOf(chainId);
        baseToken.safeTransfer(to, amount);

        emit Claimed(chainId, to, amount, sidechainTxHash);
    }

    // ---------------------------------------------------------------------
    // General ERC20 bridging
    //
    // The functions above (`deposit`/`claim`) are exclusively for a chain's
    // own designated base token, which gets special treatment: it becomes
    // the vampchain's *native gas currency*, minted directly by the
    // relayer's treasury account (see docs/ARCHITECTURE.md "Why geth Clique
    // PoA"). Every other ERC20 goes through `depositToken`/`claimToken`
    // instead, and gets a wrapped ERC20 representation on the vampchain —
    // deployed at a deterministic, squat-proof address by
    // VampWrappedTokenFactory (baked into every vampchain's genesis) —
    // rather than native currency. Same pull-based EIP-712 claim pattern,
    // same trust model, just keyed by `(chainId, token)` instead of only
    // `chainId`, and with its own typehash so a claim signature can never
    // be replayed across the two paths.
    // ---------------------------------------------------------------------

    /// @notice Lock `amount` of `token` for `chainId`, crediting `recipient`
    /// with the equivalent wrapped-token balance on the vampchain once the
    /// relayer observes this event. `token` must not be the chain's own
    /// base token — that has its own dedicated, native-currency-minting path
    /// above (`deposit`), and mixing the two would split one asset's
    /// liquidity across two disconnected accounting mappings.
    ///
    /// Same balance-delta accounting as `deposit`: credits the *actual*
    /// amount received, not the nominal `amount` requested, so fee-on-
    /// transfer/deflationary tokens can never over-credit
    /// `lockedBalanceGeneral` relative to what this contract actually holds.
    function depositToken(uint256 chainId, address token, uint256 amount, address recipient)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 nonce)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (!registry.isActive(chainId)) revert ChainNotActive();
        if (token == registry.baseTokenOf(chainId)) revert TokenIsBaseToken();

        uint256 balanceBefore = IERC20BalanceOf(token).balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20BalanceOf(token).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        lockedBalanceGeneral[chainId][token] += received;

        nonce = depositNonce++;
        emit DepositedToken(chainId, token, recipient, msg.sender, received, nonce);
    }

    /// @notice Claim `amount` of `token` for `chainId` to `to`, authorized by
    /// an EIP-712 signature from `signer` attesting to a wrapped-token
    /// transfer-to-treasury on the vampchain (identified by
    /// `sidechainTxHash`, replay-guarded via the same `claimed` mapping
    /// `claim` uses). Permissionless in the same way `claim` is — funds
    /// always land on the `to` address bound into the signature regardless
    /// of who submits this transaction.
    function claimToken(
        uint256 chainId,
        address token,
        address to,
        uint256 amount,
        bytes32 sidechainTxHash,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (claimed[sidechainTxHash]) revert AlreadyClaimed();
        if (lockedBalanceGeneral[chainId][token] < amount) revert InsufficientLocked();

        bytes32 structHash =
            keccak256(abi.encode(CLAIM_TOKEN_TYPEHASH, chainId, token, to, amount, sidechainTxHash));
        address recovered = ECDSA.recoverCalldata(_hashTypedData(structHash), signature);
        if (recovered != signer) revert InvalidSignature();

        claimed[sidechainTxHash] = true;
        lockedBalanceGeneral[chainId][token] -= amount;

        token.safeTransfer(to, amount);

        emit ClaimedToken(chainId, token, to, amount, sidechainTxHash);
    }

    // ---------------------------------------------------------------------
    // Owner admin
    // ---------------------------------------------------------------------

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    // ---------------------------------------------------------------------
    // Protocol fee revenue: one cumulative counter for tips + base-fee burn
    //
    // Every vampchain's gas fees split into two pieces (see
    // docs/ARCHITECTURE.md "Protocol fee revenue"): priority fees (tips)
    // land as real native balance at the Clique signer's own address
    // (`--miner.etherbase`), where they simply accumulate forever — the
    // signer never spends, so its balance is a monotonically-growing
    // number; the EIP-1559 base fee is destroyed outright by the EVM
    // itself, so its running total is monotonic by construction. Neither
    // ever needs to move on the sidechain: both are pure accounting, and
    // the relayer attests to their SUM as one cumulative figure. (An
    // earlier design swept tips to the treasury via real sidechain
    // transactions, each producing its own one-shot claim signature — that
    // meant unclaimed revenue accumulated as an unbounded pile of
    // individually-submittable signatures instead of one number. This
    // replaced it.)
    //
    // Why paying out against `lockedBalance` is provably safe: every unit
    // of native currency on a vampchain is minted 1:1 against
    // `lockedBalance[chainId]` here. User-paid gas permanently removes
    // native currency from user circulation (base fee destroyed, tip
    // stranded at the never-spending signer), but `lockedBalance` doesn't
    // shrink when that happens — so it exceeds real user-circulating
    // supply by exactly the cumulative user-paid gas total. Withdrawing
    // exactly that amount, never more, leaves every remaining holder still
    // fully backed. (The off-chain accounting deliberately excludes
    // protocol-sent transactions — treasury mints pay gas from an unbacked
    // genesis balance, which creates no L1 surplus.)
    //
    // The claim splits three ways: the chain's own creator
    // (`registry.getChain(chainId).creator`, an ongoing reward for having
    // funded the chain, on top of the one-time creation fee), the protocol
    // treasury, and a *separate* runway-treasury wallet earmarked for
    // keeping chains funded — the users actually generating this revenue
    // are the ones bridging into and transacting on a chain in the first
    // place, and the thing they're risking is the chain dying, so a third
    // of what their own activity generates goes toward directly preventing
    // that (see `VampChainRegistry.runwayTreasury`'s docstring for why
    // this is a distinct address rather than an accounting line item).
    // `claimFeeRevenue` accepts no caller-supplied recipient: every
    // address is always read live from the registry, so even a fully
    // compromised signer key can only ever redirect this revenue between
    // these three fixed parties, never to an arbitrary third party —
    // unlike `claim`/`claimToken`, which must accept an arbitrary `to`
    // because that's the whole point of a user withdrawal.
    // ---------------------------------------------------------------------

    /// @notice Total fee revenue already paid out per chain — every claim
    /// pays only the increment of a strictly-larger attested cumulative
    /// total over this, so no attestation (fresh, stale, or replayed) can
    /// ever pay the same revenue twice, in any submission order.
    mapping(uint256 => uint256) public feeRevenueClaimed;

    bytes32 public constant FEE_REVENUE_TYPEHASH =
        keccak256("FeeRevenue(uint256 vampChainId,uint256 cumulativeRevenue,uint256 asOfBlock)");

    event FeeRevenueClaimed(
        uint256 indexed chainId,
        uint256 toProtocol,
        uint256 toCreator,
        uint256 toRunway,
        uint256 cumulativeRevenue,
        uint256 asOfBlock
    );

    error NothingToClaim();

    /// @notice Claim `chainId`'s accumulated fee revenue — tips + base-fee
    /// burn as ONE cumulative figure, attested by an EIP-712 signature as
    /// of a given sidechain block — split three ways between the protocol
    /// treasury, the chain's creator, and the runway treasury. One
    /// transaction always claims everything accrued since the last claim,
    /// no matter how long ago that was: the attestation is a running
    /// total, not a batch of events, so nothing ever piles up waiting.
    /// Monotonic and idempotent: only ever pays out the *increment* over
    /// `feeRevenueClaimed[chainId]`, so resubmitting the same attestation,
    /// or any stale (lower-or-equal) one, is a harmless no-op revert
    /// rather than a double-pay — replay safety is contract state, not
    /// submission-order discipline. The amount actually paid is clamped to
    /// `lockedBalance[chainId]` as a defensive ceiling against a
    /// miscomputed attestation. Permissionless like every other claim path
    /// here: anyone can submit it — the payout addresses are fixed by the
    /// registry regardless of who calls.
    function claimFeeRevenue(uint256 chainId, uint256 cumulativeRevenue, uint256 asOfBlock, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 toProtocol, uint256 toCreator, uint256 toRunway)
    {
        uint256 alreadyClaimed = feeRevenueClaimed[chainId];
        if (cumulativeRevenue <= alreadyClaimed) revert NothingToClaim();

        bytes32 structHash = keccak256(abi.encode(FEE_REVENUE_TYPEHASH, chainId, cumulativeRevenue, asOfBlock));
        address recovered = ECDSA.recoverCalldata(_hashTypedData(structHash), signature);
        if (recovered != signer) revert InvalidSignature();

        uint256 amount = cumulativeRevenue - alreadyClaimed;
        uint256 available = lockedBalance[chainId];
        if (amount > available) amount = available;
        if (amount == 0) revert NothingToClaim();

        feeRevenueClaimed[chainId] = alreadyClaimed + amount;
        lockedBalance[chainId] -= amount;

        (toProtocol, toCreator, toRunway) = _payProtocolAndCreator(chainId, amount);
        emit FeeRevenueClaimed(chainId, toProtocol, toCreator, toRunway, cumulativeRevenue, asOfBlock);
    }

    /// @notice Splits `amount` of `chainId`'s base token three ways between
    /// the protocol treasury, the chain's creator, and the runway
    /// treasury — all three read live from the registry, never
    /// caller-supplied. Creator and protocol each round down to `amount /
    /// 3`; the runway treasury absorbs whatever's left (0, 1, or 2 extra
    /// wei), so neither the creator's nor the protocol's share is ever
    /// shorted by rounding — only the already-inherently-approximate
    /// runway pool's total varies by a negligible amount. `lockedBalance`
    /// has already been decremented by the caller before this runs.
    function _payProtocolAndCreator(uint256 chainId, uint256 amount)
        internal
        returns (uint256 toProtocol, uint256 toCreator, uint256 toRunway)
    {
        toCreator = amount / 3;
        toProtocol = amount / 3;
        toRunway = amount - toCreator - toProtocol;

        address baseToken = registry.baseTokenOf(chainId);
        address creator = registry.getChain(chainId).creator;
        address protocolTreasury = registry.protocolTreasury();
        address runwayTreasury = registry.runwayTreasury();

        baseToken.safeTransfer(protocolTreasury, toProtocol);
        baseToken.safeTransfer(creator, toCreator);
        baseToken.safeTransfer(runwayTreasury, toRunway);
    }

    // ---------------------------------------------------------------------
    // Snapshot claims: what happens to bridged funds once a chain is
    // actually torn down
    //
    // The live burn-and-claim flow (`claim`/`claimToken`) requires the user
    // to submit a real transaction *on the vampchain itself* to signal a
    // withdrawal. That's fine right up until the chain is actually torn
    // down (see docs/ARCHITECTURE.md "Protocol fee revenue" and
    // VampChainRegistry's grace period) — at that point there's no live
    // node left to burn against, ever again, for anyone who didn't already
    // withdraw in time. This is the mechanism that replaces it: once a
    // chain's grace period has genuinely expired, the relayer reads every
    // real balance the chain had at that final moment (native currency +
    // every general-bridged wrapped token), builds a Merkle tree of
    // (chainId, token, holder, amount) leaves, and publishes just the root.
    // Anyone can then claim their own leaf by submitting its Merkle proof —
    // permissionless, same as every other claim path here — capped by the
    // exact same `lockedBalance`/`lockedBalanceGeneral` ceiling as
    // claim()/claimToken(), so even a bad-faith root can never release more
    // than this chain actually has locked, regardless of what it claims.
    // ---------------------------------------------------------------------

    /// @notice Merkle root of every (chainId, token, holder, amount) leaf at
    /// the moment a chain's snapshot was taken. `bytes32(0)` means no
    /// snapshot has been published yet.
    mapping(uint256 => bytes32) public snapshotRoot;

    /// @notice When `snapshotRoot[chainId]` was published — starts the
    /// `SNAPSHOT_CLAIM_WINDOW` clock `sweepUnclaimed` checks against.
    mapping(uint256 => uint256) public snapshotPublishedAt;

    /// @notice Whether a given (chainId, token, holder) leaf has already
    /// been claimed. Distinct from `claimed` (keyed by sidechainTxHash) —
    /// a snapshot leaf has no underlying sidechain transaction at all.
    mapping(uint256 => mapping(address => mapping(address => bool))) public snapshotClaimed;

    /// @notice How long a published snapshot's leaves stay claimable
    /// before the protocol may sweep whatever's left unclaimed (see
    /// `sweepUnclaimed`) — deliberately generous, this is the last chance
    /// for anyone who had real funds on a now-dead chain to get them back.
    uint256 public constant SNAPSHOT_CLAIM_WINDOW = 30 days;

    bytes32 public constant SNAPSHOT_TYPEHASH = keccak256("Snapshot(uint256 vampChainId,bytes32 root)");

    event SnapshotPublished(uint256 indexed chainId, bytes32 root, uint256 publishedAt);
    event SnapshotClaimed(uint256 indexed chainId, address indexed token, address indexed to, uint256 amount);
    event UnclaimedSwept(uint256 indexed chainId, address indexed token, uint256 amount);

    error SnapshotAlreadyPublished();
    error NoSnapshot();
    error InvalidProof();
    error ClaimWindowNotElapsed();

    /// @notice Publishes the final-balances Merkle root for a chain,
    /// authorized by an EIP-712 signature from `signer` (the same trusted
    /// attester every other claim path here relies on). Permissionless to
    /// submit, like every other claim function — most naturally the
    /// relayer itself, or the provisioner once it's finished tearing the
    /// chain's infra down. Can only ever be published once per chain: there
    /// is deliberately no update path, so a claim already verified against
    /// a root can never be invalidated out from under someone by a later
    /// "correction."
    function publishSnapshot(uint256 chainId, bytes32 root, bytes calldata signature) external {
        if (snapshotRoot[chainId] != bytes32(0)) revert SnapshotAlreadyPublished();
        if (root == bytes32(0)) revert NoSnapshot();

        bytes32 structHash = keccak256(abi.encode(SNAPSHOT_TYPEHASH, chainId, root));
        address recovered = ECDSA.recoverCalldata(_hashTypedData(structHash), signature);
        if (recovered != signer) revert InvalidSignature();

        snapshotRoot[chainId] = root;
        snapshotPublishedAt[chainId] = block.timestamp;
        emit SnapshotPublished(chainId, root, block.timestamp);
    }

    /// @notice Claim `amount` of `token` (`address(0)` = the chain's own
    /// base token, native-currency path; anything else = a general-bridged
    /// wrapped token, same as `depositToken`/`claimToken`) owed to `to` per
    /// the published snapshot. Permissionless — funds always land on the
    /// `to` address baked into the leaf, regardless of who submits this.
    /// Still capped by the same locked-balance ceiling as the live claim
    /// paths, so a compromised or mistaken root can never over-release.
    function claimSnapshot(uint256 chainId, address token, address to, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
    {
        bytes32 root = snapshotRoot[chainId];
        if (root == bytes32(0)) revert NoSnapshot();
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (snapshotClaimed[chainId][token][to]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(chainId, token, to, amount))));
        if (!MerkleProofLib.verifyCalldata(proof, root, leaf)) revert InvalidProof();

        snapshotClaimed[chainId][token][to] = true;

        if (token == address(0)) {
            if (lockedBalance[chainId] < amount) revert InsufficientLocked();
            lockedBalance[chainId] -= amount;
            registry.baseTokenOf(chainId).safeTransfer(to, amount);
        } else {
            if (lockedBalanceGeneral[chainId][token] < amount) revert InsufficientLocked();
            lockedBalanceGeneral[chainId][token] -= amount;
            token.safeTransfer(to, amount);
        }

        emit SnapshotClaimed(chainId, token, to, amount);
    }

    /// @notice Once `SNAPSHOT_CLAIM_WINDOW` has elapsed since a chain's
    /// snapshot was published, permissionlessly sweep whatever's left
    /// unclaimed for a given `token` to the protocol treasury. Recipient is
    /// always `registry.protocolTreasury()`, never caller-supplied, so
    /// there's no reason to gate who can trigger this — it's just a fixed,
    /// long-delayed cleanup of genuinely abandoned funds, not a live risk.
    function sweepUnclaimed(uint256 chainId, address token) external nonReentrant returns (uint256 amount) {
        uint256 publishedAt = snapshotPublishedAt[chainId];
        if (publishedAt == 0) revert NoSnapshot();
        if (block.timestamp < publishedAt + SNAPSHOT_CLAIM_WINDOW) revert ClaimWindowNotElapsed();

        address transferToken;
        if (token == address(0)) {
            amount = lockedBalance[chainId];
            lockedBalance[chainId] = 0;
            transferToken = registry.baseTokenOf(chainId);
        } else {
            amount = lockedBalanceGeneral[chainId][token];
            lockedBalanceGeneral[chainId][token] = 0;
            transferToken = token;
        }
        if (amount == 0) revert ZeroAmount();

        transferToken.safeTransfer(registry.protocolTreasury(), amount);
        emit UnclaimedSwept(chainId, token, amount);
    }
}
