//import { ethers } from 'ethers'
import React from 'react';
import { StaticRouter } from 'react-router-dom';
import { renderToString } from 'react-dom/server';
import fetch from 'cross-fetch';
import sizeof from 'object-sizeof'

import App from './App';
import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client'
import { getLogger } from './helpers'

import { chainlink_tokens_name, chainId2Name, BSC, getTokenAddr, getAbi, getChainlinkAddr, getRpcUrl } from './chainlinkAddr';
import { Op } from 'sequelize';
import { sequelize } from './database.js';
import { ChainlinkPriceModel } from './PricesModel';
import { CandleModel } from './CandleModel';
import { PoolModel } from './PoolModel';
import Web3 from "web3";
import { 
  getPrice,
  getRates, 
  ratesToCandles, 
  getTokenInfo, 
  getRatesEveryMin, 
  classifyRawData, 
  getRatesByTime, 
  candle2candle, 
  fetchRates, 
  getTokens, 
  getTokenOverview,
  calculateCandles,
  getNewPairList,
  getAllPairs
} from './rates';
import { TokenModel } from './TokenModel';

const BSC_RPC_WEB3 = new Web3(getRpcUrl("BSC"));
const BSC_CHAINLINK_ABI = getAbi("BSC", "BNB");  // abis are same for all tokens

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

const assets = require(process.env.RAZZLE_ASSETS_MANIFEST);

sequelize.sync().then(() => {
  console.log("[INFO] Database is ready")
  // TokenModel.create({chainId:56,name:"aaa",address:"0x00",symbol:"A",decimals:18})
});
// sequelizeCandle.sync().then(() => console.log("[INFO] Candle Database is ready"));


const cssLinksFromAssets = (assets, entrypoint) => {
  return assets[entrypoint] ? assets[entrypoint].css ?
  assets[entrypoint].css.map(asset=>
    `<link rel="stylesheet" href="${asset}">`
  ).join('') : '' : '';
};

const jsScriptTagsFromAssets = (assets, entrypoint, extra = '') => {
  return assets[entrypoint] ? assets[entrypoint].js ?
  assets[entrypoint].js.map(asset=>
    `<script src="${asset}"${extra}></script>`
  ).join('') : '' : '';
};

// const { formatUnits} = ethers.utils

const logger = getLogger('routes')

const apolloOptions = {
  query: {
    fetchPolicy: 'no-cache'
  },
  watchQuery: {
    fetchPolicy: 'no-cache'
  }
}
// polygon testnet (matic)
const polygonGraphClient = new ApolloClient({
  //link: new HttpLink({ uri: 'https://api.thegraph.com/subgraphs/name/lay90/acy-stats', fetch }),
  //link: new HttpLink({ uri: 'https://api.thegraph.com/subgraphs/name/lay90/acy-stats-bsc', fetch }),
  link: new HttpLink({ uri: 'https://api.thegraph.com/subgraphs/name/nearrainbow/acysubgraph', fetch }),
  cache: new InMemoryCache(),
  defaultOptions: apolloOptions
})

// const avalancheGraphClient = new ApolloClient({
//   link: new HttpLink({ uri: 'https://api.thegraph.com/subgraphs/name/gdev8317/gmx-avalanche-staging', fetch }),
//   cache: new InMemoryCache(),
//   defaultOptions: apolloOptions
// })

async function putPricesIntoCache(raw_prices, chainId, entitiesKey) {
  if (!raw_prices || !chainId || !entitiesKey) {
    throw new Error('Invalid arguments');
  }

  let ret = true;
  const precision = 1e8;
  let prices = raw_prices.map(price => ({
    "chainId": chainId,
    "token": price.token.toLowerCase(),
    "timestamp": price.timestamp,
    "value": Number(price.value) / precision
  }));
  await ChainlinkPriceModel.bulkCreate(prices, { ignoreDuplicates: true });

  if (!IS_PRODUCTION) {
    const size = sizeof(prices) / 1024 / 1024;
    logger.debug('Estimated price cache size: %s MB, prices count: %s', size, prices.length);
  }

  return ret
}

