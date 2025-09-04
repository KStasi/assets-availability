import axios from "axios";
import { query, PRICES_TABLE } from "./db";
import { SlippageData, PairRoutes } from "./types";

// Interface for token price data
interface TokenPrice {
  token: string;
  price: number;
  timestamp: string;
}

const ETHERLINK_CHAIN_ID = "42793";
const OKU_BASE_URL =
  "https://accounts.v2.icarus.tools/connect/gfxcafe.oku.account.v1.SimpleSwapService";

// Test amounts in USD
const TEST_AMOUNTS = [1000, 10000, 50000, 100000];

// Track API usage
let requestCount = 0;
const MAX_REQUESTS_PER_HOUR = 500; // Conservative limit for OKU API

// Oku API types
interface OkuCreateRequest {
  chain: string;
  isExactIn: boolean;
  tokenAmount: string;
  slippage: number;
}

interface OkuCreateResponse {
  orderId: string;
}

interface OkuUpdateQuoteParamsRequest {
  orderId: string;
  chain: string;
  enabledMarkets: string[];
  isExactIn: boolean;
  inTokenAddress: string;
  outTokenAddress: string;
  tokenAmount: string;
  gasPrice: string;
  slippage: number;
}

interface OkuUpdateQuoteParamsResponse {
  generation: string;
  orderId: string;
}

interface OkuGetQuotesRequest {
  orderId: string;
  fetchedRouters: string[];
  waitTime: string;
}

interface OkuQuote {
  inAmount: string;
  outAmount: string;
  simulationError?: any;
  candidateTrade: {
    chainId: string;
    value: string;
    to: string;
    data: string;
  };
}

interface OkuRouterQuote {
  router: string;
  fetched: boolean;
  quoteId: string;
  quote?: OkuQuote;
  error?: {
    message: string;
  };
}

interface OkuGetQuotesResponse {
  quotes: {
    [router: string]: OkuRouterQuote;
  };
}

