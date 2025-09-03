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
export interface SlippageData {
    pair: Pair;
    provider: string;
    amounts: {
        "1000": number | null;
        "10000": number | null;
        "50000": number | null;
        "100000": number | null;
    };
}
