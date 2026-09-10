const COLORS: Record<string, string> = {
  ETH: 'bg-[#627eea] text-white',
  WETH: 'bg-[#627eea] text-white',
  kBTC: 'bg-[#f7931a] text-black',
  kHYPE: 'bg-[#2ee6a6] text-black',
  KSOL: 'bg-[#9945ff] text-white',
  KDOGE: 'bg-[#c2a633] text-black',
  USDC: 'bg-[#2775ca] text-white',
  USDG: 'bg-[#1c60ff] text-white',
  USDT0: 'bg-[#26a17b] text-white',
}

/** 18px round asset glyph: token logo if we have one, otherwise a coloured monogram. */
export function AssetIcon({ symbol, logo, className = 'h-[18px] w-[18px] text-[9px]' }: { symbol: string; logo?: string; className?: string }) {
  if (logo) return <img src={logo} alt="" className={`${className} shrink-0 rounded-full object-cover`} />
  const stock = /^[A-Z]{2,5}x$/.test(symbol)
  const cls = COLORS[symbol] ?? (stock ? 'bg-gold text-black' : 'bg-kraken text-white')
  return (
    <span className={`${className} ${cls} grid shrink-0 place-items-center rounded-full font-bold leading-none`}>
      {symbol === 'ETH' || symbol === 'WETH' ? 'Ξ' : symbol.replace(/^k/, '').slice(0, stock ? 2 : 1).toUpperCase()}
    </span>
  )
}
