import React, { useMemo, useEffect, useRef } from "react";
// @ts-ignore - react-force-graph-2d doesn't have type definitions
import ForceGraph2D from "react-force-graph-2d";
import { SlippageData } from "@assets-availability/types";

interface GraphProps {
  slippageData: SlippageData[];
  routesData: any[];
}

interface GraphNode {
  id: string;
  symbol: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  color: string;
  label: string;
  textColor: string;
  bestProvider: string;
}

const Graph: React.FC<GraphProps> = ({ slippageData, routesData }) => {
  const graphRef = useRef<any>(null);
  const [selectedVolume, setSelectedVolume] = React.useState<
    "1000" | "10000" | "50000" | "100000"
  >("10000");
  const [selectedToken, setSelectedToken] = React.useState<string>("all");
  const [selectedAggregator, setSelectedAggregator] = React.useState<
    "best" | "LiFi" | "OKU"
  >("best");

  // Helper function to get color based on slippage percentage for text labels
  const getSlippageTextColor = (slippagePercent: number | null): string => {
    if (slippagePercent === null) return "#6c757d"; // Gray for unknown
    if (slippagePercent < 1) return "#28a745"; // Green for under 1%
    if (slippagePercent <= 15) return "#ffc107"; // Yellow for 1-15%
    return "#dc3545"; // Red for over 15%
  };

  // Helper function to get connection color based on provider
  const getProviderColor = (provider: string): string => {
    return provider === "OKU" ? "#28a745" : "#ffc107";
  };

  const { nodes, links } = useMemo(() => {
    // Group slippage data by pair to find best routes
    const groupedData: {
      [key: string]: { LiFi?: SlippageData; OKU?: SlippageData };
    } = {};

    slippageData.forEach((slippage) => {
      const pairKey = `${slippage.pair.from}-${slippage.pair.to}`;
      if (!groupedData[pairKey]) {
        groupedData[pairKey] = {};
      }
      groupedData[pairKey][
        slippage.provider as keyof (typeof groupedData)[string]
      ] = slippage;
    });

    // Create nodes from all unique tokens in routes data
    const tokenSet = new Set<string>();
    if (routesData && Array.isArray(routesData)) {
      routesData.forEach((route) => {
        if (route.pair && route.pair.from && route.pair.to) {
          tokenSet.add(route.pair.from);
          tokenSet.add(route.pair.to);
        }
      });
    } else {
      // Fallback to slippage data if routes data is not available
      slippageData.forEach((slippage) => {
        tokenSet.add(slippage.pair.from);
        tokenSet.add(slippage.pair.to);
      });
    }

    // Create nodes with better initial positioning
    const tokenArray = Array.from(tokenSet);
    const centerX = 400; // Center of 800px width
    const centerY = 300; // Center of 600px height
    const radius = 200;

    const nodes: GraphNode[] = tokenArray.map((token, index) => {
      const angle = (2 * Math.PI * index) / tokenArray.length;
      // Add some randomness to prevent perfect alignment
      const randomOffset = (Math.random() - 0.5) * 30;
      return {
        id: token,
        symbol: token,
        x: centerX + radius * Math.cos(angle) + randomOffset,
        y: centerY + radius * Math.sin(angle) + randomOffset,
      };
    });

    // Create links based on routes data, filtered by selected aggregator
    const links: GraphLink[] = [];

    // Process routes data to find all available connections
    if (routesData && Array.isArray(routesData)) {
      console.log(
        `Processing ${routesData.length} routes for aggregator filter: ${selectedAggregator}`
      );
      routesData.forEach((route) => {
        if (!route.pair || !route.pair.from || !route.pair.to) return;

        const fromToken = route.pair.from;
        const toToken = route.pair.to;
        const pairKey = `${fromToken}-${toToken}`;

        // Filter by selected token if not "all"
        if (
          selectedToken !== "all" &&
          fromToken !== selectedToken &&
          toToken !== selectedToken
        ) {
          return;
        }

        // Filter by selected aggregator
        if (selectedAggregator === "best") {
          // For "best", we need to check which provider is better for this pair
          const providers = groupedData[pairKey] || {};
          const lifiData = providers.LiFi;
          const okuData = providers.OKU;

          const lifiAmount = lifiData?.amounts[selectedVolume] || null;
          const okuAmount = okuData?.amounts[selectedVolume] || null;

          const getBestProvider = (
            lifiAmount: number | null,
            okuAmount: number | null
          ) => {
            if (lifiAmount === null && okuAmount === null) return null;
            if (lifiAmount === null) return "OKU";
            if (okuAmount === null) return "LiFi";
            return lifiAmount < okuAmount ? "LiFi" : "OKU";
          };

          const bestProvider = getBestProvider(lifiAmount, okuAmount);
          if (!bestProvider) return; // No data for either provider

          // Get slippage data for the best provider
          const bestSlippageData = groupedData[pairKey]?.[bestProvider];
          const amount = bestSlippageData?.amounts[selectedVolume] || null;
          const displayAmount = amount;
          const displayProvider = bestProvider;
          const displayColor = getProviderColor(displayProvider);
          const textColor = getSlippageTextColor(displayAmount);

          // Add the connection
          if (displayProvider && fromToken && toToken) {
            const label =
              displayAmount !== null
                ? `${displayAmount.toFixed(2)}%`
                : "Unknown";
            links.push({
              source: fromToken,
              target: toToken,
              color: displayColor,
              label: label,
              textColor: textColor,
              bestProvider: displayProvider,
            });
          }
        } else {
          // Show selected aggregator - check if this route is from the selected aggregator
          // The provider info is in route.routes[0].aggregator, not route.provider
          const routeAggregator = route.routes?.[0]?.aggregator || "LiFi";
          console.log(
            `Route ${fromToken}->${toToken}: aggregator=${routeAggregator}, selected=${selectedAggregator}`
          );

          // Handle case sensitivity - backend uses "Oku" but frontend uses "OKU"
          const normalizedRouteAggregator =
            routeAggregator === "Oku" ? "OKU" : routeAggregator;
          if (selectedAggregator !== normalizedRouteAggregator) {
            return;
          }

          // Get slippage data for this specific provider and pair
          // Convert route aggregator name to slippage data format
          const slippageProviderName =
            routeAggregator === "Oku" ? "OKU" : routeAggregator;
          const slippageData =
            groupedData[pairKey]?.[
              slippageProviderName as keyof (typeof groupedData)[string]
            ];
          const amount = slippageData?.amounts[selectedVolume] || null;
          const displayAmount = amount;
          const displayProvider = selectedAggregator;
          const displayColor = getProviderColor(displayProvider);
          const textColor = getSlippageTextColor(displayAmount);

          // Add the connection regardless of whether slippage data exists
          if (fromToken && toToken) {
            const label =
              displayAmount !== null
                ? `${displayAmount.toFixed(2)}%`
                : "Unknown";
            links.push({
              source: fromToken,
              target: toToken,
              color: displayColor,
              label: label,
              textColor: textColor,
              bestProvider: displayProvider,
            });
          }
        }
      });
    } else {
      // Fallback to slippage data if routes data is not available
      slippageData.forEach((slippage) => {
        const fromToken = slippage.pair.from;
        const toToken = slippage.pair.to;
        const pairKey = `${fromToken}-${toToken}`;

        // Filter by selected token if not "all"
        if (
          selectedToken !== "all" &&
          fromToken !== selectedToken &&
          toToken !== selectedToken
        ) {
          return;
        }

        // Filter by selected aggregator
        if (selectedAggregator === "best") {
          // For "best", we need to check which provider is better for this pair
          const providers = groupedData[pairKey] || {};
          const lifiData = providers.LiFi;
          const okuData = providers.OKU;

          const lifiAmount = lifiData?.amounts[selectedVolume] || null;
          const okuAmount = okuData?.amounts[selectedVolume] || null;

          const getBestProvider = (
            lifiAmount: number | null,
            okuAmount: number | null
          ) => {
            if (lifiAmount === null && okuAmount === null) return null;
            if (lifiAmount === null) return "OKU";
            if (okuAmount === null) return "LiFi";
            return lifiAmount < okuAmount ? "LiFi" : "OKU";
          };

          const bestProvider = getBestProvider(lifiAmount, okuAmount);
          if (bestProvider !== slippage.provider) {
            return; // This is not the best provider for this pair
          }
        } else {
          // Handle case sensitivity for slippage data
          const slippageProvider = slippage.provider;
          const normalizedSlippageProvider =
            slippageProvider === "OKU" ? "OKU" : slippageProvider;
          if (selectedAggregator !== normalizedSlippageProvider) {
            return; // This is not the selected aggregator
          }
        }

        // Use selected volume for this specific slippage data
        const amount = slippage.amounts[selectedVolume] || null;
        const displayAmount = amount;
        const displayProvider = slippage.provider;
        const displayColor = getProviderColor(displayProvider);
        const textColor = getSlippageTextColor(displayAmount);

        // Add the connection regardless of whether slippage data exists
        if (fromToken && toToken) {
          const label =
            displayAmount !== null ? `${displayAmount.toFixed(2)}%` : "Unknown";
          links.push({
            source: fromToken,
            target: toToken,
            color: displayColor,
            label: label,
            textColor: textColor,
            bestProvider: displayProvider,
          });
        }
      });
    }

    // Filter nodes to only show tokens that have connections when a specific token is selected
    const filteredNodes =
      selectedToken === "all"
        ? nodes
        : nodes.filter((node) =>
            links.some(
              (link) => link.source === node.id || link.target === node.id
            )
          );

    return { nodes: filteredNodes, links };
  }, [
    slippageData,
    routesData,
    selectedVolume,
    selectedToken,
    selectedAggregator,
  ]);

  useEffect(() => {
    if (graphRef.current) {
      // Restart the simulation when data changes
      setTimeout(() => {
        graphRef.current.d3ReheatSimulation();
        graphRef.current.d3Force("charge").strength(-1000);
        graphRef.current.d3Force("link").distance(200);
      }, 100);
    }
  }, [nodes, links]);

  return (
    <div style={{ marginTop: "40px" }}>
      <h2>Token Connection Graph</h2>
      <p style={{ fontSize: "14px", color: "#666", marginBottom: "20px" }}>
        Visual representation of routes between tokens. Connection colors
        indicate the provider (green: OKU, yellow: LiFi), while label colors
        show slippage ranges (green: under 1%, yellow: 1-15%, red: over 15%).
        Filter by trade size, token, and aggregator to analyze specific
        scenarios.
      </p>

      {/* Filters */}
      <div
        style={{
          marginBottom: "20px",
          display: "flex",
          gap: "20px",
          alignItems: "center",
        }}
      >
        {/* Volume Filter */}
        <div>
          <label
            style={{
              fontSize: "14px",
              fontWeight: "600",
              color: "#495057",
              marginRight: "10px",
            }}
          >
            Trade Size:
          </label>
          <select
            value={selectedVolume}
            onChange={(e) =>
              setSelectedVolume(
                e.target.value as "1000" | "10000" | "50000" | "100000"
              )
            }
            style={{
              padding: "6px 12px",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              fontSize: "14px",
              backgroundColor: "#fff",
              cursor: "pointer",
            }}
          >
            <option value="1000">$1,000</option>
            <option value="10000">$10,000</option>
            <option value="50000">$50,000</option>
            <option value="100000">$100,000</option>
          </select>
        </div>

        {/* Token Filter */}
        <div>
          <label
            style={{
              fontSize: "14px",
              fontWeight: "600",
              color: "#495057",
              marginRight: "10px",
            }}
          >
            Token:
          </label>
          <select
            value={selectedToken}
            onChange={(e) => setSelectedToken(e.target.value)}
            style={{
              padding: "6px 12px",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              fontSize: "14px",
              backgroundColor: "#fff",
              cursor: "pointer",
              minWidth: "120px",
            }}
          >
            <option value="all">All Tokens</option>
            {Array.from(
              new Set(
                slippageData.flatMap((data) => [data.pair.from, data.pair.to])
              )
            )
              .sort()
              .map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
          </select>
        </div>

        {/* Aggregator Filter */}
        <div>
          <label
            style={{
              fontSize: "14px",
              fontWeight: "600",
              color: "#495057",
              marginRight: "10px",
            }}
          >
            Aggregator:
          </label>
          <select
            value={selectedAggregator}
            onChange={(e) =>
              setSelectedAggregator(e.target.value as "best" | "LiFi" | "OKU")
            }
            style={{
              padding: "6px 12px",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              fontSize: "14px",
              backgroundColor: "#fff",
              cursor: "pointer",
              minWidth: "120px",
            }}
          >
            <option value="best">Best Route</option>
            <option value="LiFi">LiFi Only</option>
            <option value="OKU">OKU Only</option>
          </select>
        </div>
      </div>
      <div
        style={{
          height: "600px",
          border: "1px solid #dee2e6",
          borderRadius: "4px",
          backgroundColor: "#fafafa",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <ForceGraph2D
          ref={graphRef}
          key={`graph-${nodes.length}-${links.length}`}
          graphData={{ nodes, links }}
          nodeLabel={(node: GraphNode) => `${node.symbol}`}
          linkLabel={(link: GraphLink) => `${link.bestProvider}: ${link.label}`}
          linkColor={(link: GraphLink) => link.color}
          linkWidth={4}
          linkDirectionalArrowLength={8}
          linkDirectionalArrowRelPos={1}
          width={800}
          height={600}
          nodeCanvasObject={(
            node: GraphNode,
            ctx: CanvasRenderingContext2D,
            globalScale: number
          ) => {
            const label = node.symbol;
            const fontSize = Math.max(12 / globalScale, 10);
            ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#000000";

            // Add smaller background circle for better readability
            const padding = 4;
            const textWidth = ctx.measureText(label).width;
            const textHeight = fontSize;
            const radius = Math.max(textWidth, textHeight) / 2 + padding;

            ctx.beginPath();
            ctx.arc(node.x || 0, node.y || 0, radius, 0, 2 * Math.PI);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.strokeStyle = "#007bff";
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.fillStyle = "#000000";
            ctx.fillText(label, node.x || 0, node.y || 0);
          }}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(
            link: GraphLink,
            ctx: CanvasRenderingContext2D
          ) => {
            const { source, target } = link;
            const midX = ((source as any).x + (target as any).x) / 2;
            const midY = ((source as any).y + (target as any).y) / 2;

            // Make text smaller but still readable
            ctx.font =
              "bold 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            const text = link.label;
            const textWidth = ctx.measureText(text).width;
            const padding = 4;

            // Add smaller background for better readability
            ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
            ctx.fillRect(
              midX - textWidth / 2 - padding,
              midY - 6,
              textWidth + padding * 2,
              12
            );

            // Add border for better contrast
            ctx.strokeStyle = link.color;
            ctx.lineWidth = 1;
            ctx.strokeRect(
              midX - textWidth / 2 - padding,
              midY - 6,
              textWidth + padding * 2,
              12
            );

            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // Use slippage-based color for the text
            ctx.fillStyle = link.textColor;
            ctx.fillText(text, midX, midY);
          }}
          nodeColor="#007bff"
          nodeVal={2}
          cooldownTicks={500}
          d3AlphaDecay={0.005}
          d3VelocityDecay={0.2}
          enableZoomInteraction={true}
        />
      </div>
      <div
        style={{
          marginTop: "15px",
          fontSize: "12px",
          color: "#6c757d",
          display: "flex",
          flexDirection: "column",
          gap: "15px",
          alignItems: "center",
        }}
      >
        {/* Connection Colors (Provider-based) */}
        <div style={{ display: "flex", gap: "30px", alignItems: "center" }}>
          <span style={{ fontWeight: "600", marginRight: "10px" }}>
            Connection Colors:
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "16px",
                height: "3px",
                backgroundColor: "#28a745",
                borderRadius: "1px",
              }}
            ></div>
            <span style={{ fontWeight: "500" }}>OKU Routes</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "16px",
                height: "3px",
                backgroundColor: "#ffc107",
                borderRadius: "1px",
              }}
            ></div>
            <span style={{ fontWeight: "500" }}>LiFi Routes</span>
          </div>
        </div>

        {/* Text Colors (Slippage-based) */}
        <div style={{ display: "flex", gap: "30px", alignItems: "center" }}>
          <span style={{ fontWeight: "600", marginRight: "10px" }}>
            Label Colors:
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{ color: "#28a745", fontWeight: "bold", fontSize: "14px" }}
            >
              1.2%
            </span>
            <span style={{ fontWeight: "500" }}>Under 1%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{ color: "#ffc107", fontWeight: "bold", fontSize: "14px" }}
            >
              5.4%
            </span>
            <span style={{ fontWeight: "500" }}>1-15%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{ color: "#dc3545", fontWeight: "bold", fontSize: "14px" }}
            >
              18%
            </span>
            <span style={{ fontWeight: "500" }}>Over 15%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{ color: "#6c757d", fontWeight: "bold", fontSize: "14px" }}
            >
              ?
            </span>
            <span style={{ fontWeight: "500" }}>Unknown</span>
          </div>
        </div>

        {/* Token indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              backgroundColor: "#007bff",
              borderRadius: "50%",
            }}
          ></div>
          <span>Token</span>
        </div>
      </div>
    </div>
  );
};

export default Graph;