class TtlCache {
  constructor(ttl = 60, maxKeys) {
    this._cache = {}
    this._ttl = ttl
    this._maxKeys = maxKeys
    this._logger = getLogger('routes.TtlCache')
  }

  get(key) {
    this._logger.debug('get key %s', key)
    return this._cache[key]
  }

  set(key, value) {
    this._cache[key] = value

    const keys = Object.keys(this._cache)
    if (this._maxKeys && keys.length >= this._maxKeys) {
      for (let i = 0; i <= keys.length - this._maxKeys; i++) {
        this._logger.debug('delete key %s (max keys)', key)
        delete this._cache[keys[i]]
      }
    }

    setTimeout(() => {
      this._logger.debug('delete key %s (ttl)', key)
      delete this._cache[key]
    }, this._ttl * 1000)

    if (!IS_PRODUCTION) {
      console.time('sizeof call')
      const size = sizeof(this._cache) / 1024 / 1024
      console.timeEnd('sizeof call')
      this._logger.debug('TtlCache cache size %s MB', size)
    }
  }

  setAll(obj) {
    this._cache = obj
    
    setTimeout(() => {
      this._logger.debug('delete key (ttl)')
      delete this._cache
    }, this._ttl * 1000)

    if (!IS_PRODUCTION) {
      console.time('sizeof call')
      const size = sizeof(this._cache) / 1024 / 1024
      console.timeEnd('sizeof call')
      this._logger.debug('TtlCache cache size %s MB', size)
    }
  }
}
const ttlCache = new TtlCache(60, 100)

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

// async function fetchLatestPrice(chainId) {
//   const network_name = chainId2Name(chainId);
//   const my_web3 = network_name === "BSC" ? BSC_RPC_WEB3 : BSC_RPC_WEB3;
//   const abi = network_name === "BSC" ? BSC_CHAINLINK_ABI : BSC_CHAINLINK_ABI;

//   let prices = [];
//   for (const token_name of chainlink_tokens_name[network_name]) {
//     const chainlink_addr = getChainlinkAddr(network_name, token_name);
//     const token_addr = getTokenAddr(network_name, token_name);
//     const priceFeed = new my_web3.eth.Contract(abi, chainlink_addr);
//     const roundData = await priceFeed.methods.latestRoundData().call();
//     prices.push({
//       value: roundData.answer,
//       timestamp: roundData.updatedAt,
//       token: token_addr
//     });
//   }
//   //console.log("Latest data: ", ...prices);
//   return prices;
// }

// async function precacheNewPricesFromChainlink(chainId, entitiesKey) {
//   logger.info('[Chainlink] Precache new prices into memory chainId: %s %s...', chainId, entitiesKey)

//   try {
//     const prices = await fetchLatestPrice(chainId);
//     if (prices.length > 0) {
//       logger.info('[Chainlink] Loaded %s prices chainId: %s %s',
//         prices.length,
//         chainId,
//         entitiesKey
//       )
//       const success = await putPricesIntoCache(prices, chainId, entitiesKey);
//       if (!success) {
//         logger.warn('[Chainlink] Prices were not saved')
//       }
//     }
//   } catch (ex) {
//     logger.warn('[Chainlink] New prices load failed chainId: %s %s', chainId, entitiesKey)
//     logger.error(ex)
//   }

//   // every 30sec
//   setTimeout(precacheNewPricesFromChainlink, 1000 * 30 * 1, chainId, entitiesKey)
// }
// if (!process.env.DISABLE_PRICES) {
//   precacheNewPricesFromChainlink(BSC, "chainlinkPrices")
//   //precacheOldPrices(ARBITRUM, "fastPrices")
//   //precacheOldPrices(AVALANCHE, "chainlinkPrices")
//   //precacheOldPrices(AVALANCHE, "fastPrices")
// }

