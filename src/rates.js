import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client'
import fetch from 'cross-fetch';
import { getLogger } from './helpers'
import { CandleModel } from './CandleModel';
const logger = getLogger('rates')
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

const polygonGraphClientTest = new ApolloClient({
    link: new HttpLink({ uri: 'https://api.thegraph.com/subgraphs/id/QmUkVaXRD8Jog5V9HpP1KPCGtswLDC34X4hgg4p5LKYdX5', fetch }),
    cache: new InMemoryCache(),
    defaultOptions: apolloOptions
})

export async function getRates(token0,token1,chainId,from,to){
    const entities = "newSwaps"
    const fragment = (skip) => {
      return `${entities}(
        first: 1000
        skip: ${skip}
        orderBy: timestamp
        orderDirection: desc
        where: {
          token0_: {id:"${token0}"},
          token1_: {id:"${token1}"},
          timestamp_gte: ${from},
          timestamp_lte: ${to}
        }
      ) { timestamp,transaction{id},exchangeRate,token0Price,token1Price,amount0,amount1 }\n`
    }
    const token = (token) => {
      return `newToken(
        id: "${token}"
      ) { name,symbol }\n`
    }

    const queryString = `{
        p0: ${fragment(0)}
        token0: ${token(token0)}
        token1: ${token(token1)}
        ethPrices: bundle(id:1){ethPriceUSD}
    }`

    const query = gql(queryString)

    const graphClient = polygonGraphClient
    const { data } = await graphClient.query({query})
    const rates = [
        ...data.p0,
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

  // if (rates.length < 2) {
  //   return []
  // }

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
    // console.log(`final push1, prevTsGroup:${prevTsGroup} h:${h}, l:${l}, o:${o}, c:${c}`);
    candles.push({ timestamp: prevTsGroup, o, h: h * 1.0003, l: l * 0.9996, c, token0, token1, chainId, dex });
  } else {
    //console.log(`final push1, prevTsGroup:${prevTsGroup} h:${h}, l:${l}, o:${o}, c:${c}`);
    candles.push({ timestamp: prevTsGroup, o, h, l, c, token0, token1, chainId, dex });
  }
  return candles
}

export async function getRatesByTime(from,to,chainId=56){
  const entities = "newSwaps"
    const fragment = () => {
      return `${entities}(
        orderBy: timestamp
        orderDirection: desc
        where: {
          timestamp_lt: ${to},
          timestamp_gte: ${from}
        }
      ) { timestamp,token0{id},token1{id},exchangeRate,token0Price,token1Price }\n`
    }

    const queryString = `{
        p0: ${fragment()}
    }`

    const query = gql(queryString)

    const graphClient = polygonGraphClient
    const { data } = await graphClient.query({query})
    const rates = [
        ...data.p0,
    ]
    logger.debug("Read %s swap records from subgraph.",rates.length)
    return rates
}

export function classifyRawData(rates){
  let result = {}
  let count = 0
  for (let i=0; i<rates.length; i++){
    const key = `${rates[i].token0.id}:${rates[i].token1.id}`
    if (!result[key]){
      result[key] = {}
      result[key]["token0"] = rates[i].token0.id
      result[key]["token1"] = rates[i].token1.id
      result[key]["data"] = [rates[i]]
      count += 1
    }else{
      result[key]["data"].push(rates[i])
    }
  }
  logger.debug("Classified %s records to %s groups.",
                rates.length,
                count)
  return result
}

export function candle2candle(candle,period='1m'){
  const periodTime = periodsMap[period]
  if (periodTime=='1m'){
    return candle
  }

  const candlesResult = []
  const first = candle[0]
  let prevTs = first.timestamp
  let o = first.o
  let h = first.h
  let l = first.l
  let c = first.c

  for (let i=1; i<candle.length; i++){
    const ts = candle[i].timestamp
    const nextTs = prevTs + periodTime
    
    if (ts < nextTs){
      h = candle[i].h > h ? candle[i].h : h
      l = candle[i].l < l ? candle[i].l : l
      c = candle[i].c
    } else {
      candlesResult.push({timestamp:prevTs,o,h,l,c})
      o = candle[i].o
      h = candle[i].h
      l = candle[i].l
      c = candle[i].c
      prevTs = nextTs
    }
  }

  candlesResult.push({timestamp:prevTs,o,h,l,c})

  return candlesResult
}

export async function fetchRates(from,chainId=56){
  const to = from + 60

  // get raw swap data for one minute from subgraph
  const rawData = await getRatesByTime(from,to,chainId)

  // classify raw data by token pair
  const classifiedData = classifyRawData(rawData)

  // get candle data from classified data
  let candleData = []
  for(let key in classifiedData){
    let candles = ratesToCandles(
      classifiedData[key]["data"],'1m',
      classifiedData[key]["token0"],
      classifiedData[key]["token1"],56)
    if (candles.length>1){
      logger.error("wrong")
      console.log("classified",classifiedData[key])
      console.log("candle",candles)
    }
    candleData = candleData.concat(candles)
  }

  // save candle data into database
  await CandleModel.bulkCreate(candleData, { ignoreDuplicates: true })
  logger.info("Save %s candle records(old) to database, from %s to %s",candleData.length,from,to)
  // setTimeout(fetchRates,1000*60*1)
}

export async function getTokens(chainId,start=0){
  const entities = "newTokens"
  const fragment = () => {
    return `${entities}(
      first: 1000
      skip: ${start}
    ) { id,symbol,name,decimals }\n`
  }

  const queryString = `{
      p0: ${fragment()}
  }`

  const query = gql(queryString)

  const graphClient = polygonGraphClient
  const { data } = await graphClient.query({query})
  const tokens = [
      ...data.p0,
  ]
  for(let i=0;i<tokens.length;i++){
    tokens[i]["chainId"] = chainId
    tokens[i]["address"] = tokens[i].id
    tokens[i]["name"] = tokens[i]["name"]?tokens[i]["name"]:"NULL"
    tokens[i]["symbol"] = tokens[i]["symbol"]?tokens[i]["symbol"]:"NULL"
  }
  return tokens
}

export async function getTokenOverview(chainId,time,orderBy,orderDirection){
  const entities = "poolDayDatas"
  const fragment = () => {
    return `${entities}(
      where: {
        date: ${time}
      }
      orderBy: ${orderBy},
      orderDirection: ${orderDirection}
      first: 15
    ) {
      pool{
        token0{name}
        token1{name}
      }
      volumeUSD
      priceVariation
      txCount
      liquidity
    }\n`
  }

  const queryString = `{
      p0: ${fragment()}
  }`

  const query = gql(queryString)

  const graphClient = polygonGraphClientTest
  const { data } = await graphClient.query({query})
  const tokens = [
      ...data.p0,
  ]
  for (let i=0;i<tokens.length;i++){
    tokens[i]["token0"] = tokens[i]["pool"]["token0"]["name"]
    tokens[i]["token1"] = tokens[i]["pool"]["token1"]["name"]
    delete tokens[i]["pool"]
  }
  return tokens
}