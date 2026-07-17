// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {SafeCastLib} from "solady/utils/SafeCastLib.sol";

/// @notice Minimal ERC20 metadata probe, used only to sanity-check a token
/// address at chain creation (must at least implement `decimals()`).
interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

/// @title VampChainRegistry
/// @notice Registers "vampchains" — meme sidechains backed by an existing
/// ERC20 as their native gas currency — and accounts for the USDC that funds
/// running them.
///
/// Funding model: creating a chain locks in an annual fee (in USDC) at the
/// rate active at creation time; that rate never changes retroactively for
/// an existing chain. The fee accrues to the protocol *linearly* over time —
/// `withdrawEarned` can only ever pull out what's already been "served", so
/// the protocol can never charge for time not yet rendered. `fundingBalance`
/// is a single pool that represents everything not yet paid out (both
/// already-earned-but-unwithdrawn and not-yet-earned funds); `topUp` is
/// fully permissionless so anyone can extend a chain's runway and prevent it
/// being torn down. Once a chain's funding fully depletes it is deactivated
/// forever — a brand new `createChain` call (new chainId) is required to
/// bring the same base token back.
contract VampChainRegistry is Ownable, ReentrancyGuard {
    using SafeTransferLib for address;
    using SafeCastLib for uint256;

    struct VampChain {
        address baseToken;
        address creator;
        string name;
        string symbol;
        uint64 createdAt;
        uint64 lastAccrualAt;
        uint128 fundingBalance; // USDC, in USDC's native decimals (typically 6)
        uint128 annualFeeUSDC; // locked in at creation time
        bool active;
    }

    uint256 public constant YEAR = 365 days;
    uint256 public constant MIN_LABEL_LEN = 1;
    uint256 public constant MAX_NAME_LEN = 64;
    uint256 public constant MAX_SYMBOL_LEN = 16;

    /// @notice The USDC token used for fee payments.
    address public immutable usdc;

    /// @notice Default annual fee (USDC) applied to newly created chains.
    /// Adjustable by the owner; never affects chains already created.
    uint256 public defaultAnnualFeeUSDC;

    /// @notice Where the protocol's earned fees are withdrawn to.
    address public protocolTreasury;

    uint256 public nextChainId = 1;

    mapping(uint256 => VampChain) internal _chains;

    /// @notice baseToken => chainId of its currently-active vampchain (0 = none).
    /// Enforces at most one live vampchain per base token at a time.
    mapping(address => uint256) public activeChainByToken;

    event ChainCreated(
        uint256 indexed chainId,
        address indexed baseToken,
        address indexed creator,
        string name,
        string symbol,
        uint256 initialFunding,
        uint256 annualFeeUSDC
    );
    event ToppedUp(uint256 indexed chainId, address indexed from, uint256 amount, uint256 newBalance);
    event FeeWithdrawn(uint256 indexed chainId, uint256 amount, uint256 remainingBalance);
    event ChainDeactivated(uint256 indexed chainId, uint256 timestamp);
    event DefaultAnnualFeeUpdated(uint256 oldFee, uint256 newFee);
    event ProtocolTreasuryUpdated(address oldTreasury, address newTreasury);

    error InvalidToken();
    error InvalidLabel();
    error TokenAlreadyActive();
    error ChainNotFound();
    error ChainNotActive();
    error ZeroAmount();
    error ZeroAddress();
    error NothingToWithdraw();

    constructor(address usdc_, uint256 defaultAnnualFeeUSDC_, address protocolTreasury_, address owner_) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        defaultAnnualFeeUSDC = defaultAnnualFeeUSDC_;
        protocolTreasury = protocolTreasury_ == address(0) ? owner_ : protocolTreasury_;
        _initializeOwner(owner_);
    }

    // ---------------------------------------------------------------------
    // Chain lifecycle
    // ---------------------------------------------------------------------

    /// @notice Create a new vampchain backed by `baseToken`, paying the
    /// current default annual fee in USDC (pulled via `transferFrom`, so the
    /// caller must have approved this contract first).
    function createChain(address baseToken, string calldata name, string calldata symbol)
        external
        nonReentrant
        returns (uint256 chainId)
    {
        if (baseToken == address(0) || baseToken == usdc) revert InvalidToken();
        if (bytes(name).length < MIN_LABEL_LEN || bytes(name).length > MAX_NAME_LEN) revert InvalidLabel();
        if (bytes(symbol).length < MIN_LABEL_LEN || bytes(symbol).length > MAX_SYMBOL_LEN) revert InvalidLabel();
        if (activeChainByToken[baseToken] != 0) revert TokenAlreadyActive();

        // Sanity probe: must at least look like an ERC20 (reverts otherwise).
        IERC20Decimals(baseToken).decimals();

        uint256 fee = defaultAnnualFeeUSDC;
        chainId = nextChainId++;

        _chains[chainId] = VampChain({
            baseToken: baseToken,
            creator: msg.sender,
            name: name,
            symbol: symbol,
            createdAt: uint64(block.timestamp),
            lastAccrualAt: uint64(block.timestamp),
            fundingBalance: fee.toUint128(),
            annualFeeUSDC: fee.toUint128(),
            active: true
        });
        activeChainByToken[baseToken] = chainId;

        if (fee > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), fee);
        }

        emit ChainCreated(chainId, baseToken, msg.sender, name, symbol, fee, fee);
    }

    /// @notice Permissionlessly add USDC funding to a chain's runway. Anyone
    /// can do this — it's the public "prevent a rug" mechanism.
    function topUp(uint256 chainId, uint256 amount) external nonReentrant {
        VampChain storage c = _chainOrRevert(chainId);
        if (!c.active) revert ChainNotActive();
        if (amount == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        c.fundingBalance = (uint256(c.fundingBalance) + amount).toUint128();
        emit ToppedUp(chainId, msg.sender, amount, c.fundingBalance);
    }

    /// @notice Protocol withdraws whatever has been "earned" so far (linear
    /// accrual since the last accrual checkpoint, capped at the remaining
    /// balance). Fully draining a chain's balance deactivates it.
    function withdrawEarned(uint256 chainId) external onlyOwner nonReentrant returns (uint256 amount) {
        VampChain storage c = _chainOrRevert(chainId);
        amount = _earned(c);
        if (amount == 0) revert NothingToWithdraw();

        c.fundingBalance -= amount.toUint128();
        c.lastAccrualAt = uint64(block.timestamp);

        if (c.fundingBalance == 0) {
            c.active = false;
            delete activeChainByToken[c.baseToken];
            emit ChainDeactivated(chainId, block.timestamp);
        }

        usdc.safeTransfer(protocolTreasury, amount);
        emit FeeWithdrawn(chainId, amount, c.fundingBalance);
    }

    /// @notice Permissionless: flips a chain's `active` flag off once its
    /// funding has genuinely run out (by elapsed time), regardless of
    /// whether the protocol has gotten around to withdrawing yet. The
    /// provisioner calls this (or reacts to the resulting event) to know
    /// when to tear down the underlying infra.
    function deactivateIfDepleted(uint256 chainId) external returns (bool deactivated) {
        VampChain storage c = _chainOrRevert(chainId);
        if (c.active && remainingRuntime(chainId) == 0) {
            c.active = false;
            delete activeChainByToken[c.baseToken];
            emit ChainDeactivated(chainId, block.timestamp);
            return true;
        }
        return false;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getChain(uint256 chainId) external view returns (VampChain memory) {
        return _chainOrRevert(chainId);
    }

    function baseTokenOf(uint256 chainId) external view returns (address) {
        return _chainOrRevert(chainId).baseToken;
    }

    /// @notice How much of a chain's funding balance is currently withdrawable
    /// by the protocol (linear accrual since the last checkpoint, capped at
    /// the remaining balance).
    function earned(uint256 chainId) external view returns (uint256) {
        return _earned(_chainOrRevert(chainId));
    }

    /// @notice Seconds of runway left before this chain's funding fully
    /// depletes at its locked-in annual rate. 0 if already depleted or
    /// inactive. `type(uint256).max` for the (edge-case) free-tier chain
    /// created with a 0 annual fee.
    function remainingRuntime(uint256 chainId) public view returns (uint256) {
        VampChain storage c = _chainOrRevert(chainId);
        if (!c.active) return 0;
        if (c.annualFeeUSDC == 0) return type(uint256).max;

        uint256 depletion = uint256(c.lastAccrualAt) + (uint256(c.fundingBalance) * YEAR) / c.annualFeeUSDC;
        if (block.timestamp >= depletion) return 0;
        return depletion - block.timestamp;
    }

    /// @notice True iff the chain is flagged active AND still has runway.
    /// Pure view, needs no keeper transaction to be accurate.
    function isActive(uint256 chainId) external view returns (bool) {
        return _chains[chainId].active && remainingRuntime(chainId) > 0;
    }

    function chainCount() external view returns (uint256) {
        return nextChainId - 1;
    }

    function _earned(VampChain storage c) internal view returns (uint256) {
        if (!c.active || c.annualFeeUSDC == 0) return 0;
        uint256 elapsed = block.timestamp - c.lastAccrualAt;
        uint256 accrued = (uint256(c.annualFeeUSDC) * elapsed) / YEAR;
        return accrued > c.fundingBalance ? c.fundingBalance : accrued;
    }

    function _chainOrRevert(uint256 chainId) internal view returns (VampChain storage c) {
        c = _chains[chainId];
        if (c.createdAt == 0) revert ChainNotFound();
    }

    // ---------------------------------------------------------------------
    // Owner admin
    // ---------------------------------------------------------------------

    function setDefaultAnnualFee(uint256 newFee) external onlyOwner {
        emit DefaultAnnualFeeUpdated(defaultAnnualFeeUSDC, newFee);
        defaultAnnualFeeUSDC = newFee;
    }

    function setProtocolTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit ProtocolTreasuryUpdated(protocolTreasury, newTreasury);
        protocolTreasury = newTreasury;
    }
}
