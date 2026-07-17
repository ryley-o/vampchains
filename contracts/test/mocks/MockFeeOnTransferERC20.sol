// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @notice ERC20 that deducts a fixed basis-point fee (burned) on every
/// transfer, standing in for real deflationary/fee-on-transfer tokens.
/// Exists purely to prove VampBridge.deposit() credits what it actually
/// receives, not the nominal amount requested.
contract MockFeeOnTransferERC20 is ERC20 {
    string internal _name;
    string internal _symbol;
    uint8 internal immutable _decimals;
    uint256 public immutable feeBps;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 feeBps_) {
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        feeBps = feeBps_;
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feeBps) / 10_000;
        _burn(msg.sender, fee);
        return super.transfer(to, amount - fee);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * feeBps) / 10_000;
        _spendAllowance(from, msg.sender, amount);
        _burn(from, fee);
        _transfer(from, to, amount - fee);
        return true;
    }
}
