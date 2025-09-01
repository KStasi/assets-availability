import express from "express";
import cors from "cors";
import { PairRoutes } from "@assets-availability/types";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Mock data
const mockRoutes: PairRoutes[] = [
  {
    pair: { from: "USDC", to: "ETH" },
    routes: [
      { aggregator: "Oku", dexes: ["UniswapV3"] },
      { aggregator: "LiFi", dexes: ["Curve", "UniswapV3"] },
    ],
  },
  {
    pair: { from: "ETH", to: "WBTC" },
    routes: [{ aggregator: "Jumper", dexes: ["Curve"] }],
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
    pair: { from: "ETH", to: "USDC" },
    routes: [
      { aggregator: "Oku", dexes: ["UniswapV3"] },
      { aggregator: "Jumper", dexes: ["Curve"] },
    ],
  },
];

app.get("/routes", (req, res) => {
  res.json(mockRoutes);
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
