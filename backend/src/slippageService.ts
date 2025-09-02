import axios from "axios";
import { query } from "./db";
import { SlippageData, QuoteResponse, PairRoutes } from "./types";

// Interface for token price data
interface TokenPrice {
  token: string;
  price: number;
  timestamp: string;
}

const ETHERLINK_CHAIN_ID = 42793;

// Test amounts in USD
const TEST_AMOUNTS = [1000, 10000, 50000, 100000];

// Track API usage
let requestCount = 0;
const MAX_REQUESTS_PER_HOUR = 1000; // LiFi API allows 200 requests/minute, so 1000/hour is conservative

// Function to get latest token prices from price table
async function getLatestTokenPrices(): Promise<Map<string, number>> {
  try {
    // Get the latest price for each token by finding the maximum timestamp
    const result = await query(`
      SELECT DISTINCT ON (token) 
        token, 
        price, 
        timestamp
      FROM price 
      ORDER BY token, timestamp DESC
    `);

    const priceMap = new Map<string, number>();
    result.rows.forEach((row: any) => {
      priceMap.set(row.token.toLowerCase(), parseFloat(row.price));
    });

    // Temporary workaround: use WBTC price for LBTC
    const wbtcPrice = priceMap.get("wbtc");
    if (wbtcPrice) {
      priceMap.set("lbtc", wbtcPrice);
      console.log(
        `🔄 Temporary workaround: Using WBTC price ($${wbtcPrice}) for LBTC`
      );
    }

    console.log(`Retrieved latest prices for ${priceMap.size} tokens`);
    return priceMap;
  } catch (error) {
    console.error("Error fetching latest token prices:", error);
    return new Map();
  }
}

