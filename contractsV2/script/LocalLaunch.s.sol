// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2BondingCurve} from "../src/v2/PonsV2BondingCurve.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {IPonsV2LaunchFactory, GraduationPhase} from "../src/v2/interfaces/ILaunchpadV2.sol";

/**
 * @title LocalLaunch
 * @notice Dev helpers for exercising a deployed stack on a local Anvil fork.
 *         Reads the factory address from DEPLOYMENT_FILE (default deployments/local.json).
 *
 *   forge script script/LocalLaunch.s.sol:LocalLaunch --sig "launch(string,string)" "Test" "TST" \
 *       --rpc-url local --private-key $PK --broadcast
 *   forge script script/LocalLaunch.s.sol:LocalLaunch --sig "launch(string,string,address)" "Test" "TST" $TSLAX ...
 *   forge script script/LocalLaunch.s.sol:LocalLaunch --sig "buy(address,uint256)" $TOKEN 1ether ...
 *       (quoteIn is in the launch's quote asset base units; ERC-20 pairs are approved first)
 *   forge script script/LocalLaunch.s.sol:LocalLaunch --sig "sell(address,uint256)" $TOKEN 1000ether ...
 *   forge script script/LocalLaunch.s.sol:LocalLaunch --sig "graduate(address)" $TOKEN ...
 *   forge script script/LocalLaunch.s.sol:LocalLaunch --sig "status(address)" $TOKEN --rpc-url local
 */
contract LocalLaunch is Script {
    function factory() internal view returns (PonsV2LaunchFactory) {
        string memory path = vm.envOr("DEPLOYMENT_FILE", string("deployments/local.json"));
        return PonsV2LaunchFactory(payable(vm.parseJsonAddress(vm.readFile(path), ".factory")));
    }

    /// @notice Launch a token with native ETH as quote using launch config 0.
    function launch(string memory name, string memory symbol) external returns (address token, address curve) {
        return _launch(name, symbol, address(0));
    }

    /// @notice Launch a token quoted in an approved ERC-20 pair (xStock, kBTC, USDC, ...).
    function launch(string memory name, string memory symbol, address pairToken)
        external
        returns (address token, address curve)
    {
        return _launch(name, symbol, pairToken);
    }

    function _launch(string memory name, string memory symbol, address pairToken)
        internal
        returns (address token, address curve)
    {
        PonsV2LaunchFactory f = factory();
        (, address sender,) = vm.readCallers();
        require(pairToken == address(0) || f.approvedPairTokens(pairToken), "pair token not approved");

        PonsV2LaunchFactory.TokenParams memory params = PonsV2LaunchFactory.TokenParams({
            name: name,
            symbol: symbol,
            logo: "",
            description: "local dev launch",
            socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
            creatorFeeRecipient: sender,
            creatorTaxBps: 100,
            buybackEnabled: true,
            expectedEconomics: bytes32(0),
            salt: keccak256(abi.encode(sender, block.number, name, symbol))
        });

        vm.startBroadcast();
        (token, curve) = f.launchToken{value: f.launchFee()}(params, 0, pairToken);
        vm.stopBroadcast();

        console2.log("token ", token);
        console2.log("curve ", curve);
        console2.log("pair  ", pairToken);
    }

    /// @notice Buy from the curve with `quoteIn` base units of the launch's quote asset
    ///         (wei for ETH launches). Auto-graduates if it crosses the threshold.
    function buy(address token, uint256 quoteIn) external {
        PonsV2BondingCurve curve = _curve(token);
        address pair = factory().getLaunchedToken(token).pairToken;
        (, address sender,) = vm.readCallers();
        vm.startBroadcast();
        uint256 out;
        if (pair == address(0)) {
            out = curve.buy{value: quoteIn}(quoteIn, 0, sender);
        } else {
            IERC20(pair).approve(address(curve), quoteIn);
            out = curve.buy(quoteIn, 0, sender);
        }
        vm.stopBroadcast();
        console2.log("tokens out", out);
        _status(token);
    }

    function sell(address token, uint256 tokensIn) external {
        PonsV2BondingCurve curve = _curve(token);
        (, address sender,) = vm.readCallers();
        vm.startBroadcast();
        PonsV2LauncherToken(token).approve(address(curve), tokensIn);
        uint256 out = curve.sell(tokensIn, 0, sender);
        vm.stopBroadcast();
        console2.log("quote out", out);
        _status(token);
    }

    /// @notice Run whichever graduation step is next: sweep the curve, then seed the v4 pool.
    function graduate(address token) external {
        PonsV2LaunchFactory f = factory();
        IPonsV2LaunchFactory.LaunchedToken memory l = f.getLaunchedToken(token);
        vm.startBroadcast();
        if (l.phase == GraduationPhase.NotGraduated) f.graduate(token);
        l = f.getLaunchedToken(token);
        if (l.phase == GraduationPhase.Swept) {
            uint256 positionId = f.createGraduatedPool(token);
            console2.log("position id", positionId);
        }
        vm.stopBroadcast();
        _status(token);
    }

    function status(address token) external view {
        _status(token);
    }

    function _curve(address token) internal view returns (PonsV2BondingCurve) {
        return PonsV2BondingCurve(payable(factory().getLaunchedToken(token).curve));
    }

    function _status(address token) internal view {
        IPonsV2LaunchFactory.LaunchedToken memory l = factory().getLaunchedToken(token);
        PonsV2BondingCurve curve = PonsV2BondingCurve(payable(l.curve));
        (uint256 q, uint256 t) = curve.getReserves();
        console2.log("pair token       ", l.pairToken);
        console2.log("phase            ", uint8(l.phase));
        console2.log("quote reserve    ", q);
        console2.log("token reserve    ", t);
        console2.log("real quote       ", curve.realQuoteReserve());
        console2.log("threshold        ", l.graduationThreshold);
        console2.log("ready to graduate", curve.readyToGraduate());
    }
}
