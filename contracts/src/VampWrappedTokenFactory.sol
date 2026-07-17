// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LibClone} from "solady/utils/LibClone.sol";
import {VampWrappedToken} from "./VampWrappedToken.sol";

/// @title VampWrappedTokenFactory
/// @notice Baked directly into every vampchain's genesis `alloc` (like the
/// treasury account and VampWrappedToken's implementation contract) at a
/// fixed, well-known address — see
/// `infra/sidechain-node/genesis.template.json` and docs/ARCHITECTURE.md's
/// "General ERC20 bridging" section for the full reasoning. A
/// transaction-deployed factory would leave a window between "chain
/// exists" and "factory deployed" where anyone who knew the deployer
/// address and nonce in advance could front-run deployment and squat a
/// token's canonical address with malicious bytecode. Baking this into
/// genesis means it exists at block 0 — no deployment transaction, so no
/// front-running window, ever.
///
/// Deploys EIP-1167 minimal proxy clones of VampWrappedToken (via solady's
/// LibClone) rather than full contracts, deliberately: a clone's address
/// depends ONLY on `salt` (`keccak256(l1Token)`) and this fixed factory +
/// implementation pair, NEVER on token metadata. That matters because
/// metadata (name/symbol/decimals) can't be fetched on-chain here at all —
/// this factory runs on an isolated vampchain with no visibility into L1
/// state, so it has no way to call the real `l1Token` contract to ask it.
/// TREASURY (the relayer, which does have L1 visibility) supplies metadata
/// when deploying, which is exactly why `deploy`/`mintWrapped` are gated to
/// TREASURY rather than permissionless — a caller-influenced value can
/// never be allowed to determine what a public-facing deploy call produces,
/// even though the resulting *address* itself doesn't depend on it. This is
/// the "permissioned deploy + deterministic bytecode" mitigation: bytecode
/// (and therefore address) is fixed and squat-proof; only the *content*
/// written into that address is gated, and only TREASURY can write it.
/// TREASURY is trusted to always supply the same real metadata for a given
/// `l1Token` (the relayer looks it up the same deterministic way every
/// time), so addresses stay meaningful in practice, not just unique.
contract VampWrappedTokenFactory {
    /// @dev Same well-known treasury address baked into every vampchain's
    /// genesis alloc — see entrypoint.sh / genesis.template.json. A compile
    /// -time constant, not configurable, since it must be identical (and
    /// therefore this whole contract's bytecode identical) across every
    /// vampchain for wrapped addresses to match across chains.
    address public constant TREASURY = 0x12f5B89B02C8107278c5F24E74d7B44267C55d1f;

    /// @dev Fixed, genesis-baked VampWrappedToken implementation every
    /// clone this factory deploys delegates to — see
    /// genesis.template.json. Also a compile-time constant for the same
    /// reason as TREASURY above.
    address public constant IMPLEMENTATION = 0x00000000000000000000000000000000000010C0;

    error OnlyTreasury();

    event WrappedDeployed(address indexed l1Token, address indexed wrapped);

    modifier onlyTreasury() {
        if (msg.sender != TREASURY) revert OnlyTreasury();
        _;
    }

    function _salt(address l1Token) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(l1Token));
    }

    /// @notice The deterministic address `l1Token`'s wrapped representation
    /// lives at on this vampchain, whether or not it's been deployed yet.
    /// Depends only on `l1Token` — safe to compute off-chain too, via the
    /// standard EIP-1167 CREATE2 formula (solady's LibClone implements it;
    /// this is just that computation exposed on-chain for convenience).
    function wrappedAddressOf(address l1Token) public view returns (address) {
        return LibClone.predictDeterministicAddress(IMPLEMENTATION, _salt(l1Token), address(this));
    }

    /// @notice Deploys the wrapped clone for `l1Token` if it doesn't exist
    /// yet, with the given metadata. TREASURY-only — see the contract-level
    /// comment for why. Idempotent: if already deployed, returns the
    /// existing address without touching it again (whatever metadata was
    /// set on first deploy stands; later calls' metadata is ignored).
    function deploy(address l1Token, string calldata name_, string calldata symbol_, uint8 decimals_)
        public
        onlyTreasury
        returns (address wrapped)
    {
        bytes32 salt = _salt(l1Token);
        wrapped = LibClone.predictDeterministicAddress(IMPLEMENTATION, salt, address(this));
        if (wrapped.code.length > 0) return wrapped;

        LibClone.cloneDeterministic(IMPLEMENTATION, salt);
        VampWrappedToken(wrapped).initialize(l1Token, name_, symbol_, decimals_);
        emit WrappedDeployed(l1Token, wrapped);
    }

    /// @notice Deploys (if needed) and mints `amount` of `l1Token`'s wrapped
    /// representation to `to`. The only entry point that actually moves
    /// value — `deploy` on its own just stands up an empty token contract.
    function mintWrapped(
        address l1Token,
        string calldata name_,
        string calldata symbol_,
        uint8 decimals_,
        address to,
        uint256 amount
    ) external onlyTreasury returns (address wrapped) {
        wrapped = deploy(l1Token, name_, symbol_, decimals_);
        VampWrappedToken(wrapped).mint(to, amount);
    }
}
