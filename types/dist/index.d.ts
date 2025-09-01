export interface Pair {
    from: string;
    to: string;
}
export interface Route {
    aggregator: string;
    dexes: string[];
}
export interface PairRoutes {
    pair: Pair;
    routes: Route[];
}
