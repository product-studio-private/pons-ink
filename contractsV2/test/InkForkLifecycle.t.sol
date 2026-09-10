// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DeployInk} from "../script/DeployInk.s.sol";
import {InkConfig} from "../script/InkConfig.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2BondingCurve} from "../src/v2/PonsV2BondingCurve.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {GraduationPhase, IPonsV2LaunchFactory} from "../src/v2/interfaces/ILaunchpadV2.sol";

/// @dev Minimal v4 swapper: settles the input currency and takes the output.
contract SwapRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;

    IPoolManager internal immutable poolManager;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function swap(PoolKey memory key, SwapParams memory params) external payable returns (BalanceDelta) {
        return abi.decode(poolManager.unlock(abi.encode(key, params, msg.sender)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pm");
        (PoolKey memory key, SwapParams memory params, address payer) = abi.decode(data, (PoolKey, SwapParams, address));
        BalanceDelta delta = poolManager.swap(key, params, "");
        _settle(key.currency0, delta.amount0(), payer);
        _settle(key.currency1, delta.amount1(), payer);
        return abi.encode(delta);
    }

    function _settle(Currency c, int128 amount, address payer) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (c.isAddressZero()) {
                poolManager.settle{value: owed}();
            } else {
                poolManager.sync(c);
                IERC20(Currency.unwrap(c)).transferFrom(payer, address(poolManager), owed);
                poolManager.settle();
            }
        } else if (amount > 0) {
            poolManager.take(c, payer, uint256(uint128(amount)));
        }
    }

    receive() external payable {}
}

/**
 * @notice Runs the whole Pons V2 lifecycle against a fork of Ink mainnet:
 * deploy via DeployInk, launch a token, buy through the curve until it
 * graduates, seed the Uniswap v4 pool, then swap on that pool so the
 * PonsV2MemeHook afterSwap fee path executes against the real Ink PoolManager.
 *
 * Run: INK_RPC_URL=https://rpc-gel.inkonchain.com forge test --match-contract InkForkLifecycle -vv
 */
