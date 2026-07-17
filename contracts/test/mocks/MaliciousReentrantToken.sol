// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20-shaped token whose `transferFrom` calls back into
/// an attacker-chosen target mid-transfer. Used only to prove the
/// `nonReentrant` guards on VampChainRegistry/VampBridge actually hold —
/// the armed callback is expected to fail, not succeed.
contract MaliciousReentrantToken {
    mapping(address => uint256) public balanceOf;

    address public callbackTarget;
    bytes public callbackData;
    bool public armed;
    bool public callbackAttempted;
    bool public callbackSucceeded;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    function arm(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        armed = true;
        callbackAttempted = false;
        callbackSucceeded = false;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        if (armed) {
            armed = false;
            callbackAttempted = true;
            (bool ok,) = callbackTarget.call(callbackData);
            callbackSucceeded = ok;
        }
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
