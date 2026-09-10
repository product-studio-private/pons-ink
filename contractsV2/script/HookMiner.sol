// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";

/**
 * @notice Finds a CREATE2 salt such that `deployer` deploying `creationCode`
 * lands on an address whose low 14 bits equal `flags`, as Uniswap v4 requires
 * for a hook's enabled callbacks.
 */
library HookMiner {
    uint256 private constant MAX_ITERATIONS = 500_000;

    error SaltNotFound(uint160 flags);

    function find(address deployer, uint160 flags, bytes memory creationCode, uint256 startSalt)
        internal
        pure
        returns (address hookAddress, bytes32 salt)
    {
        bytes32 initCodeHash = keccak256(creationCode);
        flags &= Hooks.ALL_HOOK_MASK;
        for (uint256 i = startSalt; i < startSalt + MAX_ITERATIONS; ++i) {
            salt = bytes32(i);
            hookAddress = computeAddress(deployer, salt, initCodeHash);
            if (uint160(hookAddress) & Hooks.ALL_HOOK_MASK == flags) return (hookAddress, salt);
        }
        revert SaltNotFound(flags);
    }

    function computeAddress(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }
}
