import { useState, useEffect } from "react";
import { PairRoutes } from "@assets-availability/types";
import "./App.css";

interface MatrixData {
  tokens: string[];
  matrix: { [key: string]: { [key: string]: string[] } };
  routes: {
    [key: string]: { [key: string]: { [aggregator: string]: string[] } };
  };
}

function App() {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("Fetching data from http://localhost:3001/routes");
    fetch("http://localhost:3001/routes")
      .then((response) => {
        console.log("Response received:", response.status, response.ok);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((routes: PairRoutes[]) => {
        console.log("Routes data received:", routes);
        const tokens = Array.from(
          new Set([...routes.flatMap((r) => [r.pair.from, r.pair.to])])
        ).sort();

        const matrix: { [key: string]: { [key: string]: string[] } } = {};
        const routeData: {
          [key: string]: { [key: string]: { [aggregator: string]: string[] } };
        } = {};

        tokens.forEach((from) => {
          matrix[from] = {};
          routeData[from] = {};
          tokens.forEach((to) => {
            matrix[from][to] = [];
            routeData[from][to] = {};
          });
        });

        routes.forEach((route) => {
          const { from, to } = route.pair;
          route.routes.forEach((r) => {
            if (!matrix[from][to].includes(r.aggregator)) {
              matrix[from][to].push(r.aggregator);
            }
            routeData[from][to][r.aggregator] = r.dexes;
          });
        });

        const finalData = { tokens, matrix, routes: routeData };
        console.log("Final data structure:", finalData);
        setData(finalData);
        setLoading(false);
      })
      .catch((err) => {
        setError(`Failed to fetch data: ${err.message}`);
        setLoading(false);
        console.error("Fetch error:", err);
      });
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
        {Object.keys(data.routes).length}
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
    </div>
  );
}

export default App;
