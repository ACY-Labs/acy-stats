import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client'
import fetch from 'cross-fetch';
import { getLogger } from './helpers'
const logger = getLogger('routes')
const apolloOptions = {
    query: {
      fetchPolicy: 'no-cache'
    },
    watchQuery: {
      fetchPolicy: 'no-cache'
    }
  }
// eth mainnet
const ethGraphClient = new ApolloClient({
    link: new HttpLink({ uri: 'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-subgraph', fetch }),
    cache: new InMemoryCache(),
    defaultOptions: apolloOptions
})

const polygonGraphClient = new ApolloClient({
    link: new HttpLink({ uri: 'https://api.thegraph.com/subgraphs/name/linja19/uniswap-v3-4', fetch }),
    cache: new InMemoryCache(),
    defaultOptions: apolloOptions
})

export async function getRates(token0,token1,chainId){
    const entities = "newSwaps"
    const fragment = (skip) => {
      return `${entities}(
        first: 1000
        skip: ${skip}
        orderBy: timestamp
        orderDirection: desc
        where: {
          token0_: {id:"${token0}"},
          token1_: {id:"${token1}"}
        }
      ) { timestamp,transaction{id},exchangeRate,token0Price,token1Price }\n`
    }
    const token = (token) => {
      return `newToken(
        id: "${token}"
      ) { name,symbol }\n`
    }
    // const queryString = `{
    //    p0: ${fragment(0)}
      //  p1: ${fragment(1000)}
      //  p2: ${fragment(2000)}
      //  p3: ${fragment(3000)}
      //  p4: ${fragment(4000)}
      //  p5: ${fragment(5000)}
    // }`
    const queryString = `{
        p0: ${fragment(0)}
        token0: ${token(token0)}
        token1: ${token(token1)}
        ethPrices: bundle(id:1){ethPriceUSD}
    }`
    // const queryString = `{
    //   p0: ${fragment(0)}
    // }`
    const query = gql(queryString)

    const graphClient = polygonGraphClient
    const { data } = await graphClient.query({query})
    const rates = [
        ...data.p0,
        // ...data.p1,
        // ...data.p2,
        // ...data.p3,
        // ...data.p4,
        // ...data.p5
    ]
    const result = {token0:data.token0,token1:data.token1,rates:rates}
    return result
}

// token0 <-> token1
// candle
// add transaction id into swap, ad priceUSD into token
export async function getTokenInfo(result){
  const token0Price = result.rates[0].token0Price
  const token1Price = result.rates[0].token1Price
  let token0Info = result.token0
  let token1Info = result.token1
  token0Info["priceUSD"] = token0Price
  token1Info["priceUSD"] = token1Price
  return {token0:token0Info,token1:token1Info}
}

function toReadable(ts) {
  // in UTC+0
  return (new Date(ts * 1000).toISOString()).replace('T', ' ').replace('.000Z', '')
}

const periodsMap = {
  '1m': 60 * 1,
  '5m': 60 * 5,
  '15m': 60 * 15,
  '1h': 60 * 60,
  '4h': 60 * 60 * 4,
  '1d': 60 * 60 * 24,
  '1w': 60 * 60 * 24 * 7
}

export function ratesToCandles(rates, period='1m', token0, token1, chainId, dex='Uniswap V3') {
  const periodTime = periodsMap[period]

  if (rates.length < 2) {
    return []
  }

  const candles = []
  const first = rates[rates.length-1]
  let prevTsGroup = Math.floor(first.timestamp / periodTime) * periodTime
  let prevRates = Number(first.exchangeRate)
  let prevTs = first.timestamp
  let o = prevRates
  let h = prevRates
  let l = prevRates
  let c = prevRates
  let countPerInterval = 1;  // number of prices in current interval
  for (let i = rates.length-2; i >= 0; i--) {
    const ts = rates[i].timestamp;
    const rate = Number(rates[i].exchangeRate);
    //const [ts, price] = prices[i]
    const tsGroup = ts - (ts % periodTime)

    if (prevTs > ts) {
      logger.warn(`Invalid order prevTs: ${prevTs} (${toReadable(prevTs)}) ts: ${ts} (${toReadable(ts)})`)
      continue
    }

    if (prevTsGroup !== tsGroup) {
      if (countPerInterval == 1) {
        candles.push({ timestamp: prevTsGroup, o, h: h * 1.0003, l: l * 0.9996, c, token0, token1, chainId, dex });
      } else {
        candles.push({ timestamp: prevTsGroup, o, h, l, c, token0, token1, chainId, dex });
      }
      countPerInterval = 0;
      o = c
      h = o > c ? o : c
      l = o < c ? o : c
    }
    c = rate
    h = h > rate ? h : rate
    l = l < rate ? l : rate
    prevTsGroup = tsGroup
    prevTs = ts
    countPerInterval += 1;
  }
  // last interval might not be a completed interval, so need to handle separately
  if (countPerInterval == 1) {
    //console.log(`final push1, prevTsGroup:${prevTsGroup} h:${h}, l:${l}, o:${o}, c:${c}`);
    candles.push({ timestamp: prevTsGroup, o, h: h * 1.0003, l: l * 0.9996, c, token0, token1, chainId, dex });
  } else {
    //console.log(`final push1, prevTsGroup:${prevTsGroup} h:${h}, l:${l}, o:${o}, c:${c}`);
    candles.push({ timestamp: prevTsGroup, o, h, l, c, token0, token1, chainId, dex });
  }

  return candles
}