async function precacheOldPrices(chainId, entitiesKey) {
  logger.info('precache old prices into memory for %s...', chainId)

  const baseRetryTimeout = 10000
  let oldestTimestamp = parseInt(Date.now() / 1000)
  let i = 0
  let retryTimeout = baseRetryTimeout
  let failCount = 0
  while (i < 100) {
    try {
      const prices = await loadPrices({ before: oldestTimestamp, chainId, entitiesKey })
      if (prices.length === 0) {
        logger.info('All old prices loaded for chain: %s %s', chainId, entitiesKey)
        break
      }
      const success = await putPricesIntoCache(prices, chainId, entitiesKey);
      if (!success) {
        logger.info('putPricesIntoCache returned false for chain: %s %s. stop', chainId, entitiesKey)
        break
      }
      oldestTimestamp = prices[prices.length - 1].timestamp - 1
      failCount = 0
      retryTimeout = baseRetryTimeout
    } catch (ex) {
      failCount++
      logger.warn('Old prices load failed')
      logger.error(ex)
      if (failCount > 10) {
        logger.warn('too many load failures for chainId: %s %s. retry in %s seconds',
          chainId, entitiesKey, retryTimeout / 1000)
        await sleep(retryTimeout)
        retryTimeout *= 2
      }
      await sleep(500)
    }
    i++
  }
  logger.info("Precache old prices done!");
}
if (!process.env.DISABLE_PRICES) {
  precacheOldPrices(BSC, "chainlinkPrices")
  //precacheOldPrices(ARBITRUM, "fastPrices")
  //precacheOldPrices(AVALANCHE, "chainlinkPrices")
  //precacheOldPrices(AVALANCHE, "fastPrices")
}

 // on Arbitrum new block may have with timestamps from past...
let newestPriceTimestamp = parseInt(Date.now() / 1000) - 60 * 5
async function precacheNewPrices(chainId, entitiesKey) {
  logger.info('Precache new prices into memory chainId: %s %s...', chainId, entitiesKey)

  try {
    const after = newestPriceTimestamp - 60 * 15 // 15 minutes before last update.
    const prices = await loadPrices({ after, chainId, entitiesKey })
    if (prices.length > 0) {
      logger.info('Loaded %s prices since %s chainId: %s %s',
        prices.length,
        toReadable(after),
        chainId,
        entitiesKey
      )
      const success = await putPricesIntoCache(prices, chainId, entitiesKey);
      if (success) {
        newestPriceTimestamp = prices[0].timestamp
      } else {
        logger.warn('Prices were not saved')
      }
    }
  } catch (ex) {
    logger.warn('New prices load failed chainId: %s %s', chainId, entitiesKey)
    logger.error(ex)
  }

  setTimeout(precacheNewPrices, 1000 * 60 * 1, chainId, entitiesKey)
}
if (!process.env.DISABLE_PRICES) {
  precacheNewPrices(BSC, "chainlinkPrices")
  //precacheNewPrices(ARBITRUM, "fastPrices")
  //precacheNewPrices(AVALANCHE, "chainlinkPrices")
  //precacheNewPrices(AVALANCHE, "fastPrices")
}

