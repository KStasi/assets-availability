import axios from "axios";
import { db } from "./db";
import { PairRoutes } from "./types";

const ETHERLINK_CHAIN_ID = 42793;

export async function fetchAndCacheLiFiData(): Promise<void> {
  console.log("Starting LiFi data fetch...");

  try {
    const database = db();

    // Get all tokens from database
    const tokens = await new Promise<any[]>((resolve, reject) => {
      database.all(
        "SELECT symbol, address, decimals FROM tokens ORDER BY symbol",
        (err: Error | null, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });

    // Generate unique pairs (avoid duplicates like USDC→WETH and WETH→USDC)
    const pairs = new Set<string>();
    const tokenPairs: { from: any; to: any }[] = [];

    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const from = tokens[i];
        const to = tokens[j];

        // Create a normalized pair key to avoid duplicates
        const pairKey = [from.symbol, to.symbol].sort().join("→");

        if (!pairs.has(pairKey)) {
          pairs.add(pairKey);
          tokenPairs.push({ from, to });
        }
      }
    }

    console.log(`Processing ${tokenPairs.length} token pairs...`);

    // Clear existing cache
    await new Promise<void>((resolve, reject) => {
      database.run("DELETE FROM routes_cache", (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

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
          await new Promise<void>((resolve, reject) => {
            database.run(
              "INSERT INTO routes_cache (pair_from, pair_to, routes_data) VALUES (?, ?, ?)",
              [from.symbol, to.symbol, JSON.stringify(pairRoute)],
              (err: Error | null) => {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              }
            );
          });

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
  const database = db();

  try {
    // Get all cached routes
    const routes = await new Promise<PairRoutes[]>((resolve, reject) => {
      database.all(
        "SELECT routes_data FROM routes_cache ORDER BY pair_from, pair_to",
        (err: Error | null, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            const parsedRoutes = rows.map((row) => JSON.parse(row.routes_data));
            resolve(parsedRoutes);
          }
        }
      );
    });

    // Get the most recent update timestamp
    const lastUpdated = await new Promise<string | null>((resolve, reject) => {
      database.get(
        "SELECT MAX(last_updated) as last_updated FROM routes_cache",
        (err: Error | null, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row?.last_updated || null);
          }
        }
      );
    });

    return { routes, lastUpdated };
  } catch (error) {
    console.error("Error getting cached routes:", error);
    return { routes: [], lastUpdated: null };
  }
}
