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
/// being torn down. Once a chain's paid-up funding depletes it stays fully
/// open for `GRACE_PERIOD` (a rescue window — deposits/minting/top-ups all
/// keep working, see `isActive`) before `deactivateIfGraceExpired` can
/// actually flip it off; from there it's deactivated forever — a brand new
/// `createChain` call (new chainId) is required to bring the same base
/// token back. See VampBridge.sol for what happens to funds already
/// bridged onto a chain once it's actually torn down (a Merkle snapshot
/// claim process, not the live burn-and-claim flow, since there's no live
/// node left to burn against).
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

    /// @notice How long a chain stays fully open (deposits, minting,
    /// top-ups — everything) after its paid-up funding runs out, before it
    /// actually gets torn down. A deliberate "shut-off grace window," not
    /// the protocol extending credit: nothing is ever owed beyond what was
    /// really funded (see `_earned`'s cap), this just delays the hard
    /// cutover to give a permissionless top-up (or the chain's own
    /// creator) a real chance to rescue it before infra actually comes down
    /// and the snapshot/claim process (see VampBridge.sol) kicks in.
    uint256 public constant GRACE_PERIOD = 7 days;

    /// @notice The USDC token used for fee payments.
    address public immutable usdc;

    /// @notice Default annual fee (USDC) applied to newly created chains.
    /// Adjustable by the owner; never affects chains already created.
    uint256 public defaultAnnualFeeUSDC;

    /// @notice Where the protocol's earned fees are withdrawn to.
    address public protocolTreasury;

    /// @notice Where the "runway" third of every gas-fee claim (see
    /// VampBridge.sol's `_payProtocolAndCreator`) is sent — deliberately a
    /// separate address from `protocolTreasury`, not just a separate
    /// accounting bucket at the same address. The whole point is that
    /// anyone can independently verify what's been earmarked for keeping
    /// chains funded (this address's own token balances/history, publicly
    /// readable) without trusting an off-chain claim about how protocol
    /// revenue was split internally. Converting what accumulates here into
    /// USDC and actually calling `topUp` on a chain's behalf is a manual,
    /// best-effort process at the protocol's discretion — there's no
    /// automatic on-chain path from an arbitrary ERC20 to a `topUp` call,
    /// since that would require a trusted DEX/oracle integration this
    /// project deliberately doesn't take on.
    address public runwayTreasury;

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
    event ChainAnnualFeeUpdated(uint256 indexed chainId, uint256 oldFee, uint256 newFee, uint256 settledAmount);
    event ProtocolTreasuryUpdated(address oldTreasury, address newTreasury);
    event RunwayTreasuryUpdated(address oldTreasury, address newTreasury);

    error InvalidToken();
    error InvalidLabel();
    error TokenAlreadyActive();
    error ChainNotFound();
    error ChainNotActive();
    error ZeroAmount();
    error ZeroAddress();
    error NothingToWithdraw();

    constructor(
        address usdc_,
        uint256 defaultAnnualFeeUSDC_,
        address protocolTreasury_,
        address runwayTreasury_,
        address owner_
    ) {
        if (usdc_ == address(0)) revert ZeroAddress();
        if (owner_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        defaultAnnualFeeUSDC = defaultAnnualFeeUSDC_;
        protocolTreasury = protocolTreasury_ == address(0) ? owner_ : protocolTreasury_;
        runwayTreasury = runwayTreasury_ == address(0) ? owner_ : runwayTreasury_;
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
    /// balance). Deliberately does NOT deactivate the chain even if this
    /// fully drains `fundingBalance` to zero — that used to happen here,
    /// but it let a routine protocol fee withdrawal instantly kill a chain
    /// mid-grace-period (fundingBalance reaching zero is just what
    /// "already depleted" looks like once nominal depletion has passed,
    /// which is true for the entire grace window, not just after it
    /// expires). `deactivateIfGraceExpired` is now the only path that ever
    /// flips `active`/`activeChainByToken` — `isActive` stays accurate
    /// regardless, since it already recomputes `isPastGrace` fresh on
    /// every call rather than trusting a stored flag.
    function withdrawEarned(uint256 chainId) external onlyOwner nonReentrant returns (uint256 amount) {
        VampChain storage c = _chainOrRevert(chainId);
        amount = _settleAccrual(c);
        if (amount == 0) revert NothingToWithdraw();
        emit FeeWithdrawn(chainId, amount, c.fundingBalance);
    }

    /// @notice Owner-only: change an existing chain's annual fee going
    /// forward — e.g. infrastructure costs shift, or a chain's on-chain
    /// state has grown enough to change what it actually costs to run.
    /// Never retroactive: whatever's already accrued under the *old* rate
    /// is settled and paid out first (the exact same accounting
    /// `withdrawEarned` does), the accrual checkpoint resets to now, and
    /// only elapsed time from this point forward is charged at the new
    /// rate. `settledAmount` in the emitted event is always the exact
    /// pre-change amount realized, so a rate change is auditable, not just
    /// asserted.
    function setChainAnnualFee(uint256 chainId, uint256 newAnnualFeeUSDC) external onlyOwner nonReentrant {
        VampChain storage c = _chainOrRevert(chainId);
        if (!c.active) revert ChainNotActive();

        uint256 settled = _settleAccrual(c);
        uint256 oldFee = c.annualFeeUSDC;
        c.annualFeeUSDC = newAnnualFeeUSDC.toUint128();

        emit ChainAnnualFeeUpdated(chainId, oldFee, newAnnualFeeUSDC, settled);
    }

    /// @notice Realizes whatever's accrued since `lastAccrualAt` under the
    /// *current* rate — reduces `fundingBalance` and pays it to the
    /// protocol treasury, then resets the checkpoint to now. Shared by
    /// `withdrawEarned` and `setChainAnnualFee`: both need the exact same
    /// "settle what's owed under the old terms before anything changes"
    /// step, which is precisely what makes a later rate change provably
    /// non-retroactive rather than merely described as such.
    function _settleAccrual(VampChain storage c) internal returns (uint256 settled) {
        settled = _earned(c);
        if (settled > 0) {
            c.fundingBalance -= settled.toUint128();
            usdc.safeTransfer(protocolTreasury, settled);
        }
        c.lastAccrualAt = uint64(block.timestamp);
    }

    /// @notice Permissionless: flips a chain's `active` flag off once its
    /// grace period has genuinely expired (`GRACE_PERIOD` after paid-up
    /// funding ran out), regardless of whether the protocol has gotten
    /// around to withdrawing yet. Merely running out of paid runtime is
    /// NOT enough on its own — `isActive` already stays true throughout
    /// the grace window (see below), so this only ever returns true once
    /// the chain has truly run out its rescue window with no top-up. The
    /// provisioner calls this (or reacts to the resulting event) to know
    /// when to start the snapshot process and tear down the underlying
    /// infra — see VampBridge.sol's snapshot-claim mechanism.
    function deactivateIfGraceExpired(uint256 chainId) external returns (bool deactivated) {
        VampChain storage c = _chainOrRevert(chainId);
        if (c.active && isPastGrace(chainId)) {
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

    /// @notice The instant this chain's paid-up funding will (or did) run
    /// out, per the locked-in linear accrual rate — `lastAccrualAt +
    /// fundingBalance * YEAR / annualFeeUSDC`. Can be in the past; that's
    /// not an error, it's just what "already depleted" looks like as a
    /// timestamp rather than a stored flag. `type(uint256).max` for the
    /// (edge-case) free-tier chain created with a 0 annual fee, which never
    /// depletes.
    function depletionInstant(uint256 chainId) public view returns (uint256) {
        VampChain storage c = _chainOrRevert(chainId);
        if (c.annualFeeUSDC == 0) return type(uint256).max;
        return uint256(c.lastAccrualAt) + (uint256(c.fundingBalance) * YEAR) / c.annualFeeUSDC;
    }

    /// @notice Seconds of *paid* runway left before this chain's funding
    /// fully depletes. Floors at 0 once depleted — including throughout any
    /// grace period afterward, this never goes negative. `type(uint256).max`
    /// for the free-tier (0-fee) edge case.
    function remainingRuntime(uint256 chainId) public view returns (uint256) {
        uint256 depletion = depletionInstant(chainId);
        if (depletion == type(uint256).max) return type(uint256).max;
        if (block.timestamp >= depletion) return 0;
        return depletion - block.timestamp;
    }

    /// @notice The instant a chain's grace period actually expires —
    /// `GRACE_PERIOD` after its paid-up funding ran out. `type(uint256).max`
    /// for the free-tier (0-fee) edge case, which never depletes and so
    /// never grace-expires either.
    function graceDeadline(uint256 chainId) public view returns (uint256) {
        uint256 depletion = depletionInstant(chainId);
        if (depletion == type(uint256).max) return type(uint256).max;
        return depletion + GRACE_PERIOD;
    }

    /// @notice True once a chain's grace period has genuinely expired —
    /// the real "time to shut this down" signal, as opposed to merely
    /// having run out of paid runtime (which alone keeps the chain fully
    /// open, see `isActive`).
    function isPastGrace(uint256 chainId) public view returns (bool) {
        return block.timestamp > graceDeadline(chainId);
    }

    /// @notice True iff the chain is flagged active AND hasn't exceeded its
    /// grace window. Running out of *paid* runtime alone no longer stops
    /// this — deposits, minting, and top-ups all keep working throughout
    /// the grace period, so a permissionless top-up (or the chain's own
    /// creator) has a real window to rescue it before anything actually
    /// shuts down. Pure view, needs no keeper transaction to be accurate.
    function isActive(uint256 chainId) external view returns (bool) {
        return _chains[chainId].active && !isPastGrace(chainId);
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

    function setRunwayTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit RunwayTreasuryUpdated(runwayTreasury, newTreasury);
        runwayTreasury = newTreasury;
    }
}
