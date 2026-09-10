#!/usr/bin/env bash
# Local dev loop: Anvil forked from Ink + full Pons V2 stack deployed with anvil account #0.
#
#   ./dev.sh up        start anvil (fork of Ink) in the background, deploy, export ABIs
#   ./dev.sh deploy    (re)deploy against a running anvil
#   ./dev.sh abis      export ABIs to deployments/abi/*.json
#   ./dev.sh down      stop anvil
#
#   ./dev.sh fund                    give dev accounts pair tokens (xStocks, kBTC, USDC, ...) from fork whales
#   ./dev.sh pairs                   list approved pair tokens
#
#   ./dev.sh launch "Name" SYM [pair]  launch a token; pair = ETH (default) or a symbol/address from `pairs`
#   ./dev.sh buy <token> <amount>    buy from the curve in the launch's quote asset, e.g. ./dev.sh buy 0x.. 0.5
#   ./dev.sh sell <token> <tokens>   sell back to the curve, e.g. ./dev.sh sell 0x.. 1000000
#   ./dev.sh graduate <token>        sweep + seed the v4 pool once the threshold is hit
#   ./dev.sh status <token>          print curve reserves / phase
#
#   ./dev.sh bots [ticks] [ms]       run the trading bots (launch / buy / sell / graduate / LP / v4 swap)
#                                    with dev accounts #1-#9; default 200 ticks, 1500ms apart.
#                                    run FUND_ACCOUNTS=10 ./dev.sh fund first so every bot can use ERC-20 pairs
#   ./dev.sh report                  print the state of every launch (phase, reserves, hook fees)
#
# Outputs: deployments/local.json (addresses + pair tokens), deployments/abi/ (ABIs for the frontend).
# Anvil account #0 is the owner. Never use these keys anywhere but a local node.
set -euo pipefail
cd "$(dirname "$0")"

RPC="${LOCAL_RPC_URL:-http://127.0.0.1:8545}"
FORK_URL="${INK_RPC_URL:-https://rpc-gel.inkonchain.com}"
PORT="${ANVIL_PORT:-8545}"
PK="${ANVIL_PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
PIDFILE=".anvil.pid"
# anvil's 10 default accounts (mnemonic "test test ... junk")
DEV_ACCOUNTS=(
  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC 0x90F79bf6EB2c4f870365E785982E1f101E93b906
  0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
  0x976EA74026E726554dB657fA54763abd0C3a0aa9 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955
  0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
)

# On Ink mainnet the well-known anvil accounts carry an EIP-7702 delegation to a
# sweeper that forwards any ETH they receive. The fork inherits that code, so any
# fee paid to account #0 would drain it. Reset them to plain EOAs with 10k ETH.
clean_dev_accounts() {
  for a in "${DEV_ACCOUNTS[@]}"; do
    cast rpc --rpc-url "$RPC" anvil_setCode "$a" 0x >/dev/null
    cast rpc --rpc-url "$RPC" anvil_setBalance "$a" 0x21e19e0c9bab2400000 >/dev/null
  done
}

DEPLOYMENT=deployments/local.json

