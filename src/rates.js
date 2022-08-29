import { ApolloClient, InMemoryCache, gql, HttpLink } from '@apollo/client'
import fetch from 'cross-fetch';

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
    //    p1: ${fragment(1000)}
    //    p2: ${fragment(2000)}
    //    p3: ${fragment(3000)}
    //    p4: ${fragment(4000)}
    //    p5: ${fragment(5000)}
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

export async function ratesToCandles(rates){
  return rates
}