async function loadPrices({ before, after, chainId, entitiesKey } = {}) {
  if (!chainId) {
    throw new Error('loadPrices requires chainId')
  }
  if (!entitiesKey) {
    throw new Error('loadPrices requires entitiesKey')
  }
  if (!before) {
    before = parseInt(Date.now() / 1000) + 86400 * 365
    //before = parseInt(Date.now() / 1000)
  }
  if (!after) {
    //after = 0
    after = before - 86400;  // a day before
  }
  logger.info('loadPrices %s chainId: %s before: %s, after: %s',
    entitiesKey,
    chainId,
    toReadable(before),
    after && toReadable(after)
  )

  const ALP_addr = String(getTokenAddr(chainId2Name(chainId), "ALP"));
  const fragment = (skip) => {
     return `${entitiesKey}(
      first: 1000
      skip: ${skip}
      orderBy: timestamp
      orderDirection: desc
      where: {
        timestamp_lte: ${before}
        timestamp_gte: ${after}
        period: any
        token: "${ALP_addr}"
      }
    ) { value, timestamp, token }\n`
  }
  const queryString = `{
    p0: ${fragment(0)}
    p1: ${fragment(1000)}
    p2: ${fragment(2000)}
    p3: ${fragment(3000)}
    p4: ${fragment(4000)}
    p5: ${fragment(5000)}
  }`
  const query = gql(queryString)

  // TODO: change to correct chainId
  const graphClient = chainId === BSC ? polygonGraphClient : polygonGraphClient;
  const { data } = await graphClient.query({query})
  const prices = [
    ...data.p0,
    ...data.p1,
    ...data.p2,
    ...data.p3,
    ...data.p4,
    ...data.p5
  ]

  if (prices.length) {
    logger.debug('Loaded %s prices (%s – %s) for chain %s %s',
      prices.length,
      toReadable(prices[prices.length - 1].timestamp),
      toReadable(prices[0].timestamp),
      chainId,
      entitiesKey,
    )
  }

  return prices
}

function toReadable(ts) {
  // in UTC+0
  return (new Date(ts * 1000).toISOString()).replace('T', ' ').replace('.000Z', '')
}

