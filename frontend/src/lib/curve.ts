// Client-side mirror of PonsV2BondingCurve pricing for previews. Ignores the
// launch-second snipe tax, so quotes right after launch are optimistic.
const BPS = 10_000n

function amountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  return (amountIn * reserveOut) / (reserveIn + amountIn)
}

export interface CurveState {
  quoteReserve: bigint
  tokenReserve: bigint
  sellable: bigint
  feeBps: bigint
  creatorTaxBps: bigint
}

export function previewBuy(s: CurveState, quoteIn: bigint): { tokensOut: bigint; clamped: boolean } {
  const fee = (quoteIn * (s.feeBps + s.creatorTaxBps)) / BPS
  const out = amountOut(quoteIn - fee, s.quoteReserve, s.tokenReserve)
  if (out > s.sellable) return { tokensOut: s.sellable, clamped: true }
  return { tokensOut: out, clamped: false }
}

export function previewSell(s: CurveState, tokensIn: bigint): bigint {
  const gross = amountOut(tokensIn, s.tokenReserve, s.quoteReserve)
  return gross - (gross * (s.feeBps + s.creatorTaxBps)) / BPS
}

/** Spot price in quote wei per whole token (1e18 units). */
export function spotPrice(s: CurveState): bigint {
  if (s.tokenReserve === 0n) return 0n
  return (s.quoteReserve * 10n ** 18n) / s.tokenReserve
}

interface PricedLaunch extends CurveState {
  phase: number
  supply: bigint
  sweptQuote: bigint
  sweptTokens: bigint
}

/** Curve spot price while bonding; after the sweep, the price the v4 pool was seeded at. */
export function launchPrice(l: PricedLaunch): bigint {
  if (l.phase === 0) return spotPrice(l)
  if (l.sweptTokens === 0n) return 0n
  return (l.sweptQuote * 10n ** 18n) / l.sweptTokens
}

/** Tokens bought off the curve (excludes the allocation swept into the pool). */
export function tokensSold(l: PricedLaunch): bigint {
  if (l.phase === 0) return l.supply - l.tokenReserve
  return l.supply - l.sweptTokens
}

export function withSlippage(amount: bigint, bps: number): bigint {
  return (amount * (BPS - BigInt(bps))) / BPS
}
