import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client'
import fetch from 'cross-fetch';
import { getLogger } from './helpers'
import { CandleModel } from './CandleModel';
import { Op } from 'sequelize';
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
    let timestampOP = {}
    if (from&&to){
      timestampOP = `timestamp_gte: ${from},timestamp_lte: ${to}`
    }else if(from){
      timestampOP = `timestamp_gte: ${from}`
    }else if(to){
      timestampOP = `timestamp_lte: ${to}`
    }else{
      timestampOP = ``
    }

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
          ${timestampOP}
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

export function candle2candle(candle,period='1m',_from=0){
  const from = _from ? _from : 0
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
    let nextTs = prevTs + periodTime
    
    if (ts < nextTs){
      h = candle[i].h > h ? candle[i].h : h
      l = candle[i].l < l ? candle[i].l : l
      c = candle[i].c
    } else if (ts >= nextTs){
      candlesResult.push({timestamp:prevTs,o,h,l,c})  //0300
      while (ts >= nextTs){  //0960>0900
        prevTs += periodTime  //0900
        nextTs = prevTs + periodTime  //1200
        if (ts>nextTs){
          candlesResult.push({timestamp:prevTs,o:c,h:c,l:c,c:c})
          // candlesResult.push({timestamp:prevTs,o,h,l,c})
        }
        // candlesResult.push({timestamp:prevTs,o,h,l,c})
        // prevTs = nextTs
      }
      o = candle[i].o
      h = candle[i].h
      l = candle[i].l
      c = candle[i].c
      // prevTs = nextTs
    }
    // }else {
    //   candlesResult.push({timestamp:prevTs,o,h,l,c})
    //   o = candle[i].o
    //   h = candle[i].h
    //   l = candle[i].l
    //   c = candle[i].c
    //   prevTs = nextTs
    // }
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
    ) { id,symbol,name,decimals,volumeUSD }\n`
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
    tokens[i]["volume"] = tokens[i]["volumeUSD"]
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
        token0{name,id}
        token1{name,id}
      }
      volumeUSD
      priceVariation
      txCount
      liquidity
      token0Price
      token1Price
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
    tokens[i]["token0Address"] = tokens[i]["pool"]["token0"]["id"]
    tokens[i]["token1Address"] = tokens[i]["pool"]["token1"]["id"]
    tokens[i]["exchange"] = "Uniswap v3"
    delete tokens[i]["pool"]
  }
  return tokens
}

function safeDiv(n1,n2){
  if (n2==0){
    return 0
  }
  return n1/n2
}

export async function calculateCandles(token0,token1,chainId,from,to,period){
  const WMATIC = "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"
  const periodTime = periodsMap[period]
  const candlesToken0 = await CandleModel.findAll({
    where: {
      token0:WMATIC,
      token1:token0,
      chainId:chainId,
      dex:"Uniswap V3",
      timestamp: { [Op.between] : [from, to] }
    },
    order: [
      ['timestamp', 'ASC'],
    ],
  })
  const candlesToken1 = await CandleModel.findAll({
    where: {
      token0:WMATIC,
      token1:token1,
      chainId:chainId,
      dex:"Uniswap V3",
      timestamp: { [Op.between] : [from, to] }
    },
    order: [
      ['timestamp', 'ASC'],
    ],
  })
  const candles = []
  const test = {token1:candlesToken1,token0:candlesToken0}
  for (let i=0;i<candlesToken0.length;i++){
    let candleToken1 = candlesToken1.find(candle=>
      candle.timestamp==candlesToken0[i].timestamp
      )
    if (candleToken1){
      candles.push({
        timestamp:candlesToken0[i].timestamp,
        o:safeDiv(candleToken1.o,candlesToken0[i].o),
        h:safeDiv(candleToken1.h,candlesToken0[i].h),
        l:safeDiv(candleToken1.l,candlesToken0[i].l),
        c:safeDiv(candleToken1.c,candlesToken0[i].c),
      })
    }
  }
  return candles
}

export async function getPrice(token,chainId){
  const entities = "newToken"
  const queryString = `{
    bundles{
      id
      ethPriceUSD
    }
    ${entities}(id: "${token}") {
      derivedETH
    }\n}`
  const query = gql(queryString)
  const graphClient = polygonGraphClientTest
  const { data } = await graphClient.query({query})
  const ethPrice = data.bundles[0].ethPriceUSD
  const tokenPrice = data.newToken.derivedETH
  return ethPrice*tokenPrice
}

export async function getNewPairList(chainId,n=10){
  const entities = "pools"
  const fragment = () => {
    return `${entities}(
      orderBy: createdAtTimestamp,
      orderDirection: desc,
      first: ${n}
    ) {
      token0{name,id}
      token1{name,id}
      createdAtTimestamp
      token0Price
      token1Price
      volumeUSD
      liquidity
      txCount
    }\n`
  }

  const queryString = `{
      p0: ${fragment()}
  }`

  const query = gql(queryString)

  const graphClient = polygonGraphClientTest
  const { data } = await graphClient.query({query})
  const newPairs = [
      ...data.p0,
  ]
  for (let i=0;i<newPairs.length;i++){
    newPairs[i]["token0Address"] = newPairs[i]["token0"]["id"]
    newPairs[i]["token1Address"] = newPairs[i]["token1"]["id"]
    newPairs[i]["token0"] = newPairs[i]["token0"]["name"]
    newPairs[i]["token1"] = newPairs[i]["token1"]["name"]
    newPairs[i]["exchange"] = "Uniswap v3"
  }
  return newPairs
}

export async function getAllPairs(chainId){
  let allPairs = []
  let id = 0
  let temp = []
  do{
    logger.info("Getting 500 pairs from id ",id)
    temp = await get500Pairs(chainId,id)
    allPairs = [...allPairs,...temp]
    if (temp.length!=0){
      id = temp[temp.length-1].id
    }
  }while(temp.length!=0)
  logger.info("Got all pairs ",allPairs.length,"pairs")
  return allPairs
}

export async function get500Pairs(chainId,id){
  const entities = "pools"
  const fragment = () => {
    return `${entities}(
      first: 500,
      where: {id_gt: "${id}"}
    ) {
      id
      token0{name,id,symbol}
      token1{name,id,symbol}
      createdAtTimestamp
      token0Price
      token1Price
      volumeUSD
      liquidity
      txCount
    }\n`
  }

  const queryString = `{
      p0: ${fragment()}
  }`

  const query = gql(queryString)
  const graphClient = polygonGraphClientTest
  let pairs = []
  try{
    const { data } = await graphClient.query({query})
    pairs = [
        ...data.p0,
    ]
    for (let i=0;i<pairs.length;i++){
      pairs[i]["token0Address"] = pairs[i]["token0"]["id"]
      pairs[i]["token0Name"] = pairs[i]["token0"]["name"]
      pairs[i]["token0Symbol"] = pairs[i]["token0"]["symbol"]
      pairs[i]["token1Address"] = pairs[i]["token1"]["id"]
      pairs[i]["token1Name"] = pairs[i]["token1"]["name"]
      pairs[i]["token1Symbol"] = pairs[i]["token1"]["symbol"]
      pairs[i]["volume"] = pairs[i]["volumeUSD"]
      pairs[i]["chainId"] = "137"
    }
    
  }catch(e){
    logger.error(e)
    pairs = get500Pairs(chainId,id)
  }
  return pairs
}