contract InkForkLifecycle is Test {
    using PoolIdLibrary for PoolKey;

    DeployInk.Deployment internal d;
    address internal deployer = makeAddr("deployer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.createSelectFork(vm.envOr("INK_RPC_URL", string("https://rpc-gel.inkonchain.com")));
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        DeployInk script = new DeployInk();
        vm.setEnv("FINAL_OWNER", vm.toString(deployer));
        d = script.run();
    }

    function test_deploymentWiring() public view {
        assertEq(address(d.factory.poolManager()), InkConfig.INK_POOL_MANAGER);
        assertEq(address(d.factory.positionManager()), InkConfig.INK_POSITION_MANAGER);
        assertEq(address(d.factory.memeHook()), address(d.hook));
        assertEq(d.hook.factory(), address(d.factory));
        assertEq(address(d.hook.buybackVault()), address(d.buybackVault));
        assertEq(d.locker.factory(), address(d.factory));
        assertEq(d.buybackVault.factory(), address(d.factory));
        assertEq(address(d.factory.graduationExecutor()), address(d.graduationExecutor));
        assertEq(address(d.factory.launchDeployer()), address(d.launchDeployer));
        assertTrue(d.factory.launchEnabled());
        assertEq(d.factory.launchConfigCount(), 1);
        assertEq(uint160(address(d.hook)) & ((1 << 14) - 1), 0x2044);
    }

    function test_pairTokensApproved() public {
        InkConfig.PairToken[] memory pairs = InkConfig.pairTokens();
        for (uint256 i = 0; i < pairs.length; i++) {
            assertTrue(d.factory.approvedPairTokens(pairs[i].token), pairs[i].symbol);
            (uint256 phantom, uint256 threshold, uint8 decimals) = d.factory.pairTokenEconomics(pairs[i].token);
            assertEq(phantom, pairs[i].phantomQuote);
            assertEq(threshold, pairs[i].graduationThreshold);
            assertEq(decimals, pairs[i].decimals);
        }
        assertFalse(d.factory.approvedPairTokens(makeAddr("random-erc20")));
    }

    /// @dev Same lifecycle as the native test but quoted in an xStock (TSLAx): the
    /// curve pulls the ERC-20 via transferFrom, graduates at the per-asset
    /// threshold, and seeds a TSLAx/token v4 pool.
    function test_launchBuyGraduateWithXStockPair() public {
        address pair = InkConfig.TSLAX;
        uint256 threshold = 38 ether;
        deal(pair, bob, 100 ether);

        PonsV2LaunchFactory.TokenParams memory params = PonsV2LaunchFactory.TokenParams({
            name: "Tesla Pons",
            symbol: "TSLP",
            logo: "",
            description: "xstock-paired fork test",
            socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
            creatorFeeRecipient: alice,
            creatorTaxBps: 100,
            buybackEnabled: true,
            expectedEconomics: bytes32(0),
            salt: bytes32(uint256(1))
        });
        uint256 launchFee = d.factory.launchFee();
        address unapproved = makeAddr("random-erc20");
        vm.prank(alice);
        vm.expectRevert(PonsV2LaunchFactory.PairTokenNotApproved.selector);
        d.factory.launchToken{value: launchFee}(params, 0, unapproved);

        vm.prank(alice);
        (address token, address curveAddr) = d.factory.launchToken{value: launchFee}(params, 0, pair);
        PonsV2BondingCurve curve = PonsV2BondingCurve(curveAddr);
        IPonsV2LaunchFactory.LaunchedToken memory launch = d.factory.getLaunchedToken(token);
        assertEq(launch.pairToken, pair);
        assertEq(launch.graduationThreshold, threshold);

        vm.warp(block.timestamp + 60);

        // Small buy: TSLAx leaves bob, tokens arrive, curve holds the quote.
        vm.startPrank(bob);
        IERC20(pair).approve(curveAddr, type(uint256).max);
        vm.expectRevert();
        curve.buy{value: 1 ether}(1 ether, 0, bob); // native value on an ERC-20 launch must revert
        uint256 out = curve.buy(1 ether, 0, bob);
        assertGt(out, 0);
        assertEq(IERC20(token).balanceOf(bob), out);
        assertEq(IERC20(pair).balanceOf(curveAddr), 1 ether);

        // Sell half back, get TSLAx.
        IERC20(token).approve(curveAddr, out / 2);
        uint256 pairBefore = IERC20(pair).balanceOf(bob);
        curve.sell(out / 2, 0, bob);
        assertGt(IERC20(pair).balanceOf(bob), pairBefore);

        // Buy past the threshold: auto-graduates.
        curve.buy(60 ether, 0, bob);
        vm.stopPrank();
        assertTrue(curve.graduated(), "curve should auto-graduate on threshold");
        launch = d.factory.getLaunchedToken(token);
        assertEq(uint8(launch.phase), uint8(GraduationPhase.Swept));
        assertGe(launch.sweptQuote, threshold * 9 / 10);

        uint256 positionId = d.factory.createGraduatedPool(token);
        assertGt(positionId, 0);
        launch = d.factory.getLaunchedToken(token);
        assertEq(uint8(launch.phase), uint8(GraduationPhase.PoolCreated));

        // Swap TSLAx -> token on the graduated pool through the hook.
        (Currency c0, Currency c1) =
            token < pair ? (Currency.wrap(token), Currency.wrap(pair)) : (Currency.wrap(pair), Currency.wrap(token));
        PoolKey memory key = PoolKey({
            currency0: c0,
            currency1: c1,
            fee: launch.poolFee,
            tickSpacing: launch.tickSpacing,
            hooks: IHooks(address(d.hook))
        });
        SwapRouter router = new SwapRouter(IPoolManager(InkConfig.INK_POOL_MANAGER));
        bool pairIsZero = Currency.unwrap(c0) == pair;
        uint256 bobTokensBefore = IERC20(token).balanceOf(bob);
        vm.startPrank(bob);
        IERC20(pair).approve(address(router), type(uint256).max);
        router.swap(
            key,
            SwapParams({
                zeroForOne: pairIsZero,
                amountSpecified: -1 ether,
                sqrtPriceLimitX96: pairIsZero ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            })
        );
        vm.stopPrank();
        assertGt(IERC20(token).balanceOf(bob), bobTokensBefore, "swap should deliver tokens");
        assertGt(d.hook.pendingFees(key.toId(), token), 0, "hook should have accrued memecoin fees");
    }

    function test_launchBuyGraduateAndSwapOnInk() public {
        // Launch
        PonsV2LaunchFactory.TokenParams memory params = PonsV2LaunchFactory.TokenParams({
            name: "Ink Pons",
            symbol: "INKP",
            logo: "",
            description: "fork test",
            socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
            creatorFeeRecipient: alice,
            creatorTaxBps: 100,
            buybackEnabled: true,
            expectedEconomics: bytes32(0),
            salt: bytes32(0)
        });
        vm.prank(alice);
        (address token, address curveAddr) = d.factory.launchToken{value: d.factory.launchFee()}(params, 0, address(0));
        PonsV2BondingCurve curve = PonsV2BondingCurve(curveAddr);
        assertEq(IERC20(token).balanceOf(curveAddr), InkConfig.DEFAULT_SUPPLY);

        // Skip the anti-snipe window, then buy past the graduation threshold.
        vm.warp(block.timestamp + 60);
        vm.prank(bob);
        curve.buy{value: 6 ether}(6 ether, 0, bob);
        assertTrue(curve.graduated(), "curve should auto-graduate on threshold");
        assertGt(IERC20(token).balanceOf(bob), 0);

        IPonsV2LaunchFactory.LaunchedToken memory launch = d.factory.getLaunchedToken(token);
        assertEq(uint8(launch.phase), uint8(GraduationPhase.Swept));

        // Phase 2: seed the v4 pool on Ink's PoolManager, LP NFT goes to the locker.
        uint256 positionId = d.factory.createGraduatedPool(token);
        assertGt(positionId, 0);
        launch = d.factory.getLaunchedToken(token);
        assertEq(uint8(launch.phase), uint8(GraduationPhase.PoolCreated));

        // Swap ETH -> token on the graduated pool through the hook.
        (Currency c0, Currency c1) = token < address(0)
            ? (Currency.wrap(token), Currency.wrap(address(0)))
            : (Currency.wrap(address(0)), Currency.wrap(token));
        PoolKey memory key = PoolKey({
            currency0: c0,
            currency1: c1,
            fee: launch.poolFee,
            tickSpacing: launch.tickSpacing,
            hooks: IHooks(address(d.hook))
        });
        SwapRouter router = new SwapRouter(IPoolManager(InkConfig.INK_POOL_MANAGER));

        uint256 bobTokensBefore = IERC20(token).balanceOf(bob);
        vm.prank(bob);
        router.swap{value: 0.5 ether}(
            key,
            SwapParams({zeroForOne: true, amountSpecified: -0.5 ether, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1})
        );
        assertGt(IERC20(token).balanceOf(bob), bobTokensBefore, "swap should deliver tokens");

        // Hook took its afterSwap cut on the output currency (the memecoin).
        PoolId poolId = key.toId();
        assertGt(d.hook.pendingFees(poolId, token), 0, "hook should have accrued memecoin fees");
    }
}
