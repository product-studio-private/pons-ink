// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @notice Chain constants for deploying the Pons V2 launchpad on Ink.
 * Uniswap v4 addresses are the official ones published at
 * https://docs.uniswap.org/contracts/v4/deployments (Ink: 57073).
 */
library InkConfig {
    uint256 internal constant INK_MAINNET_CHAIN_ID = 57073;

    // Uniswap v4 on Ink mainnet
    address internal constant INK_POOL_MANAGER = 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32;
    address internal constant INK_POSITION_MANAGER = 0x1b35d13a2E2528f192637F14B05f0Dc0e7dEB566;
    address internal constant INK_QUOTER = 0x3972C00f7ed4885e145823eb7C655375d275A1C5;
    address internal constant INK_STATE_VIEW = 0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990;
    address internal constant INK_UNIVERSAL_ROUTER = 0x112908daC86e20e7241B0927479Ea3Bf935d1fa0;

    // Canonical Permit2 (same address on every chain)
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Arachnid deterministic-deployment proxy, a preinstall on every OP Stack
    // chain including Ink. Used to CREATE2 the hook at a flag-bearing address.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Default launch economics, mirroring the live Robinhood Chain deployment
    // (factory 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e, launch config #0).
    uint256 internal constant DEFAULT_LAUNCH_FEE = 0.0005 ether;
    uint256 internal constant DEFAULT_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant DEFAULT_CURVE_FEE_BPS = 100;
    uint256 internal constant DEFAULT_PHANTOM_QUOTE = 1.68 ether;
    uint256 internal constant DEFAULT_GRADUATION_THRESHOLD = 4.2 ether;
    uint24 internal constant DEFAULT_POOL_FEE = 0;
    int24 internal constant DEFAULT_TICK_SPACING = 200;
}