// Function to get latest token prices from price table
async function getLatestTokenPrices(): Promise<Map<string, number>> {
  try {
    // Get the latest price for each token by finding the maximum timestamp
    const result = await query(`
      SELECT DISTINCT ON (token) 
        token, 
        price, 
        timestamp
      FROM ${PRICES_TABLE} 
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

    // Use XTZ price + 3.1% for stXTZ if stXTZ price not present
    const xtzPrice = priceMap.get("xtz");
    const stxtzPrice = priceMap.get("stxtz");
    if (xtzPrice && !stxtzPrice) {
      const stxtzCalculatedPrice = xtzPrice * 1.031; // XTZ + 3.1%
      priceMap.set("stxtz", stxtzCalculatedPrice);
      console.log(
        `🔄 Using XTZ price + 3.1% for stXTZ: $${xtzPrice} * 1.031 = $${stxtzCalculatedPrice.toFixed(
          6
        )}`
      );
    }

    console.log(`Retrieved latest prices for ${priceMap.size} tokens`);
    return priceMap;
  } catch (error) {
    console.error("Error fetching latest token prices:", error);
    return new Map();
  }
}

// Helper function to create a new Oku order for slippage calculation
async function createOkuOrderForSlippage(tokenAmount: string): Promise<string> {
  console.log("🆕 Creating new Oku order for slippage calculation...");
  const createRequest: OkuCreateRequest = {
    chain: ETHERLINK_CHAIN_ID,
    isExactIn: true,
    tokenAmount: tokenAmount,
    slippage: 1, // 1% slippage
  };

  const createResponse = await axios.post<OkuCreateResponse>(
    `${OKU_BASE_URL}/Create`,
    createRequest,
    {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );

  const orderId = createResponse.data.orderId;
  console.log(`✅ Created Oku order with ID: ${orderId}`);
  return orderId;
}

export async function fetchAndCacheOkuSlippageData(): Promise<void> {
  console.log("Starting OKU slippage data fetch...");

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

    // First, get existing OKU routes from the routes cache to know which pairs have routes
    const existingRoutesResult = await query(
      "SELECT routes_data FROM routes_cache WHERE provider = 'Oku' ORDER BY pair_from, pair_to"
    );
    const existingRoutes = existingRoutesResult.rows.map((row: any) =>
      JSON.parse(row.routes_data)
    );

    console.log(
      `Found ${existingRoutes.length} existing OKU routes, checking for slippage...`
    );

    // Use all available connections from OKU routes cache instead of hardcoded pairs
    const tokenPairs: { from: any; to: any }[] = [];

    // Extract unique pairs from existing OKU routes
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

    // If no OKU routes found, fall back to some basic pairs
    if (tokenPairs.length === 0) {
      console.log("No OKU routes found in cache, using fallback pairs...");
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

    console.log(
      `Processing ${tokenPairs.length} token pairs for OKU slippage...`
    );

    // Clear existing OKU slippage cache
    await query("DELETE FROM slippage_cache WHERE provider = 'Oku'");

    let successCount = 0;
    let errorCount = 0;
    let currentOrderId: string | null = null;
    let pairsProcessedWithCurrentOrder = 0;
    const ORDER_REFRESH_INTERVAL = 50; // Create new order every 50 pairs

    // Process each pair with strict rate limiting
    for (let i = 0; i < tokenPairs.length; i++) {
      const { from, to } = tokenPairs[i];

      // Check if we've hit our rate limit
      if (requestCount >= MAX_REQUESTS_PER_HOUR) {
        console.log(
          `Rate limit reached (${requestCount} requests). Stopping OKU slippage fetch.`
        );
        break;
      }

      // Add delay between pairs to avoid rate limiting
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay between pairs
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
            await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay between amounts
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
            // Then limit precision to match token decimals
            const tokenAmount = amountUSD / tokenPrice;
            const tokenAmountWithPrecision = parseFloat(
              tokenAmount.toFixed(from.decimals)
            );

            console.log(
              `💰 ${from.symbol}: $${amountUSD} / $${tokenPrice} = ${tokenAmountWithPrecision} tokens (${from.decimals} decimals)`
            );

            requestCount++;
            console.log(
              `Making OKU request ${requestCount}/${MAX_REQUESTS_PER_HOUR} for ${from.symbol}→${to.symbol} at $${amountUSD}`
            );

            // Create new order if needed (every 50 pairs or first iteration)
            if (
              currentOrderId === null ||
              pairsProcessedWithCurrentOrder >= ORDER_REFRESH_INTERVAL
            ) {
              if (currentOrderId !== null) {
                console.log(
                  `🔄 Refreshing order after ${pairsProcessedWithCurrentOrder} pairs...`
                );
              }
              currentOrderId = await createOkuOrderForSlippage(
                tokenAmountWithPrecision.toString()
              );
              pairsProcessedWithCurrentOrder = 0;
            }

            // Step 1: Update quote parameters with retry logic
            const updateRequest: OkuUpdateQuoteParamsRequest = {
              orderId: currentOrderId,
              chain: ETHERLINK_CHAIN_ID,
              enabledMarkets: ["threeroute", "usor"],
              isExactIn: true,
              inTokenAddress: from.address,
              outTokenAddress: to.address,
              tokenAmount: tokenAmountWithPrecision.toString(),
              gasPrice: "1000000000", // 1 gwei
              slippage: 1,
            };

            console.log(
              `  📤 Updating quote params for ${from.symbol}→${to.symbol} with ${tokenAmountWithPrecision} tokens...`
            );
            let updateParamsRetryCount = 0;
            const updateParamsMaxRetries = 3;

            while (updateParamsRetryCount < updateParamsMaxRetries) {
              try {
                await axios.post<OkuUpdateQuoteParamsResponse>(
                  `${OKU_BASE_URL}/UpdateQuoteParams`,
                  updateRequest,
                  {
                    headers: {
                      "Content-Type": "application/json",
                    },
                    timeout: 10000,
                  }
                );
                break; // Success, exit retry loop
              } catch (error: any) {
                // Check if error is "order already completed or canceled"
                if (
                  error.response?.status === 500 &&
                  error.response?.data?.message?.includes(
                    "order already completed or canceled"
                  )
                ) {
                  console.log(
                    `  🔄 Order ${currentOrderId} already completed/canceled, creating new order...`
                  );
                  // Create new order and update currentOrderId
                  currentOrderId = await createOkuOrderForSlippage(
                    tokenAmountWithPrecision.toString()
                  );
                  pairsProcessedWithCurrentOrder = 0;
                  // Update the orderId in the request
                  updateRequest.orderId = currentOrderId;
                  // Reset retry count since we have a new order
                  updateParamsRetryCount = 0;
                  continue;
                }

                updateParamsRetryCount++;
                if (updateParamsRetryCount < updateParamsMaxRetries) {
                  console.log(
                    `  🔄 Retry ${updateParamsRetryCount}/${updateParamsMaxRetries} updating quote params for ${from.symbol}→${to.symbol} (waiting 5s)...`
                  );
                  console.log(error);
                  await new Promise((resolve) => setTimeout(resolve, 5000));
                } else {
                  console.log(
                    `  ❌ Max retries reached updating quote params for ${from.symbol}→${to.symbol}`
                  );
                  throw error; // Re-throw after max retries
                }
              }
            }

            // Step 2: Get quotes with retry logic
            const quotesRequest: OkuGetQuotesRequest = {
              orderId: currentOrderId,
              fetchedRouters: ["threeroute", "usor"],
              waitTime: "5000", // 5 seconds wait time
            };

            console.log(
              `  📥 Fetching quotes for ${from.symbol}→${to.symbol}... Id: ${quotesRequest.orderId}`
            );

            let quotesResponse: any = null;
            let retryCount = 0;
            const maxRetries = 5;

            while (retryCount < maxRetries) {
              try {
                quotesResponse = await axios.post<OkuGetQuotesResponse>(
                  `${OKU_BASE_URL}/GetNewQuotes`,
                  quotesRequest,
                  {
                    headers: {
                      "Content-Type": "application/json",
                    },
                    timeout: 15000,
                  }
                );

                // Check if any quotes were fetched successfully
                const quotes = quotesResponse.data.quotes;
                const hasFetchedQuotes =
                  Object.values(quotes).filter((quote: any) => quote.fetched)
                    .length === 2;

                if (hasFetchedQuotes) {
                  break; // Success, exit retry loop
                } else {
                  // No quotes were fetched, retry
                  retryCount++;
                  if (retryCount < maxRetries) {
                    console.log(
                      `  🔄 Retry ${retryCount}/${maxRetries} for ${from.symbol}→${to.symbol} - no quotes fetched (waiting 2s)...`
                    );
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                  } else {
                    console.log(
                      `  ❌ Max retries reached for ${from.symbol}→${to.symbol} - no quotes fetched`
                    );
                    break; // Exit retry loop after max retries
                  }
                }
              } catch (error: any) {
                // Check if error is "order already completed or canceled"
                if (
                  error.response?.status === 500 &&
                  error.response?.data?.message?.includes(
                    "order already completed or canceled"
                  )
                ) {
                  console.log(
                    `  🔄 Order ${currentOrderId} already completed/canceled during quotes fetch, creating new order...`
                  );
                  // Create new order and update currentOrderId
                  currentOrderId = await createOkuOrderForSlippage(
                    tokenAmountWithPrecision.toString()
                  );
                  pairsProcessedWithCurrentOrder = 0;
                  // Update the orderId in the request
                  quotesRequest.orderId = currentOrderId;
                  // Reset retry count since we have a new order
                  retryCount = 0;
                  continue;
                }

                retryCount++;
                if (retryCount < maxRetries) {
                  console.log(
                    `  🔄 Retry ${retryCount}/${maxRetries} for ${from.symbol}→${to.symbol} (waiting 1s)...`
                  );
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                } else {
                  throw error; // Re-throw error after all retries failed
                }
              }
            }

            // Process quotes to find the best one
            const quotes = quotesResponse.data.quotes;
            let bestQuote: OkuQuote | null = null;
            let bestRouter = "";

            Object.keys(quotes).forEach((router) => {
              const quote = quotes[router];
              if (
                quote.fetched &&
                quote.quote &&
                !quote.quote.simulationError
              ) {
                if (!bestQuote) {
                  bestQuote = quote.quote;
                  bestRouter = router;
                }
              }
            });

            if (
              bestQuote &&
              (bestQuote as OkuQuote).inAmount &&
              (bestQuote as OkuQuote).outAmount
            ) {
              // Calculate slippage
              const inAmountNum = parseFloat((bestQuote as OkuQuote).inAmount);
              const outAmountNum = parseFloat(
                (bestQuote as OkuQuote).outAmount
              );

              // Get output token price to convert to USD
              const outTokenPrice = tokenPrices.get(to.symbol.toLowerCase());
              if (outTokenPrice) {
                const inAmountUSD = inAmountNum * tokenPrice;
                const outAmountUSD = outAmountNum * outTokenPrice;

                // Calculate slippage as percentage
                const slippage =
                  ((inAmountUSD - outAmountUSD) / inAmountUSD) * 100;
                slippageAmounts[amountUSD.toString()] =
                  Math.round(slippage * 1000) / 1000; // Round to 3 decimal places

                console.log(
                  `✅ ${from.symbol}→${
                    to.symbol
                  } at $${amountUSD}: ${slippage.toFixed(
                    3
                  )}% slippage via ${bestRouter}`
                );
              } else {
                console.log(
                  `⚠️  No price found for output token ${to.symbol}, cannot calculate slippage`
                );
                slippageAmounts[amountUSD.toString()] = null;
              }
            } else {
              console.log(
                `❌ No valid quotes found for ${from.symbol}→${to.symbol} at $${amountUSD}`
              );
              slippageAmounts[amountUSD.toString()] = null;
            }

            // Increment counter for current order
            pairsProcessedWithCurrentOrder++;
          } catch (amountError) {
            console.error(
              `Error fetching OKU quote for ${from.symbol}→${to.symbol} at $${amountUSD}:`,
              amountError instanceof Error
                ? amountError.message
                : "Unknown error"
            );
            slippageAmounts[amountUSD.toString()] = null;
          }
        }

        // Store slippage data in database
        await query(
          `INSERT INTO slippage_cache 
           (pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000, calculation_timestamp, provider) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            from.symbol,
            to.symbol,
            slippageAmounts["1000"],
            slippageAmounts["10000"],
            slippageAmounts["50000"],
            slippageAmounts["100000"],
            calculationTimestamp,
            "Oku",
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
            `✓ OKU ${from.symbol}→${to.symbol}: Successful amounts: ${successfulAmounts}`
          );
          if (failedAmounts) {
            console.log(`  Failed amounts: ${failedAmounts}`);
          }
          successCount++;
        } else {
          console.log(`✗ OKU ${from.symbol}→${to.symbol}: All amounts failed`);
          errorCount++;
        }
      } catch (error) {
        console.error(
          `Error processing OKU slippage for ${from.symbol}→${to.symbol}:`,
          error instanceof Error ? error.message : "Unknown error"
        );
        errorCount++;
      }
    }

    // Get final summary of all amounts
    const allAmountsResult = await query(
      "SELECT amount_1000, amount_10000, amount_50000, amount_100000 FROM slippage_cache WHERE provider = 'Oku'"
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
      `OKU slippage data fetch completed. Pairs: Success: ${successCount}, Errors: ${errorCount}`
    );
    console.log(
      `Amounts: Total: ${totalAmounts}, Successful: ${successfulAmounts}, Failed: ${failedAmounts}`
    );
  } catch (error) {
    console.error("Error in fetchAndCacheOkuSlippageData:", error);
  }
}

