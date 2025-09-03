import React, { useState, useEffect } from "react";
import { PairRoutes, SlippageData } from "@assets-availability/types";
import "./App.css";

interface Token {
  symbol: string;
  address: string;
  decimals: number;
}

interface MatrixData {
  tokens: string[];
  matrix: { [key: string]: { [key: string]: string[] } };
  routes: {
    [key: string]: { [key: string]: { [aggregator: string]: string[] } };
  };
  lastUpdated?: string;
  routeCount?: number;
  providers?: {
    lifi: { count: number; lastUpdated?: string };
    oku: { count: number; lastUpdated?: string };
  };
  slippageData?: SlippageData[];
  slippageLastUpdated?: string;
  slippageCalculationTimestamp?: string;
}

function App() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        console.log("Fetching tokens and routes from backend");

        // Fetch tokens, routes, and slippage data in parallel
        const [tokensResponse, routesResponse, slippageResponse] =
          await Promise.all([
            fetch("http://localhost:3001/tokens"),
            fetch("http://localhost:3001/routes"),
            fetch("http://localhost:3001/slippage"),
          ]);

        if (!tokensResponse.ok || !routesResponse.ok || !slippageResponse.ok) {
          throw new Error(
            `HTTP error! tokens: ${tokensResponse.status}, routes: ${routesResponse.status}, slippage: ${slippageResponse.status}`
          );
        }

        const tokens: Token[] = await tokensResponse.json();
        const routesData = await routesResponse.json();
        const routes: PairRoutes[] = routesData.routes;
        const slippageData = await slippageResponse.json();

        console.log("Tokens data received:", tokens);
        console.log("Routes data received:", routes);

        // Extract token symbols and sort them
        const tokenSymbols = tokens.map((t) => t.symbol).sort();

        const matrix: { [key: string]: { [key: string]: string[] } } = {};
        const routeData: {
          [key: string]: { [key: string]: { [aggregator: string]: string[] } };
        } = {};

        // Initialize matrix and route data for all token pairs
        tokenSymbols.forEach((from) => {
          matrix[from] = {};
          routeData[from] = {};
          tokenSymbols.forEach((to) => {
            matrix[from][to] = [];
            routeData[from][to] = {};
          });
        });

        // Populate matrix and route data from routes
        routes.forEach((route) => {
          const { from, to } = route.pair;
          if (tokenSymbols.includes(from) && tokenSymbols.includes(to)) {
            route.routes.forEach((r) => {
              if (!matrix[from][to].includes(r.aggregator)) {
                matrix[from][to].push(r.aggregator);
              }
              routeData[from][to][r.aggregator] = r.dexes;
            });
          }
        });

        const finalData = {
          tokens: tokenSymbols,
          matrix,
          routes: routeData,
          lastUpdated: routesData.lastUpdated,
          routeCount: routesData.count,
          providers: routesData.providers,
          slippageData: slippageData.slippageData,
          slippageLastUpdated: slippageData.lastUpdated,
          slippageCalculationTimestamp: slippageData.calculationTimestamp,
        };
        console.log("Final data structure:", finalData);
        setData(finalData);
        setLoading(false);
      } catch (err) {
        setError(
          `Failed to fetch data: ${
            err instanceof Error ? err.message : "Unknown error"
          }`
        );
        setLoading(false);
        console.error("Fetch error:", err);
      }
    };

    fetchData();
  }, []);

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="error">No data available</div>;

  console.log("Rendering with data:", data);

  return (
    <div className="container">
      <h1>Assets Availability Matrix</h1>
      <div
        style={{
          marginBottom: "20px",
          padding: "8px 12px",
          backgroundColor: "#f8f9fa",
          borderRadius: "4px",
          fontSize: "13px",
          lineHeight: "1.4",
        }}
      >
        <strong>Info:</strong> {data.tokens.length} tokens |{" "}
        {data.routeCount || 0} routes
        {data.providers && (
          <span>
            {" "}
            | LiFi: {data.providers.lifi.count} | Oku:{" "}
            {data.providers.oku.count}
          </span>
        )}
        {data.lastUpdated && (
          <span> | Updated: {new Date(data.lastUpdated).toLocaleString()}</span>
        )}
      </div>
      <div className="table-wrapper">
        <table className="matrix-table">
          <thead>
            <tr>
              <th></th>
              {data.tokens.map((token) => (
                <th key={token}>{token}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.tokens.map((fromToken) => (
              <tr key={fromToken}>
                <th>{fromToken}</th>
                {data.tokens.map((toToken) => (
                  <td key={`${fromToken}-${toToken}`}>
                    {data.matrix[fromToken][toToken].length > 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                        }}
                      >
                        {data.matrix[fromToken][toToken].map((aggregator) => {
                          const dexes =
                            data.routes[fromToken][toToken][aggregator] || [];
                          return (
                            <div key={aggregator}>
                              {aggregator === "LiFi" ? (
                                <div
                                  className={`aggregator-badge ${aggregator.toLowerCase()}`}
                                >
                                  LiFi
                                </div>
                              ) : (
                                // For Oku, show each DEX separately
                                dexes.map((dex, index) => {
                                  const isSimulationFailed = dex.endsWith("✗");
                                  let cleanDexName = isSimulationFailed
                                    ? dex.slice(0, -1)
                                    : dex;
                                  // Transform threeroute to 3route for display
                                  if (cleanDexName === "threeroute") {
                                    cleanDexName = "3route";
                                  }
                                  return (
                                    <div
                                      key={`${aggregator}-${index}`}
                                      className={`aggregator-badge ${aggregator.toLowerCase()}${
                                        isSimulationFailed
                                          ? " simulation-failed"
                                          : ""
                                      }`}
                                      style={{
                                        marginBottom:
                                          index < dexes.length - 1
                                            ? "2px"
                                            : "0",
                                      }}
                                    >
                                      {cleanDexName.length > 8
                                        ? `Oku:${cleanDexName.substring(
                                            0,
                                            8
                                          )}...`
                                        : `Oku:${cleanDexName}`}
                                      {isSimulationFailed && (
                                        <span
                                          style={{
                                            marginLeft: "3px",
                                            color: "#fff",
                                            fontSize: "10px",
                                            fontWeight: "bold",
                                          }}
                                        >
                                          ⚠
                                        </span>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ color: "#ccc" }}>-</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Slippage Table */}
      {data.slippageData && data.slippageData.length > 0 && (
        <div style={{ marginTop: "40px" }}>
          <h2>Slippage Comparison</h2>
          {data.slippageCalculationTimestamp && (
            <p
              style={{ fontSize: "14px", color: "#666", marginBottom: "20px" }}
            >
              Last calculated:{" "}
              {new Date(data.slippageCalculationTimestamp).toLocaleString()}
            </p>
          )}
          <div className="table-wrapper">
            <table className="slippage-comparison-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Pool</th>
                  <th colSpan={4} style={{ textAlign: "center" }}>
                    $1,000
                  </th>
                  <th colSpan={4} style={{ textAlign: "center" }}>
                    $10,000
                  </th>
                  <th colSpan={4} style={{ textAlign: "center" }}>
                    $50,000
                  </th>
                  <th colSpan={4} style={{ textAlign: "center" }}>
                    $100,000
                  </th>
                </tr>
                <tr>
                  <th>LiFi</th>
                  <th>OKU</th>
                  <th>Best</th>
                  <th>Diff</th>
                  <th>LiFi</th>
                  <th>OKU</th>
                  <th>Best</th>
                  <th>Diff</th>
                  <th>LiFi</th>
                  <th>OKU</th>
                  <th>Best</th>
                  <th>Diff</th>
                  <th>LiFi</th>
                  <th>OKU</th>
                  <th>Best</th>
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Group slippage data by pair
                  const groupedData: {
                    [key: string]: { LiFi?: SlippageData; OKU?: SlippageData };
                  } = {};

                  data.slippageData.forEach((slippage) => {
                    const pairKey = `${slippage.pair.from}-${slippage.pair.to}`;
                    if (!groupedData[pairKey]) {
                      groupedData[pairKey] = {};
                    }
                    groupedData[pairKey][
                      slippage.provider as keyof (typeof groupedData)[string]
                    ] = slippage;
                  });

                  return Object.entries(groupedData).map(
                    ([pairKey, providers]) => {
                      const lifiData = providers.LiFi;
                      const okuData = providers.OKU;

                      const formatSlippage = (amount: number | null) =>
                        amount !== null ? `${amount.toFixed(4)}%` : "-";

                      const getBestProvider = (
                        lifiAmount: number | null,
                        okuAmount: number | null
                      ) => {
                        if (lifiAmount === null && okuAmount === null)
                          return null;
                        if (lifiAmount === null) return "OKU";
                        if (okuAmount === null) return "LiFi";
                        return lifiAmount < okuAmount ? "LiFi" : "OKU";
                      };

                      const getDifference = (
                        lifiAmount: number | null,
                        okuAmount: number | null
                      ) => {
                        if (lifiAmount === null || okuAmount === null)
                          return null;
                        return Math.abs(lifiAmount - okuAmount);
                      };

                      const volumes = [
                        "1000",
                        "10000",
                        "50000",
                        "100000",
                      ] as const;

                      return (
                        <tr key={pairKey}>
                          <td style={{ fontWeight: "600" }}>
                            {lifiData?.pair.from || okuData?.pair.from}→
                            {lifiData?.pair.to || okuData?.pair.to}
                          </td>
                          {volumes.map((volume) => {
                            const lifiAmount =
                              lifiData?.amounts[volume] || null;
                            const okuAmount = okuData?.amounts[volume] || null;
                            const bestProvider = getBestProvider(
                              lifiAmount,
                              okuAmount
                            );
                            const difference = getDifference(
                              lifiAmount,
                              okuAmount
                            );

                            return (
                              <React.Fragment key={volume}>
                                <td
                                  className={`slippage-cell ${
                                    bestProvider === "LiFi" ? "best" : ""
                                  }`}
                                >
                                  {formatSlippage(lifiAmount)}
                                </td>
                                <td
                                  className={`slippage-cell ${
                                    bestProvider === "OKU" ? "best" : ""
                                  }`}
                                >
                                  {formatSlippage(okuAmount)}
                                </td>
                                <td className="best-provider">
                                  {bestProvider || "-"}
                                </td>
                                <td className="difference">
                                  {difference !== null
                                    ? `${difference.toFixed(4)}%`
                                    : "-"}
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      );
                    }
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
