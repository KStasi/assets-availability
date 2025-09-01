export type Pair = { from: string; to: string };
export type Route = { aggregator: string; dexes: string[] };
export type PairRoutes = { pair: Pair; routes: Route[] };

// LiFi Quote API types
export type Token = {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  name: string;
  coinKey: string;
  priceUSD: string;
  logoURI: string;
};

export type Step = {
  gasCostUSD?: string;
  fromAddress?: string;
  toAddress?: string;
  containsSwitchChain?: boolean;
};

export type QuoteRoute = {
  id: string;
  fromChainId: number;
  fromAmountUSD: string;
  fromAmount: string;
  fromToken: Token;
  toChainId: number;
  toAmountUSD: string;
  toAmount: string;
  toAmountMin: string;
  toToken: Token;
  steps: Step[];
};

export type QuoteResponse = {
  routes: QuoteRoute[];
};

export type SlippageData = {
  pair: Pair;
  amounts: {
    "1000": number | null;
    "10000": number | null;
    "50000": number | null;
    "100000": number | null;
  };
};