export async function getCachedOkuSlippageData(): Promise<{
  slippageData: SlippageData[];
  lastUpdated: string | null;
  calculationTimestamp: string | null;
}> {
  try {
    // Get the latest calculation timestamp for OKU
    const latestTimestampResult = await query(
      "SELECT MAX(calculation_timestamp) as latest_timestamp FROM slippage_cache WHERE calculation_timestamp IS NOT NULL AND provider = 'Oku'"
    );
    const latestTimestamp =
      latestTimestampResult.rows[0]?.latest_timestamp || null;

    if (!latestTimestamp) {
      console.log("No OKU slippage data with calculation timestamp found");
      return {
        slippageData: [],
        lastUpdated: null,
        calculationTimestamp: null,
      };
    }

    // Get all cached OKU slippage data for the latest calculation timestamp
    const rowsResult = await query(
      `SELECT pair_from, pair_to, amount_1000, amount_10000, amount_50000, amount_100000, calculation_timestamp 
       FROM slippage_cache 
       WHERE calculation_timestamp = $1 AND provider = 'Oku'
       ORDER BY pair_from, pair_to`,
      [latestTimestamp]
    );
    const rows = rowsResult.rows;

    const slippageData: SlippageData[] = rows.map((row: any) => ({
      pair: { from: row.pair_from, to: row.pair_to },
      provider: "OKU",
      amounts: {
        "1000": row.amount_1000,
        "10000": row.amount_10000,
        "50000": row.amount_50000,
        "100000": row.amount_100000,
      },
    }));

    // Get the most recent update timestamp for backward compatibility
    const lastUpdatedResult = await query(
      "SELECT MAX(last_updated) as last_updated FROM slippage_cache WHERE calculation_timestamp = $1 AND provider = 'Oku'",
      [latestTimestamp]
    );
    const lastUpdated = lastUpdatedResult.rows[0]?.last_updated || null;

    console.log(
      `📊 Retrieved ${slippageData.length} OKU slippage records from calculation: ${latestTimestamp}`
    );

    return { slippageData, lastUpdated, calculationTimestamp: latestTimestamp };
  } catch (error) {
    console.error("Error getting cached OKU slippage data:", error);
    return { slippageData: [], lastUpdated: null, calculationTimestamp: null };
  }
}

