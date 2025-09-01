import axios from "axios";
import { db } from "./db";
import { SlippageData, QuoteResponse, PairRoutes } from "./types";

const ETHERLINK_CHAIN_ID = 42793;

// Test amounts in USD - reduced to stay within rate limits
const TEST_AMOUNTS = [1000]; // Only 1 amount to minimize API calls

// Track API usage
let requestCount = 0;
const MAX_REQUESTS_PER_HOUR = 10; // Very conservative limit to avoid rate limits

export async function fetchAndCacheSlippageData(): Promise<void> {
  console.log("Starting slippage data fetch...");

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

    // First, get existing routes from the routes cache to know which pairs have routes
    const existingRoutes = await new Promise<PairRoutes[]>(
      (resolve, reject) => {
        database.all(
          "SELECT routes_data FROM routes_cache ORDER BY pair_from, pair_to",
          (err: Error | null, rows: any[]) => {
            if (err) {
              reject(err);
            } else {
              const parsedRoutes = rows.map((row) =>
                JSON.parse(row.routes_data)
              );
              resolve(parsedRoutes);
            }
          }
        );
      }
    );

    console.log(
      `Found ${existingRoutes.length} existing routes, checking for slippage...`
    );

    // Only test the most important pairs to stay within rate limits
    const priorityPairs = [
      ["USDC", "WETH"],
      ["USDC", "USDT"],
      ["WETH", "WBTC"],
    ];

    const tokenPairs: { from: any; to: any }[] = [];

    for (const [fromSymbol, toSymbol] of priorityPairs) {
      const from = tokens.find((t) => t.symbol === fromSymbol);
      const to = tokens.find((t) => t.symbol === toSymbol);

      if (from && to) {
        tokenPairs.push({ from, to });
      }
    }

    console.log(`Processing ${tokenPairs.length} token pairs for slippage...`);

    // Clear existing slippage cache
    await new Promise<void>((resolve, reject) => {
      database.run("DELETE FROM slippage_cache", (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    let successCount = 0;
    let errorCount = 0;

    // Process each pair with strict rate limiting
    for (let i = 0; i < tokenPairs.length; i++) {
      const { from, to } = tokenPairs[i];

      // Check if we've hit our rate limit
      if (requestCount >= MAX_REQUESTS_PER_HOUR) {
        console.log(
          `Rate limit reached (${requestCount} requests). Stopping slippage fetch.`
        );
        break;
      }

      // Add delay between pairs to avoid rate limiting
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay between pairs (reduced with API key)
      }

      try {
        const slippageAmounts: { [key: string]: number | null } = {
          "1000": null,
          "10000": null,
          "50000": null,
          "100000": null,
        };

        // Test each amount with delays
        for (let j = 0; j < TEST_AMOUNTS.length; j++) {
          const amountUSD = TEST_AMOUNTS[j];

          // Check rate limit before each request
          if (requestCount >= MAX_REQUESTS_PER_HOUR) {
            console.log(`Rate limit reached during processing. Stopping.`);
            break;
          }

          // Add delay between amount requests
          if (j > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay between amounts (reduced with API key)
          }
          try {
            // Convert USD amount to token amount (assuming 1 USD = 1 token for simplicity)
            // In reality, you'd need to get the token price from the API
            const fromAmount = (
              amountUSD * Math.pow(10, from.decimals)
            ).toString();

            requestCount++;
            console.log(
              `Making request ${requestCount}/${MAX_REQUESTS_PER_HOUR} for ${from.symbol}→${to.symbol} at $${amountUSD}`
            );

            const headers: any = {
              "Content-Type": "application/json",
            };

            // Add API key if available
            if (process.env.LIFI_API_KEY) {
              headers["x-lifi-api-key"] = process.env.LIFI_API_KEY;
            }

            const response = await axios.post(
              "https://li.quest/v1/advanced/routes",
              {
                fromChainId: ETHERLINK_CHAIN_ID,
                fromAmount: fromAmount,
                fromTokenAddress: from.address,
                toChainId: ETHERLINK_CHAIN_ID,
                toTokenAddress: to.address,
                options: {},
              },
              {
                headers,
                timeout: 10000, // 10 second timeout
              }
            );

            if (response.data.routes && response.data.routes.length > 0) {
              const route = response.data.routes[0]; // Take the first (best) route
              const fromAmountNum = parseFloat(route.fromAmountUSD);
              const toAmountNum = parseFloat(route.toAmountUSD);

              // Calculate slippage as percentage
              const slippage =
                ((fromAmountNum - toAmountNum) / fromAmountNum) * 100;
              slippageAmounts[amountUSD.toString()] =
                Math.round(slippage * 1000) / 1000; // Round to 3 decimal places
            }
          } catch (amountError) {
            if (
              amountError instanceof Error &&
              amountError.message.includes("429")
            ) {
              console.log(
                `Rate limited for ${from.symbol}→${to.symbol} at $${amountUSD}, waiting 5 seconds...`
              );
              await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds for rate limit
              // Retry once (but only if we haven't hit rate limit)
              if (requestCount < MAX_REQUESTS_PER_HOUR) {
                try {
                  requestCount++;
                  console.log(
                    `Retry request ${requestCount}/${MAX_REQUESTS_PER_HOUR} for ${from.symbol}→${to.symbol} at $${amountUSD}`
                  );

                  // Recalculate fromAmount for retry
                  const retryFromAmount = (
                    amountUSD * Math.pow(10, from.decimals)
                  ).toString();

                  const retryHeaders: any = {
                    "Content-Type": "application/json",
                  };

                  // Add API key if available
                  if (process.env.LIFI_API_KEY) {
                    retryHeaders["x-lifi-api-key"] = process.env.LIFI_API_KEY;
                  }

                  const retryResponse = await axios.post(
                    "https://li.quest/v1/advanced/routes",
                    {
                      fromChainId: ETHERLINK_CHAIN_ID,
                      fromAmount: retryFromAmount,
                      fromTokenAddress: from.address,
                      toChainId: ETHERLINK_CHAIN_ID,
                      toTokenAddress: to.address,
                      options: {},
                    },
                    {
                      headers: retryHeaders,
                      timeout: 10000,
                    }
                  );

                  if (
                    retryResponse.data.routes &&
                    retryResponse.data.routes.length > 0
                  ) {
                    const route = retryResponse.data.routes[0];
                    const fromAmountNum = parseFloat(route.fromAmountUSD);
                    const toAmountNum = parseFloat(route.toAmountUSD);
                    const slippage =
                      ((fromAmountNum - toAmountNum) / fromAmountNum) * 100;
                    slippageAmounts[amountUSD.toString()] =
                      Math.round(slippage * 1000) / 1000;
                  }
                } catch (retryError) {
                  console.error(
                    `Retry failed for ${from.symbol}→${to.symbol} at $${amountUSD}:`,
                    retryError instanceof Error
                      ? retryError.message
                      : "Unknown error"
                  );
                }
              } else {
                console.log(
                  `Skipping retry due to rate limit (${requestCount}/${MAX_REQUESTS_PER_HOUR})`
                );
              }
            } else {
              console.error(
                `Error fetching quote for ${from.symbol}→${to.symbol} at $${amountUSD}:`,
                amountError instanceof Error
                  ? amountError.message
                  : "Unknown error"
              );
            }
            // Keep slippage as null for this amount if all attempts fail
          }
        }

        // Store slippage data in database
        await new Promise<void>((resolve, reject) => {
          database.run(
            `INSERT INTO slippage_cache 
             (pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              from.symbol,
              to.symbol,
              slippageAmounts["1000"],
              slippageAmounts["10000"],
              slippageAmounts["50000"],
              slippageAmounts["100000"],
            ],
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
      } catch (error) {
        console.error(
          `Error processing slippage for ${from.symbol}→${to.symbol}:`,
          error instanceof Error ? error.message : "Unknown error"
        );
        errorCount++;
      }
    }

    console.log(
      `Slippage data fetch completed. Success: ${successCount}, Errors: ${errorCount}`
    );
  } catch (error) {
    console.error("Error in fetchAndCacheSlippageData:", error);
  }
}

export async function getCachedSlippageData(): Promise<{
  slippageData: SlippageData[];
  lastUpdated: string | null;
}> {
  const database = db();

  try {
    // Get all cached slippage data
    const rows = await new Promise<any[]>((resolve, reject) => {
      database.all(
        "SELECT pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000 FROM slippage_cache ORDER BY pair_from, pair_to",
        (err: Error | null, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });

    const slippageData: SlippageData[] = rows.map((row) => ({
      pair: { from: row.pair_from, to: row.pair_to },
      amounts: {
        "1000": row.amount_1000,
        "10000": row.amount_10000,
        "50000": row.amount_50000,
        "100000": row.amount_100000,
      },
    }));

    // Get the most recent update timestamp
    const lastUpdated = await new Promise<string | null>((resolve, reject) => {
      database.get(
        "SELECT MAX(last_updated) as last_updated FROM slippage_cache",
        (err: Error | null, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row?.last_updated || null);
          }
        }
      );
    });

    return { slippageData, lastUpdated };
  } catch (error) {
    console.error("Error getting cached slippage data:", error);
    return { slippageData: [], lastUpdated: null };
  }
}
