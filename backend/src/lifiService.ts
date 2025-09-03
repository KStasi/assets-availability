import axios from "axios";
import { query } from "./db";
import { PairRoutes } from "./types";

const ETHERLINK_CHAIN_ID = 42793;

export async function fetchAndCacheLiFiData(): Promise<void> {
  console.log("Starting LiFi data fetch...");

  try {
    // Get all tokens from database
    const tokensResult = await query(
      "SELECT symbol, address, decimals FROM tokens ORDER BY symbol"
    );
    const tokens = tokensResult.rows;

    // Generate unique pairs (avoid duplicates like USDC→WETH and WETH→USDC)
    const pairs = new Set<string>();
    const tokenPairs: { from: any; to: any }[] = [];

    for (let i = 0; i < tokens.length; i++) {
      for (let j = 0; j < tokens.length; j++) {
        // Skip self-pairs (token to itself)
        if (i === j) continue;

        const from = tokens[i];
        const to = tokens[j];

        // Create a normalized pair key to avoid duplicates
        const pairKey = [from.symbol, to.symbol].sort().join("→");

        if (!pairs.has(pairKey)) {
          pairs.add(pairKey);
          // Add both directions for each unique pair
          tokenPairs.push({ from, to });
          tokenPairs.push({ from: to, to: from });
        }
      }
    }

    console.log(`Processing ${tokenPairs.length} token pairs...`);

    // Clear existing cache
    await query("DELETE FROM routes_cache");

    const results: PairRoutes[] = [];
    let successCount = 0;
    let errorCount = 0;

    // Process each pair
    for (const { from, to } of tokenPairs) {
      try {
        const headers: any = {};

        // Add API key if available
        if (process.env.LIFI_API_KEY) {
          headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
        }

        const response = await axios.get("https://li.quest/v1/connections", {
          params: {
            fromChain: ETHERLINK_CHAIN_ID,
            toChain: ETHERLINK_CHAIN_ID,
            fromToken: from.address,
            toToken: to.address,
          },
          headers,
        });

        // Only add if connections array has items
        if (response.data.connections?.length > 0) {
          const pairRoute: PairRoutes = {
            pair: { from: from.symbol, to: to.symbol },
            routes: [{ aggregator: "LiFi", dexes: [] }],
          };

          results.push(pairRoute);

          // Store in database
          await query(
            `
            INSERT INTO routes_cache (pair_from, pair_to, routes_data, provider)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (pair_from, pair_to, provider) 
            DO UPDATE SET 
              routes_data = EXCLUDED.routes_data,
              last_updated = CURRENT_TIMESTAMP
          `,
            [from.symbol, to.symbol, JSON.stringify(pairRoute), "LiFi"]
          );

          successCount++;
        }
      } catch (error) {
        console.error(
          `Error fetching LiFi data for ${from.symbol}→${to.symbol}:`,
          error instanceof Error ? error.message : "Unknown error"
        );
        errorCount++;
        // Skip this pair and continue with others
      }
    }

    console.log(
      `LiFi data fetch completed. Success: ${successCount}, Errors: ${errorCount}, Total routes cached: ${results.length}`
    );
  } catch (error) {
    console.error("Error in fetchAndCacheLiFiData:", error);
  }
}

export async function getCachedRoutes(): Promise<{
  routes: PairRoutes[];
  lastUpdated: string | null;
}> {
  try {
    // Get all cached routes
    const routesResult = await query(
      "SELECT routes_data FROM routes_cache ORDER BY pair_from, pair_to"
    );
    const routes = routesResult.rows.map((row: any) =>
      JSON.parse(row.routes_data)
    );

    // Get the most recent update timestamp
    const lastUpdatedResult = await query(
      "SELECT MAX(last_updated) as last_updated FROM routes_cache"
    );
    const lastUpdated = lastUpdatedResult.rows[0]?.last_updated || null;

    return { routes, lastUpdated };
  } catch (error) {
    console.error("Error getting cached routes:", error);
    return { routes: [], lastUpdated: null };
  }
}
