// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {VampChainRegistry} from "./VampChainRegistry.sol";

/// @title VampBridge
/// @notice Lock-and-mint / burn-and-release bridge between the home chain
/// and every vampchain. Deposit here locks a chain's base ERC20 and emits an
/// event; an off-chain relayer watches for it and mints the equivalent
/// native balance on the vampchain. Withdrawals work the other way: the
/// relayer watches for transfers to the sidechain's burn address and calls
/// `release` here.
///
/// Trust model, stated plainly: this is a single trusted relayer key, not a
/// light-client-verified or multisig-verified bridge. That is a deliberate
/// MVP tradeoff for a meme project, not an oversight — see docs/ARCHITECTURE.md.
/// `release` is intentionally NOT gated on the chain still being active:
/// once a vampchain's funding runs out, its infra gets torn down, but
/// tokens users locked in this contract are still real and must remain
/// withdrawable independent of the sidechain's lifecycle (assuming the
/// relayer verified the burn before the chain was destroyed).
contract VampBridge is Ownable, ReentrancyGuard {
    using SafeTransferLib for address;

    VampChainRegistry public immutable registry;

    address public relayer;
    bool public paused;
    uint256 public depositNonce;

    /// @notice Total base-token amount currently locked per chain (accounting
    /// ceiling for releases — a broken/malicious relayer can never release
    /// more than what's actually been deposited for that chain).
    mapping(uint256 => uint256) public lockedBalance;

    /// @notice Sidechain burn tx hashes already released, to prevent replay.
    mapping(bytes32 => bool) public releaseProcessed;

    event Deposited(
        uint256 indexed chainId, address indexed from, address indexed recipient, uint256 amount, uint256 nonce
    );
    event Released(uint256 indexed chainId, address indexed to, uint256 amount, bytes32 indexed sidechainTxHash);
    event RelayerUpdated(address oldRelayer, address newRelayer);
    event PausedSet(bool paused);

    error ChainNotActive();
    error ZeroAmount();
    error ZeroAddress();
    error NotRelayer();
    error BridgePaused();
    error AlreadyReleased();
    error InsufficientLocked();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert BridgePaused();
        _;
    }

    constructor(address registry_, address relayer_, address owner_) {
        if (registry_ == address(0) || relayer_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        registry = VampChainRegistry(registry_);
        relayer = relayer_;
        _initializeOwner(owner_);
    }

    /// @notice Lock `amount` of `chainId`'s base token, crediting `recipient`
    /// with the equivalent native balance on the vampchain once the relayer
    /// observes this event. Only allowed while the chain is active — don't
    /// let people lock funds into a chain that's already been torn down.
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
        baseToken.safeTransferFrom(msg.sender, address(this), amount);
        lockedBalance[chainId] += amount;

        nonce = depositNonce++;
        emit Deposited(chainId, msg.sender, recipient, amount, nonce);
    }

    /// @notice Relayer-only: release `amount` of `chainId`'s base token to
    /// `to`, after having observed a corresponding burn on the vampchain
    /// (identified by `sidechainTxHash`, replay-guarded). Deliberately works
    /// even if the chain is no longer active.
    function release(uint256 chainId, address to, uint256 amount, bytes32 sidechainTxHash)
        external
        onlyRelayer
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (releaseProcessed[sidechainTxHash]) revert AlreadyReleased();
        if (lockedBalance[chainId] < amount) revert InsufficientLocked();

        releaseProcessed[sidechainTxHash] = true;
        lockedBalance[chainId] -= amount;

        address baseToken = registry.baseTokenOf(chainId);
        baseToken.safeTransfer(to, amount);

        emit Released(chainId, to, amount, sidechainTxHash);
    }

    // ---------------------------------------------------------------------
    // Owner admin
    // ---------------------------------------------------------------------

    function setRelayer(address newRelayer) external onlyOwner {
        if (newRelayer == address(0)) revert ZeroAddress();
        emit RelayerUpdated(relayer, newRelayer);
        relayer = newRelayer;
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }
}
