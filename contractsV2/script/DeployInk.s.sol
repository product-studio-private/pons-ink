// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PonsV2FeeEscrow} from "../src/v2/PonsV2FeeEscrow.sol";
import {PonsV2MemeHook} from "../src/v2/hooks/PonsV2MemeHook.sol";
import {PonsV2LaunchLocker} from "../src/v2/PonsV2LaunchLocker.sol";
import {PonsV2BuybackVault} from "../src/v2/PonsV2BuybackVault.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2GraduationExecutor} from "../src/v2/PonsV2GraduationExecutor.sol";
import {PonsV2LaunchDeployer} from "../src/v2/PonsV2LaunchDeployer.sol";
import {IPonsV2FeeEscrow, IPonsV2FeePolicy} from "../src/v2/interfaces/ILaunchpadV2.sol";

import {InkConfig} from "./InkConfig.sol";
import {HookMiner} from "./HookMiner.sol";

/**
 * @title DeployInk
 * @notice Deploys and wires the full Pons V2 launchpad stack on Ink (57073).
 *
 * Order (each step's constructor needs the previous addresses):
 *   1. PonsV2FeeEscrow
 *   2. PonsV2MemeHook          CREATE2 at an address carrying the v4 hook flags
 *   3. PonsV2LaunchLocker
 *   4. PonsV2BuybackVault      (hook is its fee policy)
 *   5. PonsV2LaunchFactory     (takes 1-4; deploys PonsV2GraduationGuard itself)
 *   6. PonsV2GraduationExecutor(factory)
 *   7. PonsV2LaunchDeployer   (factory)
 *   8. one-time wiring: hook.setFactory / setBuybackVault, locker.setFactory,
 *      vault.setFactory, factory.setGraduationExecutor / setLaunchDeployer,
 *      factory.addLaunchConfig, factory.setLaunchEnabled
 *   9. optional Ownable2Step handoff to FINAL_OWNER (must acceptOwnership on
 *      hook, locker, vault and factory)
 *
 * The broadcasting account is the initial owner so it can perform the wiring.
 *
 * Environment (all optional):
 *   FINAL_OWNER             address that receives ownership after wiring (default: deployer)
 *   PROTOCOL_FEE_RECIPIENT  hook protocol fee recipient (default: FINAL_OWNER)
 *   FEE_SWEEP_OPERATOR      hook fee sweep operator (default: FINAL_OWNER)
 *   LAUNCH_FORWARDER        router allowed to forward launches (default: unset)
 *   LAUNCH_FEE              wei charged per launch (default: 0.0005 ether)
 *   LAUNCH_ENABLED          open launches to the public at deploy (default: true)
 *   POOL_MANAGER / POSITION_MANAGER / PERMIT2  override the Ink defaults
 *   WRITE_DEPLOYMENT        write deployments/<chainId>.json (default: false)
 *   DEPLOYMENT_FILE         override the output path (e.g. deployments/local.json)
 *
 * Usage:
 *   WRITE_DEPLOYMENT=true forge script script/DeployInk.s.sol:DeployInk --rpc-url ink --account <keystore> --broadcast --verify
 */
