// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @notice Implementation contract every wrapped-token clone
/// VampWrappedTokenFactory deploys delegates to (EIP-1167 minimal proxies
/// via solady's LibClone). Deliberately has no constructor logic — clones
/// don't run constructors, so per-clone state is set once via
/// `initialize`, guarded against being called more than once. This
/// contract itself is also baked into every vampchain's genesis (like the
/// factory) at a fixed address, so clone addresses — which are a function
/// of this implementation's own address — are fully deterministic from
/// block 0 on every vampchain. See VampWrappedTokenFactory and
/// docs/ARCHITECTURE.md "General ERC20 bridging".
contract VampWrappedToken is ERC20 {
    address public factory;
    address public l1Token;

    uint8 private _tokenDecimals;
    string private _tokenName;
    string private _tokenSymbol;
    bool private _initialized;

    error OnlyFactory();
    error AlreadyInitialized();

    /// @notice Sets this clone's per-token state. Callable exactly once —
    /// by whichever factory deployed this clone, recorded as `factory` on
    /// that first call, which is then the only account ever allowed to
    /// `mint` on this clone.
    function initialize(address l1Token_, string calldata name_, string calldata symbol_, uint8 decimals_)
        external
    {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        factory = msg.sender;
        l1Token = l1Token_;
        _tokenName = name_;
        _tokenSymbol = symbol_;
        _tokenDecimals = decimals_;
    }

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    /// @notice Mints `amount` to `to`. Restricted to the factory that
    /// deployed this clone, which in turn only mints on behalf of the
    /// treasury account — see VampWrappedTokenFactory.mintWrapped.
    function mint(address to, uint256 amount) external {
        if (msg.sender != factory) revert OnlyFactory();
        _mint(to, amount);
    }
}
