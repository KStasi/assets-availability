import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { runMigrations } from "./migrations";
import { upsertTokens } from "./tokens";
import { fetchAndCacheLiFiData, getCachedRoutes } from "./lifiService";
import {
  fetchAndCacheSlippageData,
  getCachedSlippageData,
  manualSlippageCalculation,
  getSlippageCacheStatus,
} from "./slippageService";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Etherlink chain ID constant
const ETHERLINK_CHAIN_ID = 42793;

app.use(cors());
app.use(express.json());

// Run migrations and upsert tokens on startup
(async () => {
  try {
    await runMigrations();
    await upsertTokens();
  } catch (error) {
    console.error("Failed to run migrations:", error);
    process.exit(1);
  }
})();

// Initial data fetch - routes first, then slippage (controlled by env vars)
(async () => {
  const FETCH_ROUTES_ON_STARTUP =
    process.env.FETCH_ROUTES_ON_STARTUP === "true";
  const FETCH_SLIPPAGE_ON_STARTUP =
    process.env.FETCH_SLIPPAGE_ON_STARTUP === "true";

  if (FETCH_ROUTES_ON_STARTUP) {
    console.log("Running initial routes fetch...");
    await fetchAndCacheLiFiData();
  } else {
    console.log(
      "Skipping initial routes fetch (FETCH_ROUTES_ON_STARTUP=false)"
    );
  }

  if (FETCH_SLIPPAGE_ON_STARTUP) {
    console.log("Running initial slippage fetch...");
    await fetchAndCacheSlippageData();
  } else {
    console.log(
      "Skipping initial slippage fetch (FETCH_SLIPPAGE_ON_STARTUP=false)"
    );
  }
})();

// Schedule cron job to fetch LiFi data once per day at 00:00 UTC
cron.schedule("0 0 * * *", async () => {
  console.log("Running daily LiFi data fetch...");
  await fetchAndCacheLiFiData();
});

// Run slippage fetch only once per day to avoid rate limits
cron.schedule("0 0 * * *", () => {
  console.log("Running daily slippage data fetch...");
  fetchAndCacheSlippageData();
});

console.log("Daily cron jobs scheduled:");
console.log("- Routes fetch: Daily at 00:00 UTC");
console.log("- Slippage fetch: Daily at 00:00 UTC");
console.log(
  `Startup behavior: Routes=${process.env.FETCH_ROUTES_ON_STARTUP}, Slippage=${process.env.FETCH_SLIPPAGE_ON_STARTUP}`
);

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

// Get all tokens
app.get("/tokens", async (req, res) => {
  try {
    const { query } = require("./db");
    const result = await query(
      "SELECT symbol, address, decimals FROM tokens ORDER BY symbol"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching tokens:", err);
    res.status(500).json({ error: "Failed to fetch tokens" });
  }
});

// Get routes from cached database
app.get("/routes", async (req, res) => {
  try {
    const { routes, lastUpdated } = await getCachedRoutes();

    res.json({
      routes,
      lastUpdated,
      count: routes.length,
    });
  } catch (error) {
    console.error("Error in /routes endpoint:", error);
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

// Get slippage data from cached database
app.get("/slippage", async (req, res) => {
  try {
    const { slippageData, lastUpdated } = await getCachedSlippageData();

    res.json({
      slippageData,
      lastUpdated,
      count: slippageData.length,
    });
  } catch (error) {
    console.error("Error in /slippage endpoint:", error);
    res.status(500).json({ error: "Failed to fetch slippage data" });
  }
});

// Manual trigger for slippage calculation
app.post("/slippage/calculate", async (req, res) => {
  try {
    console.log("Manual slippage calculation triggered via API");
    await manualSlippageCalculation();
    res.json({ message: "Slippage calculation completed" });
  } catch (error) {
    console.error("Error in manual slippage calculation:", error);
    res.status(500).json({ error: "Failed to trigger slippage calculation" });
  }
});

// Manual trigger for routes fetching
app.post("/routes/fetch", async (req, res) => {
  try {
    console.log("Manual routes fetch triggered via API");
    await fetchAndCacheLiFiData();
    res.json({ message: "Routes fetch completed" });
  } catch (error) {
    console.error("Error in manual routes fetch:", error);
    res.status(500).json({ error: "Failed to trigger routes fetch" });
  }
});

// Get slippage cache status
app.get("/slippage/status", async (req, res) => {
  try {
    const status = await getSlippageCacheStatus();
    res.json(status);
  } catch (error) {
    console.error("Error getting slippage status:", error);
    res.status(500).json({ error: "Failed to get slippage status" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
