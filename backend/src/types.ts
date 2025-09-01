export type Pair = { from: string; to: string };
export type Route = { aggregator: string; dexes: string[] };
export type PairRoutes = { pair: Pair; routes: Route[] };
