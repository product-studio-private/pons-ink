// Client-side mirror of the bonding-curve pricing for previews. Ignores the
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

/**
 * Prices are fixed-point with `PRICE_SCALE` extra digits: quote base units per whole launcher
 * token, times 1e18. Format them with `pair.decimals + PRICE_DECIMALS`. Without the extra
 * scale a 6-decimal quote (USDC) truncates to whole micro-dollars per token.
 */
export const PRICE_DECIMALS = 18
export const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS)

/** quote * PRICE_SCALE / tokens, both in base units (launcher tokens are always 18 decimals). */
export function priceOf(quote: bigint, tokens: bigint): bigint {
  if (tokens === 0n) return 0n
  return (quote * 10n ** 18n * PRICE_SCALE) / tokens
}

export function spotPrice(s: CurveState): bigint {
  return priceOf(s.quoteReserve, s.tokenReserve)
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
  return priceOf(l.sweptQuote, l.sweptTokens)
}

/** Tokens bought off the curve (excludes the allocation swept into the pool). */
export function tokensSold(l: PricedLaunch): bigint {
  if (l.phase === 0) return l.supply - l.tokenReserve
  return l.supply - l.sweptTokens
}

/** Quote base units worth of `tokens` (18-decimal base units) at a scaled price. */
export function valueAt(price: bigint, tokens: bigint): bigint {
  return (price * tokens) / (10n ** 18n * PRICE_SCALE)
}

/** Market cap in quote base units. */
export function marketCap(l: PricedLaunch): bigint {
  return valueAt(launchPrice(l), l.supply)
}

export function withSlippage(amount: bigint, bps: number): bigint {
  return (amount * (BPS - BigInt(bps))) / BPS
}
