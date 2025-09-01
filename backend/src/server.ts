import express from "express";
import cors from "cors";
import cron from "node-cron";
import { runMigrations } from "./migrations";
import { upsertTokens } from "./tokens";
import { fetchAndCacheLiFiData, getCachedRoutes } from "./lifiService";

const app = express();
const PORT = process.env.PORT || 3001;

// Etherlink chain ID constant
const ETHERLINK_CHAIN_ID = 42793;

app.use(cors());
app.use(express.json());

// Run migrations and upsert tokens on startup
runMigrations();
upsertTokens();

// Initial data fetch
fetchAndCacheLiFiData();

// Schedule cron job to fetch LiFi data every 5 minutes
cron.schedule("*/5 * * * *", () => {
  console.log("Running scheduled LiFi data fetch...");
  fetchAndCacheLiFiData();
});

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

// Get all tokens
app.get("/tokens", (req, res) => {
  const { db } = require("./db");
  const database = db();

  database.all(
    "SELECT symbol, address, decimals FROM tokens ORDER BY symbol",
    (err: Error | null, rows: any[]) => {
      if (err) {
        console.error("Error fetching tokens:", err);
        res.status(500).json({ error: "Failed to fetch tokens" });
      } else {
        res.json(rows);
      }
    }
  );
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

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
