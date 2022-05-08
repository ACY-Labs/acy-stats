import { getAbi, getTokenAddr, getChainlinkAddr } from "./chainlinkAddr";
import Web3 from "web3";

const ENABLE_MAINNET = process.env.ENABLE_MAINNET === 'true'; 

const my_web3 = ENABLE_MAINNET ? 
  new Web3("https://bsc-dataseed.binance.org/") :
  new Web3("https://data-seed-prebsc-1-s1.binance.org:8545/");
// prices count is much higher in mainnet than in testnet, hence require fetching more prices in a row
const batch_size = ENABLE_MAINNET ? 50 : 10;
const step       = ENABLE_MAINNET ? BigInt(50) : BigInt(10);

// 估算 before_timestamp 大概的 round_id，避免每次从 latest_round_id 开始搜索
async function estimateStartRoundId(priceFeed, before_timestamp, lastest_round_id) {
  let curr_round_id = lastest_round_id;
  let estimate_start_round_id = lastest_round_id;

  let found = false;
  let rejected_count = 0;
  let is_rejected = false;
  while (!found && rejected_count < 5) {
    is_rejected = true;
    await priceFeed.methods.getTimestamp(curr_round_id).call()
      .then((result) => {
        is_rejected = false;
        let timestamp = parseInt(result);
        if (timestamp <= before_timestamp) {
          found = true;
          estimate_start_round_id = curr_round_id + step;
        }
      })

      curr_round_id -= step;
      if (is_rejected) rejected_count += 1;
  }

  if (estimate_start_round_id > lastest_round_id) {
    return lastest_round_id;
  }
  return estimate_start_round_id;
}


async function findRoundIdRange(priceFeed, after_timestamp, before_timestamp, start_round_id) {
    let curr_round_id = start_round_id;
    // [after, before]
    let after_round_id = BigInt(-1);
    let before_round_id = BigInt(-1);

    let foundAfter = false;
    let foundBefore = false;
    let rejected_count = 0;
    while (start_round_id - curr_round_id < 5000 && rejected_count < 5 && !(foundAfter && foundBefore)) {
      const price_promises = [];
      let itr_round_id = curr_round_id;
      for (let i = 0; i < batch_size; i++) {
        price_promises.push( priceFeed.methods.getTimestamp(curr_round_id).call());
        curr_round_id -= 1n;
      }

      //console.log("Waiting promises...");
      await Promise.all(price_promises).then((results) => {
        let range = curr_round_id.toString() + ' ~ ' + itr_round_id.toString();
        //console.log(`Done ${batch_size}: ${range}`);
        results.forEach((x) => {
          let timestamp = parseInt(x);
          if (timestamp === 0) return;  // 不合法的 timestamp
        
          if (!foundBefore && timestamp <= before_timestamp) {
            //console.log("Found before, roundId = ", itr_round_id.toString());
            foundBefore = true;
            before_round_id = itr_round_id;
          }
          if (!foundAfter && timestamp <= after_timestamp) {
            //console.log("Found after, roundId = ", itr_round_id.toString());
            foundAfter = true;
            after_round_id = itr_round_id;
          }
          itr_round_id -= 1n;
        })
      }).catch( (err) => {
        console.log("Fetch roundId timestamp rejected:", err);
        curr_round_id += BigInt(batch_size);
        rejected_count += 1;
      })
    }

    // 可能包含 -1，需要检查
    return [after_round_id, before_round_id];
}

async function fetchRoundDataRange(priceFeed, after_round_id, before_round_id, token_addr) {
    let chainlink_prices = [];
    if (after_round_id === BigInt(-1) || before_round_id === BigInt(-1) || after_round_id > before_round_id) {
        return [];
    }

    let rejected_count = 0;
    const price_promises = [];
    let itr_round_id = before_round_id;
    while (itr_round_id >= after_round_id && rejected_count < 5) {
        for (let i = 0; i < batch_size && itr_round_id >= after_round_id; i++) {
          price_promises.push(priceFeed.methods.getRoundData(itr_round_id).call());
          itr_round_id -= 1n;
        }

        await Promise.all(price_promises).then((results) => {
          results.forEach((round_data) => {
              chainlink_prices.push({
                  value: round_data.answer,
                  timestamp: round_data.updatedAt,
                  token: token_addr
              })
          })
      }).catch( (err) => {
        console.log("Fetch roundData rejected:", err);
        itr_round_id += BigInt(batch_size);
        rejected_count += 1;
      })
    }

    return chainlink_prices;
}


export async function getPriceFromChainlink(before_timestamp, after_timestamp, token_name) {
  console.log(`Fetching for ${token_name}`);
  const abi = getAbi(token_name);
  const chainlink_addr = getChainlinkAddr(token_name);
  const token_addr = getTokenAddr(token_name);
  const priceFeed = new my_web3.eth.Contract(abi, chainlink_addr);

  let lastest_round_id = BigInt(-1);
  // [after, before]
  let after_round_id = BigInt(-1);
  let before_round_id = BigInt(-1);
//   let after_timestamp = 1650219410;
//   let before_timestamp = 1650239410;
  await priceFeed.methods.latestRoundData().call()
    .then((result) => {
      //console.log(result);
      lastest_round_id = BigInt(result.roundId);
      let latest_timestamp = parseInt(result.updatedAt);
      if (latest_timestamp < before_timestamp) {
          before_timestamp = latest_timestamp; 
      }
      //console.log(lastest_round_id.toString());
    });

  let est_start_round_id = await estimateStartRoundId(priceFeed, before_timestamp, lastest_round_id);
  //console.log("Est start_round_id = ", est_start_round_id);

  [after_round_id, before_round_id] = await findRoundIdRange(
    priceFeed,
    after_timestamp,
    before_timestamp,
    est_start_round_id
  );
  console.log(
    "Found [after_round_id, before_round_id]: ",
    after_round_id.toString(),
    ", ",
    before_round_id.toString()
  );
  let chainlink_prices = await fetchRoundDataRange(
    priceFeed,
    after_round_id,
    before_round_id,
    token_addr
  );
  return chainlink_prices;
  //console.log(chainlink_prices);
}