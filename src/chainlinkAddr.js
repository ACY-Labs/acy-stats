
export const BSC = 56;

export const chainlink_tokens_name = {
  "BSC": ["BNB", "BTC", "ETH"],
}

const config = {
  "BSC": {
    // the addr are belong to polygon actually
    "token_addresses": {
      "BNB" : "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "BTC" : "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      "ETH" : "0x2170Ed0880ac9A755fd29B2688956BD959F933F8"
    }
  }
}



export function getTokenAddr(network_name, token_name) {
  if (!(network_name in config)) {
    throw new Error(`Unknown network in getTokenAddr: ${network_name}`);
  }
  if (!(token_name in config[network_name]["token_addresses"])) {
    throw new Error(`Unknown token_name in getTokenAddr: ${token_name}`);
  }
  return config[network_name]["token_addresses"][token_name];
}

export function chainId2Name(chainId) {
  switch(chainId) {
    case BSC: return "BSC";
    default: {
      console.log(`Unsupported chain in chainId2Name: ${chainId}, fallback to BSC`);
      return "BSC";
    }
  }
}