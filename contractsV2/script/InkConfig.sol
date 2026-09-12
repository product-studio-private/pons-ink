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

    /**
     * @notice An ERC-20 quote asset launches may be paired against, with the
     * curve economics sized in that asset's own decimals. Both figures peg to
     * roughly the same notional as the native 1.68 / 4.2 ETH defaults and keep
     * the same 0.4 phantom:threshold ratio; the factory owner can refresh them
     * with `setPairTokenEconomics` as prices move.
     */
    struct PairToken {
        address token;
        string symbol;
        uint8 decimals;
        uint256 phantomQuote;
        uint256 graduationThreshold;
    }

    // Kraken / Ink ecosystem assets
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant KBTC = 0x73E0C0d45E048D25Fc26Fa3159b0aA04BfA4Db98;
    address internal constant KHYPE = 0xAd09Cd20e513E4d8cB78036F77Ab9AfdE8555929;
    address internal constant KSOL = 0x18E4CeBa93B5c16aED900e07d142d15B1E5A78fB;
    address internal constant KDOGE = 0x117700dd7fc37eE6a97e85f825545d633fBe29B6;
    address internal constant USDT0 = 0x0200C29006150606B650577BBE7B6248F58470c1;
    address internal constant USDC = 0x2D270e6886d130D724215A266106e6832161EAEd;
    address internal constant USDG = 0xe343167631d89B6Ffc58B88d6b7fB0228795491D;

    // xStocks (Backed) tokenized equities
    address internal constant TSLAX = 0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0;
    address internal constant NVDAX = 0xc845b2894dBddd03858fd2D643B4eF725fE0849d;
    address internal constant SPYX = 0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48;
    address internal constant AAPLX = 0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a;

    /// @notice Every ERC-20 quote asset approved at deploy time. Anything not in
    /// this list is rejected by the factory (`PairTokenNotApproved`).
    function pairTokens() internal pure returns (PairToken[] memory list) {
        list = new PairToken[](12);
        list[0] = PairToken(WETH, "WETH", 18, 1.68 ether, 4.2 ether);
        list[1] = PairToken(KBTC, "kBTC", 8, 0.056e8, 0.14e8);
        list[2] = PairToken(KHYPE, "kHYPE", 18, 132 ether, 330 ether);
        list[3] = PairToken(KSOL, "KSOL", 18, 30 ether, 75 ether);
        list[4] = PairToken(KDOGE, "KDOGE", 18, 24_000 ether, 60_000 ether);
        list[5] = PairToken(USDT0, "USDT0", 6, 6_000e6, 15_000e6);
        list[6] = PairToken(USDC, "USDC", 6, 6_000e6, 15_000e6);
        list[7] = PairToken(USDG, "USDG", 6, 6_000e6, 15_000e6);
        list[8] = PairToken(TSLAX, "TSLAx", 18, 15.2 ether, 38 ether);
        list[9] = PairToken(NVDAX, "NVDAx", 18, 33.6 ether, 84 ether);
        list[10] = PairToken(SPYX, "SPYx", 18, 9.6 ether, 24 ether);
        list[11] = PairToken(AAPLX, "AAPLx", 18, 24 ether, 60 ether);
    }
}