contract DeployInk is Script {
    uint160 internal constant HOOK_FLAGS =
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    struct Deployment {
        PonsV2FeeEscrow feeEscrow;
        PonsV2MemeHook hook;
        PonsV2LaunchLocker locker;
        PonsV2BuybackVault buybackVault;
        PonsV2LaunchFactory factory;
        PonsV2GraduationExecutor graduationExecutor;
        PonsV2LaunchDeployer launchDeployer;
    }

    function run() external returns (Deployment memory d) {
        IPoolManager poolManager = IPoolManager(vm.envOr("POOL_MANAGER", InkConfig.INK_POOL_MANAGER));
        IPositionManager positionManager =
            IPositionManager(vm.envOr("POSITION_MANAGER", InkConfig.INK_POSITION_MANAGER));
        IAllowanceTransfer permit2 = IAllowanceTransfer(vm.envOr("PERMIT2", InkConfig.PERMIT2));

        (, address deployer,) = vm.readCallers();
        address finalOwner = vm.envOr("FINAL_OWNER", deployer);
        address protocolFeeRecipient = vm.envOr("PROTOCOL_FEE_RECIPIENT", finalOwner);
        address feeSweepOperator = vm.envOr("FEE_SWEEP_OPERATOR", finalOwner);
        address launchForwarder = vm.envOr("LAUNCH_FORWARDER", address(0));
        uint256 launchFee = vm.envOr("LAUNCH_FEE", InkConfig.DEFAULT_LAUNCH_FEE);
        bool launchEnabled = vm.envOr("LAUNCH_ENABLED", true);

        if (block.chainid == InkConfig.INK_MAINNET_CHAIN_ID) {
            require(address(poolManager) == InkConfig.INK_POOL_MANAGER, "unexpected PoolManager for Ink");
        }
        require(address(positionManager.poolManager()) == address(poolManager), "PositionManager/PoolManager mismatch");

        vm.startBroadcast();

        // 1. Fee escrow: shared claim ledger for protocol + creators.
        d.feeEscrow = new PonsV2FeeEscrow();

        // 2. Hook at a CREATE2 address whose low 14 bits encode its permissions.
        bytes memory hookInitCode = abi.encodePacked(
            type(PonsV2MemeHook).creationCode,
            abi.encode(poolManager, IPonsV2FeeEscrow(d.feeEscrow), protocolFeeRecipient, deployer)
        );
        (address minedHook, bytes32 salt) = HookMiner.find(InkConfig.CREATE2_DEPLOYER, HOOK_FLAGS, hookInitCode, 0);
        d.hook = PonsV2MemeHook(payable(_create2(salt, hookInitCode)));
        require(address(d.hook) == minedHook, "hook landed at unexpected address");

        // 3. Locker holds every graduated LP NFT forever.
        d.locker = new PonsV2LaunchLocker(deployer, address(positionManager));

        // 4. Buyback vault: the hook is its fee policy.
        d.buybackVault =
            new PonsV2BuybackVault(deployer, IPonsV2FeePolicy(address(d.hook)), IPonsV2FeeEscrow(d.feeEscrow));

        // 5. Factory (deploys its own PonsV2GraduationGuard).
        d.factory = new PonsV2LaunchFactory(
            deployer,
            poolManager,
            positionManager,
            permit2,
            d.locker,
            d.hook,
            IPonsV2FeeEscrow(d.feeEscrow),
            d.buybackVault,
            launchFee
        );

        // 6-7. Helpers that need the factory address in their constructor.
        d.graduationExecutor = new PonsV2GraduationExecutor(positionManager, permit2, d.locker, address(d.factory));
        d.launchDeployer = new PonsV2LaunchDeployer(address(d.factory));

        // 8. One-time wiring.
        d.hook.setFactory(address(d.factory));
        d.hook.setBuybackVault(d.buybackVault);
        d.hook.setFeeSweepOperator(feeSweepOperator);
        d.locker.setFactory(address(d.factory));
        d.buybackVault.setFactory(address(d.factory));
        d.factory.setGraduationExecutor(d.graduationExecutor);
        d.factory.setLaunchDeployer(d.launchDeployer);
        if (launchForwarder != address(0)) d.factory.setLaunchForwarder(launchForwarder);

        d.factory
            .addLaunchConfig(
                PonsV2LaunchFactory.LaunchConfig({
                    supply: InkConfig.DEFAULT_SUPPLY,
                    curveFeeBps: InkConfig.DEFAULT_CURVE_FEE_BPS,
                    phantomQuote: InkConfig.DEFAULT_PHANTOM_QUOTE,
                    graduationThreshold: InkConfig.DEFAULT_GRADUATION_THRESHOLD,
                    poolFee: InkConfig.DEFAULT_POOL_FEE,
                    tickSpacing: InkConfig.DEFAULT_TICK_SPACING,
                    enabled: true
                })
            );
        if (launchEnabled) d.factory.setLaunchEnabled(true);

        // 9. Ownable2Step handoff; FINAL_OWNER must call acceptOwnership() on each.
        if (finalOwner != deployer) {
            d.hook.transferOwnership(finalOwner);
            d.locker.transferOwnership(finalOwner);
            d.buybackVault.transferOwnership(finalOwner);
            d.factory.transferOwnership(finalOwner);
        }

        vm.stopBroadcast();

        _log(d, deployer, finalOwner);
        if (vm.envOr("WRITE_DEPLOYMENT", false)) _writeJson(d, deployer, finalOwner);
    }

    /// @dev Deploys through the Arachnid proxy so the address is independent of the
    /// broadcasting account and matches what HookMiner computed.
    function _create2(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        (bool ok, bytes memory ret) = InkConfig.CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && ret.length == 20, "CREATE2 deploy failed");
        deployed = address(bytes20(ret));
    }

    function _log(Deployment memory d, address deployer, address finalOwner) internal view {
        console2.log("PonsV2FeeEscrow          ", address(d.feeEscrow));
        console2.log("PonsV2MemeHook           ", address(d.hook));
        console2.log("PonsV2LaunchLocker       ", address(d.locker));
        console2.log("PonsV2BuybackVault       ", address(d.buybackVault));
        console2.log("PonsV2LaunchFactory      ", address(d.factory));
        console2.log("PonsV2GraduationGuard    ", address(d.factory.graduationGuard()));
        console2.log("PonsV2GraduationExecutor ", address(d.graduationExecutor));
        console2.log("PonsV2LaunchDeployer     ", address(d.launchDeployer));
        console2.log("deployer                 ", deployer);
        console2.log("pending owner            ", finalOwner);
    }

    function _writeJson(Deployment memory d, address deployer, address finalOwner) internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "startBlock", block.number);
        vm.serializeAddress(obj, "feeEscrow", address(d.feeEscrow));
        vm.serializeAddress(obj, "memeHook", address(d.hook));
        vm.serializeAddress(obj, "locker", address(d.locker));
        vm.serializeAddress(obj, "buybackVault", address(d.buybackVault));
        vm.serializeAddress(obj, "factory", address(d.factory));
        vm.serializeAddress(obj, "graduationGuard", address(d.factory.graduationGuard()));
        vm.serializeAddress(obj, "graduationExecutor", address(d.graduationExecutor));
        vm.serializeAddress(obj, "launchDeployer", address(d.launchDeployer));
        vm.serializeAddress(obj, "deployer", deployer);
        string memory json = vm.serializeAddress(obj, "owner", finalOwner);
        string memory path =
            vm.envOr("DEPLOYMENT_FILE", string.concat("deployments/", vm.toString(block.chainid), ".json"));
        vm.writeJson(json, path);
    }
}
