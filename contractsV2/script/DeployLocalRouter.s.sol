// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {InkConfig} from "./InkConfig.sol";
import {LocalV4Router} from "./LocalV4Router.sol";

/// @notice Deploys the dev-only LocalV4Router against Ink's PoolManager. Used by
/// dev.sh so the bots / frontend can swap and LP on graduated pools locally.
contract DeployLocalRouter is Script {
    function run() external returns (LocalV4Router router) {
        vm.startBroadcast();
        router = new LocalV4Router(IPoolManager(InkConfig.INK_POOL_MANAGER));
        vm.stopBroadcast();
        console2.log("LocalV4Router:", address(router));
    }
}
