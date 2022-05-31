
export const BSC = 56;

export const chainlink_tokens_name = {
  "BSC": ["BNB", "BTC", "ETH"],
}

const config = {
  "BSC": {
    // the addr are belong to polygon actually
    "token_addresses": {
      //"BNB" : ethers.constants.AddressZero,
      // actually are WBTC, WETH
      "BTC" : "0x05d6f705C80d9F812d9bc1A142A655CDb25e2571",
      "ETH" : "0xeBC8428DC717D440d5deCE1547456B115b868F0e"
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