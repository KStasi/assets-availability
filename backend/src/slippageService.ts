import axios from "axios";
import { query } from "./db";
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
    // Get all tokens from database
    const tokensResult = await query(
      "SELECT symbol, address, decimals FROM tokens ORDER BY symbol"
    );
    const tokens = tokensResult.rows;

    // First, get existing routes from the routes cache to know which pairs have routes
    const existingRoutesResult = await query(
      "SELECT routes_data FROM routes_cache ORDER BY pair_from, pair_to"
    );
    const existingRoutes = existingRoutesResult.rows.map((row: any) =>
      JSON.parse(row.routes_data)
    );

    console.log(
      `Found ${existingRoutes.length} existing routes, checking for slippage...`
    );

    // Use all available connections from routes cache instead of hardcoded pairs
    const tokenPairs: { from: any; to: any }[] = [];

    // Extract unique pairs from existing routes
    const uniquePairs = new Set<string>();

    existingRoutes.forEach((route: PairRoutes) => {
      if (route.pair && route.pair.from && route.pair.to) {
        const pairKey = `${route.pair.from}→${route.pair.to}`;
        const reversePairKey = `${route.pair.to}→${route.pair.from}`;

        // Only add if we haven't seen this pair or its reverse
        if (!uniquePairs.has(pairKey) && !uniquePairs.has(reversePairKey)) {
          uniquePairs.add(pairKey);

          const from = tokens.find((t: any) => t.symbol === route.pair.from);
          const to = tokens.find((t: any) => t.symbol === route.pair.to);

          if (from && to) {
            tokenPairs.push({ from, to });
          }
        }
      }
    });

    // If no routes found, fall back to some basic pairs
    if (tokenPairs.length === 0) {
      console.log("No routes found in cache, using fallback pairs...");
      const fallbackPairs = [
        ["USDC", "WETH"],
        ["USDC", "USDT"],
        ["WETH", "WBTC"],
      ];

      for (const [fromSymbol, toSymbol] of fallbackPairs) {
        const from = tokens.find((t: any) => t.symbol === fromSymbol);
        const to = tokens.find((t: any) => t.symbol === toSymbol);

        if (from && to) {
          tokenPairs.push({ from, to });
        }
      }
    }

    console.log(`Processing ${tokenPairs.length} token pairs for slippage...`);

    // Clear existing slippage cache
    await query("DELETE FROM slippage_cache");

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
                  // Mark this amount as failed
                  slippageAmounts[amountUSD.toString()] = null;
                }
              } else {
                console.log(
                  `Skipping retry due to rate limit (${requestCount}/${MAX_REQUESTS_PER_HOUR})`
                );
              }
            } else {
              // Check if it's a 400 error (bad request) which might indicate unsupported pair
              if (
                amountError instanceof Error &&
                amountError.message.includes("400")
              ) {
                console.log(
                  `⚠️  ${from.symbol}→${to.symbol} at $${amountUSD}: Bad request (400) - this pair might not be supported or have insufficient liquidity`
                );
              } else {
                console.error(
                  `Error fetching quote for ${from.symbol}→${to.symbol} at $${amountUSD}:`,
                  amountError instanceof Error
                    ? amountError.message
                    : "Unknown error"
                );
              }
              // Mark this amount as failed
              slippageAmounts[amountUSD.toString()] = null;
            }
            // Keep slippage as null for this amount if all attempts fail
          }
        }

        // Store slippage data in database
        await query(
          `INSERT INTO slippage_cache 
           (pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            from.symbol,
            to.symbol,
            slippageAmounts["1000"],
            slippageAmounts["10000"],
            slippageAmounts["50000"],
            slippageAmounts["100000"],
          ]
        );

        // Check if this pair has any successful amounts
        const hasSuccessfulAmounts = Object.values(slippageAmounts).some(
          (amount) => amount !== null
        );

        // Log detailed results for this pair
        const successfulAmounts = Object.entries(slippageAmounts)
          .filter(([_, amount]) => amount !== null)
          .map(([amount, value]) => `$${amount}: ${value}%`)
          .join(", ");

        const failedAmounts = Object.entries(slippageAmounts)
          .filter(([_, amount]) => amount === null)
          .map(([amount, _]) => `$${amount}`)
          .join(", ");

        if (hasSuccessfulAmounts) {
          console.log(
            `✓ ${from.symbol}→${to.symbol}: Successful amounts: ${successfulAmounts}`
          );
          if (failedAmounts) {
            console.log(`  Failed amounts: ${failedAmounts}`);
          }
          successCount++;
        } else {
          console.log(`✗ ${from.symbol}→${to.symbol}: All amounts failed`);
          errorCount++;
        }
      } catch (error) {
        console.error(
          `Error processing slippage for ${from.symbol}→${to.symbol}:`,
          error instanceof Error ? error.message : "Unknown error"
        );
        errorCount++;
      }
    }

    // Get final summary of all amounts
    const allAmountsResult = await query(
      "SELECT amount_1000, amount_10000, amount_50000, amount_100000 FROM slippage_cache"
    );
    const allAmounts = allAmountsResult.rows;

    let totalAmounts = 0;
    let successfulAmounts = 0;
    let failedAmounts = 0;

    allAmounts.forEach((row: any) => {
      Object.values(row).forEach((amount) => {
        totalAmounts++;
        if (amount !== null) {
          successfulAmounts++;
        } else {
          failedAmounts++;
        }
      });
    });

    console.log(
      `Slippage data fetch completed. Pairs: Success: ${successCount}, Errors: ${errorCount}`
    );
    console.log(
      `Amounts: Total: ${totalAmounts}, Successful: ${successfulAmounts}, Failed: ${failedAmounts}`
    );
  } catch (error) {
    console.error("Error in fetchAndCacheSlippageData:", error);
  }
}

export async function getCachedSlippageData(): Promise<{
  slippageData: SlippageData[];
  lastUpdated: string | null;
}> {
  try {
    // Get all cached slippage data
    const rowsResult = await query(
      "SELECT pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000 FROM slippage_cache ORDER BY pair_from, pair_to"
    );
    const rows = rowsResult.rows;

    const slippageData: SlippageData[] = rows.map((row: any) => ({
      pair: { from: row.pair_from, to: row.pair_to },
      amounts: {
        "1000": row.amount_1000,
        "10000": row.amount_10000,
        "50000": row.amount_50000,
        "100000": row.amount_100000,
      },
    }));

    // Get the most recent update timestamp
    const lastUpdatedResult = await query(
      "SELECT MAX(last_updated) as last_updated FROM slippage_cache"
    );
    const lastUpdated = lastUpdatedResult.rows[0]?.last_updated || null;

    return { slippageData, lastUpdated };
  } catch (error) {
    console.error("Error getting cached slippage data:", error);
    return { slippageData: [], lastUpdated: null };
  }
}

// Function to manually trigger slippage calculation
export async function manualSlippageCalculation(): Promise<void> {
  console.log("Manual slippage calculation triggered...");

  // Reset request count for manual runs
  requestCount = 0;

  try {
    await fetchAndCacheSlippageData();
    console.log("Manual slippage calculation completed successfully");
  } catch (error) {
    console.error("Manual slippage calculation failed:", error);
  }
}

// Function to get current slippage cache status
export async function getSlippageCacheStatus(): Promise<{
  totalPairs: number;
  successfulPairs: number;
  failedPairs: number;
  lastUpdated: string | null;
}> {
  try {
    // Count total pairs
    const totalResult = await query(
      "SELECT COUNT(*) as count FROM slippage_cache"
    );
    const totalPairs = parseInt(totalResult.rows[0].count);

    // Count successful pairs (those with at least one non-null amount)
    const successfulResult = await query(`
      SELECT COUNT(*) as count FROM slippage_cache 
      WHERE amount_1000 IS NOT NULL 
      OR amount_10000 IS NOT NULL 
      OR amount_50000 IS NOT NULL 
      OR amount_100000 IS NOT NULL
    `);
    const successfulPairs = parseInt(successfulResult.rows[0].count);

    // Get last updated timestamp
    const lastUpdatedResult = await query(
      "SELECT MAX(last_updated) as last_updated FROM slippage_cache"
    );
    const lastUpdated = lastUpdatedResult.rows[0]?.last_updated || null;

    return {
      totalPairs,
      successfulPairs,
      failedPairs: totalPairs - successfulPairs,
      lastUpdated,
    };
  } catch (error) {
    console.error("Error getting slippage cache status:", error);
    return {
      totalPairs: 0,
      successfulPairs: 0,
      failedPairs: 0,
      lastUpdated: null,
    };
  }
}