export async function fetchAndCacheSlippageData(): Promise<void> {
  console.log("Starting slippage data fetch...");

  try {
    // Create a single timestamp for this entire calculation process
    const calculationTimestamp = new Date().toISOString();
    console.log(`📅 Using calculation timestamp: ${calculationTimestamp}`);

    // Get all tokens from database
    const tokensResult = await query(
      "SELECT symbol, address, decimals FROM tokens ORDER BY symbol"
    );
    const tokens = tokensResult.rows;

    // Get latest token prices from price table
    const tokenPrices = await getLatestTokenPrices();

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
            // Get token price from price table
            const tokenPrice = tokenPrices.get(from.symbol.toLowerCase());

            if (!tokenPrice) {
              console.log(
                `⚠️  No price found for token ${from.symbol}, skipping...`
              );
              slippageAmounts[amountUSD.toString()] = null;
              continue;
            }

            // Convert USD amount to token amount using actual token price
            // amountUSD / tokenPrice = number of tokens needed
            // Then multiply by 10^decimals to get the correct token amount
            const tokenAmount = amountUSD / tokenPrice;
            const fromAmount = Math.floor(
              tokenAmount * Math.pow(10, from.decimals)
            ).toString();

            console.log(
              `💰 ${from.symbol}: $${amountUSD} / $${tokenPrice} = ${tokenAmount} tokens (${fromAmount} wei)`
            );

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
                options: { maxPriceImpact: 1 },
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

                  // Recalculate fromAmount for retry using token price
                  const retryTokenPrice = tokenPrices.get(
                    from.symbol.toLowerCase()
                  );

                  if (!retryTokenPrice) {
                    console.log(
                      `⚠️  No price found for token ${from.symbol} during retry, skipping...`
                    );
                    slippageAmounts[amountUSD.toString()] = null;
                    continue;
                  }

                  const retryTokenAmount = amountUSD / retryTokenPrice;
                  const retryFromAmount = Math.floor(
                    retryTokenAmount * Math.pow(10, from.decimals)
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
                      options: { maxPriceImpact: 1 },
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
           (pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000, calculation_timestamp) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            from.symbol,
            to.symbol,
            slippageAmounts["1000"],
            slippageAmounts["10000"],
            slippageAmounts["50000"],
            slippageAmounts["100000"],
            calculationTimestamp,
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
  calculationTimestamp: string | null;
}> {
  try {
    // Get the latest calculation timestamp
    const latestTimestampResult = await query(
      "SELECT MAX(calculation_timestamp) as latest_timestamp FROM slippage_cache WHERE calculation_timestamp IS NOT NULL"
    );
    const latestTimestamp =
      latestTimestampResult.rows[0]?.latest_timestamp || null;

    if (!latestTimestamp) {
      console.log("No slippage data with calculation timestamp found");
      return {
        slippageData: [],
        lastUpdated: null,
        calculationTimestamp: null,
      };
    }

    // Get all cached slippage data for the latest calculation timestamp
    const rowsResult = await query(
      `SELECT pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000, calculation_timestamp 
       FROM slippage_cache 
       WHERE calculation_timestamp = $1 
       ORDER BY pair_from, pair_to`,
      [latestTimestamp]
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

    // Get the most recent update timestamp for backward compatibility
    const lastUpdatedResult = await query(
      "SELECT MAX(last_updated) as last_updated FROM slippage_cache WHERE calculation_timestamp = $1",
      [latestTimestamp]
    );
    const lastUpdated = lastUpdatedResult.rows[0]?.last_updated || null;

    console.log(
      `📊 Retrieved ${slippageData.length} slippage records from calculation: ${latestTimestamp}`
    );

    return { slippageData, lastUpdated, calculationTimestamp: latestTimestamp };
  } catch (error) {
    console.error("Error getting cached slippage data:", error);
    return { slippageData: [], lastUpdated: null, calculationTimestamp: null };
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
  latestCalculationTimestamp: string | null;
}> {
  try {
    // Get the latest calculation timestamp
    const latestTimestampResult = await query(
      "SELECT MAX(calculation_timestamp) as latest_timestamp FROM slippage_cache WHERE calculation_timestamp IS NOT NULL"
    );
    const latestCalculationTimestamp =
      latestTimestampResult.rows[0]?.latest_timestamp || null;

    if (!latestCalculationTimestamp) {
      return {
        totalPairs: 0,
        successfulPairs: 0,
        failedPairs: 0,
        lastUpdated: null,
        latestCalculationTimestamp: null,
      };
    }

    // Count total pairs for the latest calculation
    const totalResult = await query(
      "SELECT COUNT(*) as count FROM slippage_cache WHERE calculation_timestamp = $1",
      [latestCalculationTimestamp]
    );
    const totalPairs = parseInt(totalResult.rows[0].count);

    // Count successful pairs (those with at least one non-null amount) for the latest calculation
    const successfulResult = await query(
      `
      SELECT COUNT(*) as count FROM slippage_cache 
      WHERE calculation_timestamp = $1
      AND (amount_1000 IS NOT NULL 
      OR amount_10000 IS NOT NULL 
      OR amount_50000 IS NOT NULL 
      OR amount_100000 IS NOT NULL)
    `,
      [latestCalculationTimestamp]
    );
    const successfulPairs = parseInt(successfulResult.rows[0].count);

    // Get last updated timestamp for the latest calculation
    const lastUpdatedResult = await query(
      "SELECT MAX(last_updated) as last_updated FROM slippage_cache WHERE calculation_timestamp = $1",
      [latestCalculationTimestamp]
    );
    const lastUpdated = lastUpdatedResult.rows[0]?.last_updated || null;

    return {
      totalPairs,
      successfulPairs,
      failedPairs: totalPairs - successfulPairs,
      lastUpdated,
      latestCalculationTimestamp,
    };
  } catch (error) {
    console.error("Error getting slippage cache status:", error);
    return {
      totalPairs: 0,
      successfulPairs: 0,
      failedPairs: 0,
      lastUpdated: null,
      latestCalculationTimestamp: null,
    };
  }
}
