// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
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
    // Protocol fee revenue: swept tips + recaptured base-fee burn
    //
    // Every vampchain's gas fees split into two pieces (see
    // docs/ARCHITECTURE.md "Why geth Clique PoA"): priority fees (tips) land
    // as real, spendable native balance at the Clique signer's own address
    // (`--miner.etherbase`); the EIP-1559 base fee is destroyed outright by
    // the EVM itself, unconditionally, on every chain. Both are real
    // protocol-attributable revenue, and both are split 50/50 with the
    // chain's own creator (`registry.getChain(chainId).creator`) — an
    // ongoing reward for having funded the chain, on top of the one-time
    // creation fee. Neither function below accepts a caller-supplied
    // recipient: both addresses are always read live from the registry, so
    // even a fully compromised signer key can only ever redirect this
    // revenue between the chain's creator and the protocol treasury, never
    // to an arbitrary third party — unlike `claim`/`claimToken`, which must
    // accept an arbitrary `to` because that's the whole point of a user
    // withdrawal.
    // ---------------------------------------------------------------------

    /// @notice Cumulative base-fee-burn amount already paid out per chain —
    /// checked against each new attestation in `claimBurnedFees` so a chain
    /// can never be paid out more in total than has actually burned.
    mapping(uint256 => uint256) public burnedFeesClaimed;

    bytes32 public constant CLAIM_SWEPT_TYPEHASH =
        keccak256("ClaimSwept(uint256 vampChainId,uint256 amount,bytes32 sidechainTxHash)");

    bytes32 public constant BURNED_FEES_TYPEHASH =
        keccak256("BurnedFees(uint256 vampChainId,uint256 cumulativeBurned,uint256 asOfBlock)");

    event SweptClaimed(uint256 indexed chainId, uint256 toProtocol, uint256 toCreator, bytes32 indexed sidechainTxHash);
    event BurnedFeesClaimed(
        uint256 indexed chainId, uint256 toProtocol, uint256 toCreator, uint256 cumulativeBurned, uint256 asOfBlock
    );

    error NothingToClaim();

    /// @notice Claim `amount` of `chainId`'s base token, split 50/50 between
    /// the protocol treasury and the chain's creator, authorized by an
    /// EIP-712 signature attesting to a real burn-to-treasury transfer
    /// *from the chain's own Clique signer/etherbase address* — i.e. swept
    /// tip revenue, not a user withdrawal. Shares the `claimed` replay guard
    /// with `claim`/`claimToken` (a tip-sweep burn tx hash can never
    /// collide with a user's, they're distinct real sidechain
    /// transactions). Permissionless like every other claim path here:
    /// anyone can submit it — most naturally an admin script, or the
    /// chain's own creator pulling their share whenever they like.
    function claimSwept(uint256 chainId, uint256 amount, bytes32 sidechainTxHash, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 toProtocol, uint256 toCreator)
    {
        if (amount == 0) revert ZeroAmount();
        if (claimed[sidechainTxHash]) revert AlreadyClaimed();
        if (lockedBalance[chainId] < amount) revert InsufficientLocked();

        bytes32 structHash = keccak256(abi.encode(CLAIM_SWEPT_TYPEHASH, chainId, amount, sidechainTxHash));
        address recovered = ECDSA.recoverCalldata(_hashTypedData(structHash), signature);
        if (recovered != signer) revert InvalidSignature();

        claimed[sidechainTxHash] = true;
        lockedBalance[chainId] -= amount;

        (toProtocol, toCreator) = _payProtocolAndCreator(chainId, amount);
        emit SweptClaimed(chainId, toProtocol, toCreator, sidechainTxHash);
    }

    /// @notice Claim the protocol's share of `chainId`'s cumulative
    /// EIP-1559 base-fee burn, split 50/50 with the creator, authorized by
    /// an EIP-712 signature attesting to a cumulative burned-fee total as of
    /// a given sidechain block. No sidechain-side transaction underlies
    /// this at all — base fee is destroyed outright by the EVM, never
    /// sitting in any address — so this claims directly against the
    /// L1-side surplus that burning creates instead: every vampchain's
    /// native currency supply is minted 1:1 against `lockedBalance[chainId]`,
    /// and base-fee burn is the only thing that ever destroys that native
    /// supply, so `lockedBalance` ends up exceeding real circulating
    /// (non-treasury) supply by exactly the cumulative burn total.
    /// Withdrawing exactly that amount, never more, leaves every remaining
    /// real holder still fully backed 1:1 — provably, not merely because
    /// the treasury happens to be over-provisioned. Monotonic and
    /// idempotent: only ever pays out the *increment* over what's already
    /// been claimed, so resubmitting a stale (lower-or-equal) attestation is
    /// a harmless no-op revert rather than a double-pay, and the amount
    /// actually paid is clamped to `lockedBalance[chainId]` as a defensive
    /// ceiling against a miscomputed attestation.
    function claimBurnedFees(uint256 chainId, uint256 cumulativeBurned, uint256 asOfBlock, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 toProtocol, uint256 toCreator)
    {
        uint256 alreadyClaimed = burnedFeesClaimed[chainId];
        if (cumulativeBurned <= alreadyClaimed) revert NothingToClaim();

        bytes32 structHash = keccak256(abi.encode(BURNED_FEES_TYPEHASH, chainId, cumulativeBurned, asOfBlock));
        address recovered = ECDSA.recoverCalldata(_hashTypedData(structHash), signature);
        if (recovered != signer) revert InvalidSignature();

        uint256 amount = cumulativeBurned - alreadyClaimed;
        uint256 available = lockedBalance[chainId];
        if (amount > available) amount = available;
        if (amount == 0) revert NothingToClaim();

        burnedFeesClaimed[chainId] = alreadyClaimed + amount;
        lockedBalance[chainId] -= amount;

        (toProtocol, toCreator) = _payProtocolAndCreator(chainId, amount);
        emit BurnedFeesClaimed(chainId, toProtocol, toCreator, cumulativeBurned, asOfBlock);
    }

    /// @notice Splits `amount` of `chainId`'s base token 50/50 between the
    /// protocol treasury and the chain's creator — both read live from the
    /// registry, never caller-supplied. The creator's share rounds down on
    /// an odd amount; the protocol takes the extra unit. `lockedBalance`
    /// has already been decremented by the caller before this runs.
    function _payProtocolAndCreator(uint256 chainId, uint256 amount)
        internal
        returns (uint256 toProtocol, uint256 toCreator)
    {
        toCreator = amount / 2;
        toProtocol = amount - toCreator;

        address baseToken = registry.baseTokenOf(chainId);
        address creator = registry.getChain(chainId).creator;
        address protocolTreasury = registry.protocolTreasury();

        baseToken.safeTransfer(protocolTreasury, toProtocol);
        baseToken.safeTransfer(creator, toCreator);
    }
}
