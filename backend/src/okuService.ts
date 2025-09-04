import axios from "axios";
import { query, PRICES_TABLE } from "./db";
import { PairRoutes } from "./types";

const ETHERLINK_CHAIN_ID = "42793";
const OKU_BASE_URL =
  "https://accounts.v2.icarus.tools/connect/gfxcafe.oku.account.v1.SimpleSwapService";

// Interface for token price data
interface TokenPrice {
  token: string;
  price: number;
  timestamp: string;
}

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
  quote: OkuQuote;
}

interface OkuGetQuotesResponse {
  quotes: {
    [router: string]: OkuRouterQuote;
  };
}

interface OkuPingRequest {
  orderId: string;
}

interface OkuPingResponse {
  orderId: string;
  lastUpdated: string;
  stage: string;
  status: string;
}

// Helper function to create a new Oku order
async function createOkuOrder(): Promise<string> {
  console.log("🆕 Creating new Oku order...");
  const createRequest: OkuCreateRequest = {
    chain: ETHERLINK_CHAIN_ID,
    isExactIn: true,
    tokenAmount: "1", // Use 1 as base amount for route checking
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

export async function fetchAndCacheOkuData(): Promise<void> {
  console.log("🚀 Starting Oku data fetch...");

  try {
    // Get all tokens from database
    const tokensResult = await query(
      "SELECT symbol, address, decimals FROM tokens ORDER BY symbol"
    );
    const tokens = tokensResult.rows;
    console.log(`📋 Found ${tokens.length} tokens in database`);

    // Get latest token prices from price table
    const tokenPrices = await getLatestTokenPrices();

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

    console.log(`�� Processing ${tokenPairs.length} token pairs for Oku...`);

    // Step 1: Create a single order that we'll reuse
    console.log("�� Creating initial Oku order...");

    const results: PairRoutes[] = [];
    let successCount = 0;
    let errorCount = 0;
    let currentOrderId: string | null = null;
    let pairsProcessedWithCurrentOrder = 0;
    const ORDER_REFRESH_INTERVAL = 50; // Create new order every 50 pairs

    // Process each pair, creating new orders as needed
    for (let i = 0; i < tokenPairs.length; i++) {
      const { from, to } = tokenPairs[i];

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
        currentOrderId = await createOkuOrder();
        pairsProcessedWithCurrentOrder = 0;
      }

      try {
        console.log(
          `🔍 [${i + 1}/${tokenPairs.length}] Checking ${from.symbol}→${
            to.symbol
          }...`
        );

        // Get token price from price table
        const tokenPrice = tokenPrices.get(from.symbol.toLowerCase());

        if (!tokenPrice) {
          console.log(
            `⚠️  No price found for token ${from.symbol}, skipping...`
          );
          continue;
        }

        // Convert $100 to token amount using actual token price
        // $100 / tokenPrice = number of tokens needed
        // Limit precision to match token decimals to avoid excessive decimal places
        const tokenAmount = 100 / tokenPrice;
        const tokenAmountWithPrecision = parseFloat(
          tokenAmount.toFixed(from.decimals)
        );

        console.log(
          `💰 ${from.symbol}: $100 / $${tokenPrice} = ${tokenAmountWithPrecision} tokens (${from.decimals} decimals)`
        );

        // Step 2: Update quote parameters for this pair
        const updateRequest: OkuUpdateQuoteParamsRequest = {
          orderId: currentOrderId,
          chain: ETHERLINK_CHAIN_ID,
          enabledMarkets: ["threeroute", "usor"], // Available routers
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
              currentOrderId = await createOkuOrder();
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
        // Step 3: Get quotes with retry logic
        const quotesRequest: OkuGetQuotesRequest = {
          orderId: currentOrderId,
          fetchedRouters: ["threeroute", "usor"],
          waitTime: "3000", // 3 seconds wait time (reduced for faster processing)
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
                timeout: 12000,
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
              currentOrderId = await createOkuOrder();
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
                `  �� Retry ${retryCount}/${maxRetries} for ${from.symbol}→${to.symbol} (waiting 1s)...`
              );
              await new Promise((resolve) => setTimeout(resolve, 1000));
            } else {
              throw error; // Re-throw error after all retries failed
            }
          }
        }

        // Process quotes with improved error handling
        const quotes = quotesResponse.data.quotes;
        const supportedDexes: string[] = [];
        const simulationFailedDexes: string[] = [];

        Object.keys(quotes).forEach((router) => {
          const quote = quotes[router];

          // Check if router was fetched successfully
          if (!quote.fetched) {
            console.log(quote);
            console.log(`  ❌ ${router}: Not fetched`);
            return;
          }

          // Check for high-level errors (like 400, 500 errors)
          if (quote.error) {
            console.log(
              `  ❌ ${router}: High-level error - ${quote.error.message}`
            );
            return; // Don't include in supported dexes
          }

          // Check if quote exists
          if (!quote.quote) {
            console.log(`  ❌ ${router}: No quote available`);
            return;
          }

          // Check for simulation errors
          if (quote.quote.simulationError) {
            console.log(`  ⚠️  ${router}: Simulation failed`);
            simulationFailedDexes.push(router);
          } else {
            console.log(`  ✅ ${router}: Fully supported`);
            supportedDexes.push(router);
          }
        });

        // Combine supported and simulation-failed dexes
        const allDexes = [
          ...supportedDexes,
          ...simulationFailedDexes.map((dex) => `${dex}✗`), // Add X mark for simulation failures
        ];

        if (allDexes.length > 0) {
          console.log(
            `  📊 Results: ${supportedDexes.length} fully supported, ${simulationFailedDexes.length} simulation failed`
          );
          console.log(`  🎯 DEXes: ${allDexes.join(", ")}`);

          const pairRoute: PairRoutes = {
            pair: { from: from.symbol, to: to.symbol },
            routes: [{ aggregator: "Oku", dexes: allDexes }],
          };

          results.push(pairRoute);

          // Store in database (update existing or insert new)
          await query(
            `
            INSERT INTO routes_cache (pair_from, pair_to, routes_data, provider)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (pair_from, pair_to, provider) 
            DO UPDATE SET 
              routes_data = EXCLUDED.routes_data,
              last_updated = CURRENT_TIMESTAMP
          `,
            [from.symbol, to.symbol, JSON.stringify(pairRoute), "Oku"]
          );

          successCount++;
        } else {
          console.log(
            `  ❌ No supported routes found for ${from.symbol}→${to.symbol}`
          );
        }

        // Increment counter for current order
        pairsProcessedWithCurrentOrder++;

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(
          `  �� Error fetching Oku data for ${from.symbol}→${to.symbol}:`,
          error instanceof Error ? error.message : "Unknown error"
        );
        errorCount++;
        // Skip this pair and continue with others
      }
    }

    console.log(
      `🎉 Oku data fetch completed! Success: ${successCount}, Errors: ${errorCount}, Total routes cached: ${results.length}`
    );
  } catch (error) {
    console.error("💥 Error in fetchAndCacheOkuData:", error);
  }
}

export async function getCachedOkuRoutes(): Promise<{
  routes: PairRoutes[];
  lastUpdated: string | null;
}> {
  try {
    // Get all cached Oku routes
    const routesResult = await query(
      "SELECT routes_data FROM routes_cache WHERE provider = 'Oku' ORDER BY pair_from, pair_to"
    );
    const routes = routesResult.rows.map((row: any) =>
      JSON.parse(row.routes_data)
    );

    // Get the most recent update timestamp for Oku routes
    const lastUpdatedResult = await query(
      "SELECT MAX(last_updated) as last_updated FROM routes_cache WHERE provider = 'Oku'"
    );
    const lastUpdated = lastUpdatedResult.rows[0]?.last_updated || null;

    return { routes, lastUpdated };
  } catch (error) {
    console.error("Error getting cached Oku routes:", error);
    return { routes: [], lastUpdated: null };
  }
}
