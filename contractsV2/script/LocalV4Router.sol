// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal Uniswap v4 router for local testing: exact-input swaps and
/// full/custom-range liquidity adds straight against the PoolManager. Not for
/// production use — no slippage checks beyond the price limit, positions are
/// owned by this contract and keyed by (payer, range) via the salt.
contract LocalV4Router is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;

    enum Action {
        Swap,
        AddLiquidity
    }

    IPoolManager public immutable poolManager;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    /// @dev Exact-input swap. `amountIn` of the input currency is pulled from
    /// `msg.sender` (native: msg.value). Output is delivered to `msg.sender`.
    function swap(PoolKey memory key, bool zeroForOne, uint256 amountIn) external payable returns (BalanceDelta) {
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
        bytes memory out = poolManager.unlock(abi.encode(Action.Swap, msg.sender, abi.encode(key, params)));
        _refund(msg.sender);
        return abi.decode(out, (BalanceDelta));
    }

    /// @dev Adds liquidity over [tickLower, tickUpper] using at most amount0/amount1
    /// of each currency at the current pool price. Leftover native ETH is refunded.
    function addLiquidity(PoolKey memory key, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1)
        external
        payable
        returns (uint128 liquidity, BalanceDelta delta)
    {
        return _addLiquidity(key, tickLower, tickUpper, amount0, amount1);
    }

    /// @dev Full-range add: ticks aligned to the pool's tick spacing.
    function addFullRangeLiquidity(PoolKey memory key, uint256 amount0, uint256 amount1)
        external
        payable
        returns (uint128 liquidity, BalanceDelta delta)
    {
        int24 lower = (TickMath.MIN_TICK / key.tickSpacing) * key.tickSpacing;
        int24 upper = (TickMath.MAX_TICK / key.tickSpacing) * key.tickSpacing;
        return _addLiquidity(key, lower, upper, amount0, amount1);
    }

    function _addLiquidity(PoolKey memory key, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1)
        internal
        returns (uint128 liquidity, BalanceDelta delta)
    {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(PoolId.wrap(keccak256(abi.encode(key))));
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0,
            amount1
        );
        require(liquidity > 0, "zero liquidity");
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: int256(uint256(liquidity)),
            salt: bytes32(uint256(uint160(msg.sender)))
        });
        bytes memory out = poolManager.unlock(abi.encode(Action.AddLiquidity, msg.sender, abi.encode(key, params)));
        _refund(msg.sender);
        delta = abi.decode(out, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pm");
        (Action action, address payer, bytes memory inner) = abi.decode(data, (Action, address, bytes));
        PoolKey memory key;
        BalanceDelta delta;
        if (action == Action.Swap) {
            SwapParams memory params;
            (key, params) = abi.decode(inner, (PoolKey, SwapParams));
            delta = poolManager.swap(key, params, "");
        } else {
            ModifyLiquidityParams memory params;
            (key, params) = abi.decode(inner, (PoolKey, ModifyLiquidityParams));
            (delta,) = poolManager.modifyLiquidity(key, params, "");
        }
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

    function _refund(address to) internal {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok,) = to.call{value: bal}("");
            require(ok, "refund failed");
        }
    }

    receive() external payable {}
}
