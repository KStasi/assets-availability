import { useState, useEffect } from "react";
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
  slippageData?: SlippageData[];
  slippageLastUpdated?: string;
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
          slippageData: slippageData.slippageData,
          slippageLastUpdated: slippageData.lastUpdated,
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
          padding: "10px",
          backgroundColor: "#f8f9fa",
          borderRadius: "4px",
        }}
      >
        <strong>Debug Info:</strong> Tokens: {data.tokens.join(", ")} | Matrix
        entries: {Object.keys(data.matrix).length} | Routes entries:{" "}
        {Object.keys(data.routes).length} | Route count: {data.routeCount || 0}
        {data.lastUpdated && (
          <span>
            {" "}
            | Last updated: {new Date(data.lastUpdated).toLocaleString()}
          </span>
        )}
        {data.slippageLastUpdated && (
          <span>
            {" "}
            | Slippage updated:{" "}
            {new Date(data.slippageLastUpdated).toLocaleString()}
          </span>
        )}
      </div>
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
                    <>
                      {data.matrix[fromToken][toToken].map((aggregator) => (
                        <div key={aggregator} className="tooltip">
                          <div
                            className={`aggregator-badge ${aggregator.toLowerCase()}`}
                          >
                            {aggregator}
                          </div>
                          <div className="tooltip-content">
                            <div className="dex-list">
                              DEXes:{" "}
                              {data.routes[fromToken][toToken][
                                aggregator
                              ]?.join(", ") || "N/A"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <span style={{ color: "#ccc" }}>-</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Slippage Table */}
      {data.slippageData && data.slippageData.length > 0 && (
        <div style={{ marginTop: "40px" }}>
          <h2>Slippage</h2>
          <table className="matrix-table">
            <thead>
              <tr>
                <th>Pool</th>
                <th>$1,000</th>
                <th>$10,000</th>
                <th>$50,000</th>
                <th>$100,000</th>
              </tr>
            </thead>
            <tbody>
              {data.slippageData.map((slippage) => (
                <tr key={`${slippage.pair.from}-${slippage.pair.to}`}>
                  <td>
                    {slippage.pair.from}→{slippage.pair.to}
                  </td>
                  <td>
                    {slippage.amounts["1000"] !== null
                      ? `${slippage.amounts["1000"]}%`
                      : "-"}
                  </td>
                  <td>
                    {slippage.amounts["10000"] !== null
                      ? `${slippage.amounts["10000"]}%`
                      : "-"}
                  </td>
                  <td>
                    {slippage.amounts["50000"] !== null
                      ? `${slippage.amounts["50000"]}%`
                      : "-"}
                  </td>
                  <td>
                    {slippage.amounts["100000"] !== null
                      ? `${slippage.amounts["100000"]}%`
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;