# Large holders on Ink mainnet at the time of writing, impersonated on the fork
# to seed dev accounts. WETH is minted by depositing ETH instead.
# symbol|token|whale|amount (whole units) per dev account
PAIR_WHALES=(
  "kBTC|0x73E0C0d45E048D25Fc26Fa3159b0aA04BfA4Db98|0x6201A5Ed5Ee67A6B5252926e8C029c89D74f9eed|2"
  "kHYPE|0xAd09Cd20e513E4d8cB78036F77Ab9AfdE8555929|0x0d00d4b73f87Dc7b865f12f0bBe15d61E37a0E3b|2000"
  "KSOL|0x18E4CeBa93B5c16aED900e07d142d15B1E5A78fB|0x4C1A07Bfb5bca9A22798760b85979bf65B103556|500"
  "KDOGE|0x117700dd7fc37eE6a97e85f825545d633fBe29B6|0xE00EEe550Bfd359aD6e14076FC17a709e9ab337B|400000"
  "USDT0|0x0200C29006150606B650577BBE7B6248F58470c1|0x77134cbC06cB00b66F4c7e623D5fdBF6777635EC|100000"
  "USDC|0x2D270e6886d130D724215A266106e6832161EAEd|0x70A38B0c90441e991346B7A0Cd98C8528dD1c234|100000"
  "USDG|0xe343167631d89B6Ffc58B88d6b7fB0228795491D|0x3e17f00A166C278F357A9aaB4e2148b9c3CFd8E4|100000"
  "TSLAx|0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0|0x5F7A4c11bde4f218f0025Ef444c369d838ffa2aD|250"
  "NVDAx|0xc845b2894dBddd03858fd2D643B4eF725fE0849d|0x5F7A4c11bde4f218f0025Ef444c369d838ffa2aD|500"
  "SPYx|0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48|0x5F7A4c11bde4f218f0025Ef444c369d838ffa2aD|150"
  "AAPLx|0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a|0x5F7A4c11bde4f218f0025Ef444c369d838ffa2aD|400"
)
WETH=0x4200000000000000000000000000000000000006
FUND_ACCOUNTS="${FUND_ACCOUNTS:-3}" # how many dev accounts to fund with pair tokens

# Transfer pair tokens from mainnet whales to the first $FUND_ACCOUNTS dev accounts.
fund() {
  local n="$FUND_ACCOUNTS"
  for entry in "${PAIR_WHALES[@]}"; do
    IFS='|' read -r sym token whale amount <<<"$entry"
    local dec; dec=$(cast call --rpc-url "$RPC" "$token" 'decimals()(uint8)')
    local raw; raw=$(cast parse-units "$amount" "$dec")
    cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$whale" >/dev/null
    cast rpc --rpc-url "$RPC" anvil_setBalance "$whale" 0x3635c9adc5dea00000 >/dev/null
    local ok=0
    for a in "${DEV_ACCOUNTS[@]:0:$n}"; do
      if cast send --rpc-url "$RPC" --unlocked --from "$whale" "$token" 'transfer(address,uint256)' "$a" "$raw" >/dev/null 2>&1; then
        ok=$((ok + 1))
      fi
    done
    cast rpc --rpc-url "$RPC" anvil_stopImpersonatingAccount "$whale" >/dev/null
    if [ "$ok" -eq "$n" ]; then echo "  $sym: $amount x $n accounts"; else echo "  $sym: whale $whale transfer failed ($ok/$n) - balance moved since this script was written?" >&2; fi
  done
  for a in "${DEV_ACCOUNTS[@]:0:$n}"; do
    cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$a" >/dev/null
    cast send --rpc-url "$RPC" --unlocked --from "$a" "$WETH" 'deposit()' --value "$(cast to-wei 100)" >/dev/null
    cast rpc --rpc-url "$RPC" anvil_stopImpersonatingAccount "$a" >/dev/null
  done
  echo "  WETH: 100 x $n accounts"
}

pairs() {
  jq -r '.pairTokens[] | "\(.symbol)\t\(.decimals)\t\(.address)"' "$DEPLOYMENT"
}

# Resolve ETH / a symbol / an address to a pair token address (0x0 for ETH).
pair_address() {
  case "${1:-ETH}" in
    ETH|eth|0x0000000000000000000000000000000000000000) echo 0x0000000000000000000000000000000000000000 ;;
    0x*) echo "$1" ;;
    *) jq -er --arg s "$1" '.pairTokens[] | select(.symbol | ascii_downcase == ($s | ascii_downcase)) | .address' "$DEPLOYMENT" \
         || { echo "unknown pair '$1' (see ./dev.sh pairs)" >&2; exit 1; } ;;
  esac
}

# Decimals of a launch's quote asset, so `buy` amounts can be typed in whole units.
quote_decimals() { # <launched token>
  local factory pair
  factory=$(jq -r .factory "$DEPLOYMENT")
  pair=$(cast call --rpc-url "$RPC" "$factory" 'getLaunchedToken(address)((address,address,address,address,address,uint256,uint24,int24,uint16,bool,uint8,uint256,uint256,uint256,bool))' "$1" \
    | tr -d '(' | cut -d, -f5 | tr -d ' ')
  if [ "$pair" = "0x0000000000000000000000000000000000000000" ]; then echo 18; else cast call --rpc-url "$RPC" "$pair" 'decimals()(uint8)'; fi
}