// Function to manually trigger OKU slippage calculation
export async function manualOkuSlippageCalculation(): Promise<void> {
  console.log("Manual OKU slippage calculation triggered...");

  // Reset request count for manual runs
  requestCount = 0;

  try {
    await fetchAndCacheOkuSlippageData();
    console.log("Manual OKU slippage calculation completed successfully");
  } catch (error) {
    console.error("Manual OKU slippage calculation failed:", error);
    throw error; // Re-throw to allow proper error handling by the caller
  }
}

// Function to get current OKU slippage cache status
export async function getOkuSlippageCacheStatus(): Promise<{
  totalPairs: number;
  successfulPairs: number;
  failedPairs: number;
  lastUpdated: string | null;
  latestCalculationTimestamp: string | null;
}> {
  try {
    // Get the latest calculation timestamp for OKU
    const latestTimestampResult = await query(
      "SELECT MAX(calculation_timestamp) as latest_timestamp FROM slippage_cache WHERE calculation_timestamp IS NOT NULL AND provider = 'Oku'"
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
      "SELECT COUNT(*) as count FROM slippage_cache WHERE calculation_timestamp = $1 AND provider = 'Oku'",
      [latestCalculationTimestamp]
    );
    const totalPairs = parseInt(totalResult.rows[0].count);

    // Count successful pairs (those with at least one non-null amount) for the latest calculation
    const successfulResult = await query(
      `
      SELECT COUNT(*) as count FROM slippage_cache 
      WHERE calculation_timestamp = $1 AND provider = 'Oku'
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
      "SELECT MAX(last_updated) as last_updated FROM slippage_cache WHERE calculation_timestamp = $1 AND provider = 'Oku'",
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
    console.error("Error getting OKU slippage cache status:", error);
    return {
      totalPairs: 0,
      successfulPairs: 0,
      failedPairs: 0,
      lastUpdated: null,
      latestCalculationTimestamp: null,
    };
  }
}
