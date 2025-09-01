import express from "express";
import cors from "cors";
import { runMigrations } from "./migrations";
import { upsertTokens } from "./tokens";
import { PairRoutes } from "./types";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Run migrations and upsert tokens on startup
runMigrations();
upsertTokens();

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

// Get routes (in-memory mock data)
app.get("/routes", (req, res) => {
  // Example placeholder routes
  const mockRoutes: PairRoutes[] = [
    {
      pair: { from: "USDC", to: "WETH" },
      routes: [
        { aggregator: "Oku", dexes: ["UniswapV3"] },
        { aggregator: "LiFi", dexes: ["Curve", "UniswapV3"] },
        { aggregator: "Jumper", dexes: ["Curve"] },
      ],
    },
    {
      pair: { from: "WETH", to: "WBTC" },
      routes: [
        { aggregator: "Oku", dexes: ["UniswapV3"] },
        { aggregator: "LiFi", dexes: ["Curve"] },
      ],
    },
    {
      pair: { from: "USDC", to: "WBTC" },
      routes: [
        { aggregator: "Oku", dexes: ["UniswapV3", "SushiSwap"] },
        { aggregator: "LiFi", dexes: ["Curve", "UniswapV3"] },
        { aggregator: "Jumper", dexes: ["Curve", "Balancer"] },
      ],
    },
    {
      pair: { from: "WETH", to: "USDC" },
      routes: [
        { aggregator: "Oku", dexes: ["UniswapV3"] },
        { aggregator: "Jumper", dexes: ["Curve"] },
      ],
    },
  ];

  res.json(mockRoutes);
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