start_anvil() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "anvil already running (pid $(cat "$PIDFILE"))"; return
  fi
  anvil --fork-url "$FORK_URL" --chain-id 57073 --port "$PORT" --block-time "${ANVIL_BLOCK_TIME:-2}" \
    > anvil.log 2>&1 &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 30); do
    cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break
    sleep 1
  done
  clean_dev_accounts
  echo "anvil up on $RPC (fork of Ink @ block $(cast block-number --rpc-url "$RPC")), log: anvil.log"
}

deploy() {
  WRITE_DEPLOYMENT=true DEPLOYMENT_FILE="$DEPLOYMENT" \
    forge script script/DeployInk.s.sol:DeployInk --rpc-url "$RPC" --private-key "$PK" --broadcast -q
  # dev-only v4 router (swap + add liquidity on graduated pools) for the bots / frontend
  local router
  router=$(forge script script/DeployLocalRouter.s.sol:DeployLocalRouter --rpc-url "$RPC" --private-key "$PK" --broadcast \
    | sed -n 's/.*LocalV4Router: \(0x[0-9a-fA-F]*\).*/\1/p' | head -1)
  jq --arg r "$router" '.v4Router = $r' "$DEPLOYMENT" > "$DEPLOYMENT.tmp" && mv "$DEPLOYMENT.tmp" "$DEPLOYMENT"
  echo "deployed -> $DEPLOYMENT"
  jq 'del(.pairTokens)' "$DEPLOYMENT"
  echo "pair tokens: $(jq -r '[.pairTokens[].symbol] | join(", ")' "$DEPLOYMENT")"
}

abis() {
  mkdir -p deployments/abi
  local ts="../frontend/src/generated/abis.ts"
  mkdir -p "$(dirname "$ts")"
  echo "// generated by contractsV2/dev.sh abis -- do not edit" > "$ts"
  for c in PonsV2LaunchFactory PonsV2BondingCurve PonsV2LauncherToken PonsV2MemeHook \
           PonsV2LaunchLocker PonsV2BuybackVault PonsV2FeeEscrow PonsV2GraduationExecutor LocalV4Router; do
    forge inspect "$c" abi --json > "deployments/abi/$c.json"
    { echo "export const ${c#PonsV2}Abi = $(cat "deployments/abi/$c.json") as const;"; echo; } >> "$ts"
  done
  echo "ABIs -> deployments/abi/ and $ts"
}

ll() { # <sig> <args...> : run a LocalLaunch helper and broadcast it
  local sig=$1; shift
  RUST_LOG=error forge script script/LocalLaunch.s.sol:LocalLaunch --sig "$sig" "$@" \
    --rpc-url "$RPC" --private-key "$PK" --broadcast
}

case "${1:-up}" in
  up)     start_anvil; deploy; abis; echo "funding dev accounts with pair tokens:"; fund ;;
  deploy) clean_dev_accounts; deploy ;;
  abis)   abis ;;
  fund)   fund ;;
  pairs)  pairs ;;
  launch)   ll "launch(string,string,address)" "$2" "$3" "$(pair_address "${4:-ETH}")" ;;
  buy)      ll "buy(address,uint256)" "$2" "$(cast parse-units "$3" "$(quote_decimals "$2")")" ;;
  sell)     ll "sell(address,uint256)" "$2" "$(cast to-wei "$3")" ;;
  graduate) ll "graduate(address)" "$2" ;;
  status)   RUST_LOG=error forge script script/LocalLaunch.s.sol:LocalLaunch --sig "status(address)" "$2" --rpc-url "$RPC" ;;
  bots)     (cd ../frontend && node scripts/bots.ts --ticks "${2:-200}" --interval "${3:-1500}") ;;
  report)   (cd ../frontend && node scripts/bots.ts --report) ;;
  down)   [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null && rm -f "$PIDFILE" && echo "anvil stopped" || echo "anvil not running" ;;
  *) echo "usage: $0 {up|deploy|abis|fund|pairs|down|launch|buy|sell|graduate|status|bots|report}"; exit 1 ;;
esac