async function getPrices(from, to, preferableChainId = BSC, preferableSource = "chainlink", symbol) {
  const start = Date.now()

  if (preferableSource !== "chainlink") {
    throw createHttpError(400, `Invalid preferableSource ${preferableSource}. Valid options are: chainlink`)
  }

  //const validSymbols = new Set(['BTC', 'ETH', 'BNB', 'UNI', 'LINK', 'AVAX'])
  preferableChainId = Number(preferableChainId)
  const validSymbols = new Set(chainlink_tokens_name[chainId2Name(preferableChainId)])
  if (!validSymbols.has(symbol)) {
    throw createHttpError(400, `Invalid symbol ${symbol}`)
  }
  //const validSources = new Set([ARBITRUM, AVALANCHE])
  const validSources = new Set([BSC])
  if (!validSources.has(preferableChainId)) {
    throw createHttpError(400, `Invalid preferableChainId ${preferableChainId}. Valid options are ${BSC}`)
  }

  //const tokenAddress = addresses[preferableChainId][symbol]?.toLowerCase()
  const tokenAddress = getTokenAddr(chainId2Name(preferableChainId), symbol).toLowerCase();
  let validTokenAddress = await ChainlinkPriceModel.findOne({
    attributes: ["token"], 
    where: { token: tokenAddress }
  });
  if (validTokenAddress == null) {
    console.log(`Invalid tokenAddress ${tokenAddress} in getPrices()`);
    return []
  }

  const cacheKey = `${from}:${to}:${preferableChainId}:${preferableSource}:${symbol}`
  const fromCache = ttlCache.get(cacheKey)
  if (fromCache) {
    logger.debug('from cache')
    return fromCache
  }

  const prices = await ChainlinkPriceModel.findAll({ 
    attributes: ["timestamp", "value"],
    where: {
        chainId: preferableChainId,
        token: tokenAddress,
        timestamp: { [Op.between] : [from, to] }
    },
    order: [
      ['timestamp', 'ASC']
    ]
  });

  ttlCache.set(cacheKey, prices)

  logger.debug('getPrices took %sms cacheKey %s', Date.now() - start, cacheKey)

  return prices
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

function getCandles(prices, period) {
  const periodTime = periodsMap[period]

  if (prices.length < 2) {
    return []
  }

  const candles = []
  const first = prices[0]
  let prevTsGroup = Math.floor(first.timestamp / periodTime) * periodTime
  let prevPrice = Number(first.value)
  let prevTs = first.timestamp
  let o = prevPrice
  let h = prevPrice
  let l = prevPrice
  let c = prevPrice
  let countPerInterval = 1;  // number of prices in current interval
  for (let i = 1; i < prices.length; i++) {
    const ts = prices[i].timestamp;
    const price = Number(prices[i].value);
    //const [ts, price] = prices[i]
    const tsGroup = ts - (ts % periodTime)

    if (prevTs > ts) {
      logger.warn(`Invalid order prevTs: ${prevTs} (${toReadable(prevTs)}) ts: ${ts} (${toReadable(ts)})`)
      continue
    }

    if (prevTsGroup !== tsGroup) {
      if (countPerInterval == 1) {
        candles.push({ t: prevTsGroup, o, h: h * 1.0003, l: l * 0.9996, c });
      } else {
        candles.push({ t: prevTsGroup, o, h, l, c });
      }
      countPerInterval = 0;
      o = c
      h = o > c ? o : c
      l = o < c ? o : c
    }
    c = price
    h = h > price ? h : price
    l = l < price ? l : price
    prevTsGroup = tsGroup
    prevTs = ts
    countPerInterval += 1;
  }
  // last interval might not be a completed interval, so need to handle separately
  if (countPerInterval == 1) {
    //console.log(`final push1, prevTsGroup:${prevTsGroup} h:${h}, l:${l}, o:${o}, c:${c}`);
    candles.push({ t: prevTsGroup, o, h: h * 1.0003, l: l * 0.9996, c });
  } else {
    //console.log(`final push1, prevTsGroup:${prevTsGroup} h:${h}, l:${l}, o:${o}, c:${c}`);
    candles.push({ t: prevTsGroup, o, h, l, c });
  }

  return candles
}

function getFromAndTo(req) {
  const granularity = 60 // seconds
  let from = Number(req.query.from) || Math.round(Date.now() / 1000) - 86400 * 90
  from = Math.floor(from / granularity) * granularity
  let to = Number(req.query.to) || Math.round(Date.now() / 1000)
  to = Math.ceil(to / granularity) * granularity

  return [from, to]
}

function createHttpError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

// subgraph hasn't synced to latest data, so need to use past time
function getTimeNow(){
  const now = Math.floor(Math.floor(Date.now()/1000)/60)*60
  // logger.info(now)
  return now
}

async function fetchNewRates(){
  const from = getTimeNow()-60
  const to = getTimeNow()
  const chainId = 56

  // get raw swap data for one minute from subgraph
  try {
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
    logger.info("Save %s candle records to database",candleData.length)

  }catch(ex){
    logger.error(ex)
  }

  setTimeout(fetchNewRates,1000*60*1)
}

if (!process.env.DISABLE_PRICES) {
  // getTimestamp(0)
  let timeNow = getTimeNow()
  // fetchOldRates(56,timeNow)
  // checkOldRates(56,timeNow)
  fetchNewRates()
}
async function fetchOldRates(chainId=56,to){
  // get time now
  // const to = getTimeNow()
  let latestCandle = await CandleModel.findOne({
    where: { 
      chainId:chainId,
      dex: "Uniswap V3" 
    },
    order: [ ['timestamp', 'DESC']],
  })

  // get latest time in database record
  let latestTs
  if (latestCandle === null){
    latestTs = 1640452440
    while (latestTs < to-60){
      try{
        fetchRates(latestTs)
        latestTs += 60
      }catch(ex){
        logger.error(ex)
      }
      await sleep(100)
    }
    return
  } else{
    latestTs = latestCandle.timestamp + 60
  }

  // get old rates from database latest time to time now
  logger.info("Start fetching old rates...")
  while (latestTs < to-60){
    logger.warn("latest",latestTs)
    try{
      fetchRates(latestTs)
      latestTs += 60
    }catch(ex){
      logger.error(ex)
    }
    await sleep(100)
  }
}

async function checkOldRates(chainId=56,to){
  // get time now
  // const to = getTimeNow()
  logger.info("Start checking old rates...")
  try{
    let oldestTs = 1630000000
    let oldestCandle = await CandleModel.findOne({
      where: { 
        chainId:chainId,
        dex: "Uniswap V3" 
      },
      order: [ ['timestamp', 'ASC']],
    })
  
    // get oldest time in database record
    if (oldestCandle){
      oldestTs = oldestCandle.timestamp
    }
    // oldestTs = 1644124020   // for development
    let count = 0
    while (oldestTs<to){
      let oldCandle = await CandleModel.findOne({
        where: {
          chainId:chainId,
          dex: "Uniswap V3",
          timestamp:oldestTs
        }})
      if (oldCandle === null){
        await fetchRates(oldestTs)
      } 
      count+=1
      if(count==60){
        logger.info("Done checking old rates from %s to %s",oldestTs-600,oldestTs)
        count=0
      }
      oldestTs += 60
      to = getTimeNow()
    }
    logger.info("Finish checking old rates...")
  }catch(ex){
    logger.error(ex)
    await sequelize.sync()
    checkOldRates(chainId,to)
  }
}

async function fetchToken(chainId=56){
  let tokenList
  try{
    tokenList = await TokenModel.findAll({  // get database token list
      attributes: ["chainId", "name", "address", "symbol", "logoURI", "volume"],
      where:{
        chainId: chainId
      }
    })
  
    logger.info("Database token amount: ",tokenList.length)
  }catch(ex){
    logger.error(ex)
    await TokenModel.drop()
    await sequelize.sync()
    setTimeout(fetchToken,1000*60,56)
  }

  try{
    let newTokenList = await getTokens(chainId)   // get the first 1000 token

    let n = 1000
    let _newTokenList
    do{                                     // get the remaining token
      _newTokenList = await getTokens(chainId,n)
      newTokenList = newTokenList.concat(_newTokenList)
      n += 1000
    }while(_newTokenList.length!=0)
    logger.info("Subgraph token amount: ",newTokenList.length)

    if (tokenList.length!=newTokenList.length){
      await TokenModel.bulkCreate(newTokenList,{ignoreDuplicates:true})   // save to database
      logger.info("Save %s tokens to database",newTokenList.length)
    }
    setTimeout(fetchToken,1000*60*60,56)
  }catch(ex){
    logger.error(ex)
    setTimeout(fetchToken,1000*60,56)
  }
}

async function fetchPairs(chainId=56){
  let pairList = await getAllPairs(chainId)
  await PoolModel.drop()
  await sequelize.sync()
  await PoolModel.bulkCreate(pairList, { ignoreDuplicates: true });
  setTimeout(fetchPairs,1000*60*5,56)
}

fetchToken(56)
fetchPairs(56)

const orderByMap = {
  'topvolume': ['volumeUSD','desc'],
  'winners': ['priceVariation','desc'],
  'losers': ['priceVariation','asc'],
}

function getTimestamp0000(timestamp){
  let date = new Date(timestamp*1000)
  date.setUTCHours(0,0,0,0)
  return date.getTime()/1000
}

export default function routes(app) {
  // app.get('/api/earn/:account', async (req, res, next) => {
  //   const chainName = req.query.chain || 'arbitrum'
  //   const validChainNames = new Set(['arbitrum', 'avalanche'])
  //   if (!validChainNames.has(chainName)) {
  //     next(createHttpError(400, `Valid chains are: ${Array.from(validChainNames)}`))
  //     return
  //   }
  //   try {
  //     const earnData = await queryEarnData(chainName, req.params.account)
  //     res.send(earnData)
  //   } catch (ex) {
  //     logger.error(ex)
  //     next(createHttpError(500, ex.message))
  //     return
  //   }
  // })

  // app.get('/api/gmx-supply', async (req, res) => {
  //   const apiResponse = await fetch('https://api.gmx.io/gmx_supply')
  //   const data = (await apiResponse.text()).toString()
  //   res.set('Content-Type', 'text/plain')
  //   res.send(formatUnits(data))
  // })

  // app.get('/api/chart/:symbol', async (req, res, next) => {
  //   const [from, to] = getFromAndTo(req)

  //   let prices
  //   try {
  //     prices = getPrices(from, to, req.query.preferableChainId, req.query.preferableSource, req.params.symbol)
  //   } catch (ex) {
  //     next(ex)
  //     return
  //   }

  //   res.set('Cache-Control', 'max-age=60')
  //   res.send(prices)
  // })

  app.get('/api/candles/:symbol', async (req, res, next) => {
    const [from, to] = getFromAndTo(req)
    //var fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    //logger.debug('getCandles url:', fullUrl);
    let prices
    try {
      prices = await getPrices(from, to, req.query.preferableChainId, req.query.preferableSource, req.params.symbol)
    } catch (ex) {
      next(ex)
      return
    }

    const period = req.query.period?.toLowerCase()
    if (!period || !periodsMap[period]) {
      next(createHttpError(400, `Invalid period. Valid periods are ${Object.keys(periodsMap)}`))
      return
    }

    const candles = getCandles(prices, period)
    let updatedAt
    if (prices.length) {
      updatedAt = prices[prices.length - 1].timestamp
    }

    res.set('Cache-Control', 'max-age=60')
    res.send({
      prices: candles,
      period,
      updatedAt
    })
  })

  // get rates from subgraph
  app.get('/api/rates',async(req,res,next)=>{
    let token0 = req.query.token0
    let token1 = req.query.token1
    let chainId = req.query.chainId
    let from = req.query.from
    let to = req.query.to

    // get result from subgraph
    let result
    try{
      result = await getRates(token0,token1,chainId,from,to)

      // extract token info from result
      const tokenInfo = await getTokenInfo(result)

      res.send({
        chainId: chainId,
        tokenInfo: tokenInfo,
        rates: result.rates
      })
    } catch (e){
      next(e)
      return
    }
  })

  app.get('/api/price',async(req,res,next)=>{
    let token = req.query.token
    let chainId = req.query.chainId

    // get result from subgraph
    let result
    try{
      result = await getPrice(token,chainId)
      res.send({price:result})
    } catch (e){
      res.send({price:0})
      next(e)
      return
    }
  })

  // get candles record from database
  app.get('/api/rates/candles',async(req,res,next)=>{
    let token0 = req.query.token0
    let token1 = req.query.token1
    let chainId = req.query.chainId
    let from = req.query.from
    let to = req.query.to?req.query.to:getTimeNow()

    let timestampOP = {}
    if (from&&to){
      timestampOP = { [Op.between] : [from, to] }
    }else if(from){
      timestampOP = { [Op.gte] : [from] }
    }else if(to){
      timestampOP = { [Op.lte] : [to] }
    }else{
      timestampOP = { [Op.gte] : 0 }
    }

    const period = req.query.period?.toLowerCase()
    if (!period || !periodsMap[period]) {
      next(createHttpError(400, `Invalid period. Valid periods are ${Object.keys(periodsMap)}`))
      return
    }

    // search candle data from database
    const rates = await CandleModel.findAll({ 
      attributes: ["timestamp", "o", "h", "l", "c"],
      where: {
          chainId: 56,
          token0: token0,
          token1: token1,
          dex: "Uniswap V3",
          timestamp: timestampOP
      },
      order: [
        ['timestamp', 'ASC']
      ]
    });

    // convert time interval for candle data
    if (rates.length!=0){
      if (from){
        const candle = await CandleModel.findOne({
          attributes: ["timestamp", "o", "h", "l", "c"],
          where: {
            chainId: 56,
            token0: token0,
            token1: token1,
            dex: "Uniswap V3",
            timestamp: { [Op.lte] : [from] },
            c : {[Op.ne] : [0]}
          },
          order: [
            ['timestamp', 'DESC']
          ]
        })
        console.log(candle)
        rates.unshift(candle)
      }
      // const _result = standalizeData(rates)
      const result = candle2candle(rates,period,from,to)
      res.send(result)
      return
    }

    // if result cannot be found in database, then get result from subgraph, all result
    // logger.info("Cannot find candle data in database, get from subgraph")
    res.send([])
    // const result = await calculateCandles(token0,token1,chainId,from,to,period)
    // res.send(result)
    return
  })

  app.get('/api/tokens',async(req,res,next)=>{
    let chainId = req.query.chainId
    let skip = req.query.skip?req.query.skip:0
    let limit = req.query.limit?req.query.limit:null
    const tokenList = await TokenModel.findAll({
      attributes: ["chainId", "name", "address", "symbol", "decimals", "logoURI", "volume"],
      where:{
        chainId: 56
      },
      order: [
        ['volume','DESC'],
      ],
      offset:skip,
      limit:limit
      
    })
    res.send(tokenList)
    return
  })

  app.get('/api/tokens-overview',async(req,res,next)=>{
    let chainId = req.query.chainId
    let orderBy = req.query.orderBy
    let time = getTimestamp0000(getTimeNow())
    // time = 1640217600  // for development
    if (!orderBy || !orderByMap[orderBy]) {
      next(createHttpError(400, `Invalid order. Valid orders are ${Object.keys(orderByMap)}`))
      return
    }
    try{
      const tokenList = await getTokenOverview(chainId,time,orderByMap[orderBy][0],orderByMap[orderBy][1])
      res.send(tokenList)
    return
    }catch(e){
      next(e)
      return
    }
  })

  app.get('/api/new-pairs',async(req,res,next)=>{
    let chainId = req.query.chainId
    let n = req.query.n?req.query.n:15
    try{
      const newPairList = await getNewPairList(chainId,n)
      res.send(newPairList)
    return
    }catch(e){
      next(e)
      return
    }
  })

  app.get('/api/search-pairs',async(req,res,next)=>{
    let chainId = req.query.chainId
    let n = req.query.n?req.query.n:15
    let keyword = req.query.keyword
    try{
      const pairList = await PoolModel.findAll({
        attributes: ["token0Name", "token1Name", "token0Symbol", "token1Symbol", "token0Address", "token1Address","volume","id"],
        where:{
          chainId: chainId,
          [Op.or]: [
            { token0Address: { [Op.like]: `%${keyword}%` } },
            { token1Address: { [Op.like]: `%${keyword}%` } },
            { token1Name: { [Op.like]: `%${keyword}%` } },
            { token0Name: { [Op.like]: `%${keyword}%` } },
            { token0Symbol: { [Op.like]: `%${keyword}%` } },
            { token1Symbol: { [Op.like]: `%${keyword}%` } }
          ]
        },
        order: [
          ['volume','DESC'],
        ]
      })
      res.send(pairList)
      return
    }catch(e){
      next(e)
      return
    }
  })

  const cssAssetsTag = cssLinksFromAssets(assets, 'client')
  const jsAssetsTag = jsScriptTagsFromAssets(assets, 'client', ' defer crossorigin')

  app.get('/*', (req, res, next) => {
    if (res.headersSent) {
      next()
      return
    }

    const context = {};
    const markup = renderToString(
      <StaticRouter context={context} location={req.url}>
        <App />
      </StaticRouter>
    );
    res.set('Content-Type', 'text/html')

    res.status(200).send(
      `<!doctype html>
          <html lang="">
          <head>
              <meta http-equiv="X-UA-Compatible" content="IE=edge" />
              <meta charset="utf-8" />
              <title>GMX analytics</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <link rel="icon" type="image/png" href="/favicon.png" />
              ${cssAssetsTag}
          </head>
          <body>
              <div id="root">${markup}</div>
              ${jsAssetsTag}
          </body>
      </html>`
    );
    next()
  });

  app.use('/api', function (err, req, res, next) {
    res.set('Content-Type', 'text/plain')
    const statusCode = Number(err.code) || 500
    let response = ''
    if (IS_PRODUCTION) {
      if (err.code === 400) {
        response = err.message
      }
    } else {
      response = err.stack
    }
    res.status(statusCode)
    res.send(response)
  })
}