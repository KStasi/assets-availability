import { query } from "./db";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

interface PriceData {
  token: string;
  price: number;
  timestamp: string;
}

const priceData: PriceData[] = [
  { token: "mbasis", price: 1.11, timestamp: "2025-05-29 12:43:44.657 +0100" },
  { token: "mtbill", price: 1.026, timestamp: "2025-05-29 12:43:44.657 +0100" },
  { token: "usdt", price: 1, timestamp: "2025-05-29 12:43:44.657 +0100" },
  {
    token: "usdc",
    price: 0.999807,
    timestamp: "2025-05-29 12:43:44.657 +0100",
  },
  { token: "wbtc", price: 108336, timestamp: "2025-05-29 12:43:44.657 +0100" },
  { token: "weth", price: 2727.58, timestamp: "2025-05-29 12:43:44.657 +0100" },
  {
    token: "wxtz",
    price: 0.638088,
    timestamp: "2025-05-29 12:43:44.657 +0100",
  },
  { token: "xtz", price: 0.638749, timestamp: "2025-05-29 12:43:44.657 +0100" },
  { token: "eutbl", price: 1.17, timestamp: "2025-05-29 12:43:44.657 +0100" },
  { token: "ustbl", price: 1.045, timestamp: "2025-05-29 12:43:44.657 +0100" },
  {
    token: "xu3o8",
    price: 4.4946187249,
    timestamp: "2025-05-29 12:43:44.657 +0100",
  },
];

async function createPriceTable() {
  try {
    console.log("Creating price table...");

    // Drop table if it exists (for clean recreation)
    await query("DROP TABLE IF EXISTS price");

    // Create the price table
    const createTableQuery = `
      CREATE TABLE price (
        id SERIAL PRIMARY KEY,
        token VARCHAR(20) NOT NULL,
        price DECIMAL(18, 10) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await query(createTableQuery);
    console.log("✅ Price table created successfully");

    // Insert the price data
    console.log("Inserting price data...");

    for (const data of priceData) {
      const insertQuery = `
        INSERT INTO price (token, price, timestamp)
        VALUES ($1, $2, $3)
      `;

      await query(insertQuery, [data.token, data.price, data.timestamp]);
      console.log(`✅ Inserted: ${data.token} - ${data.price}`);
    }

    console.log(
      "🎉 Price table creation and data insertion completed successfully!"
    );
    console.log(`📊 Total records inserted: ${priceData.length}`);

    // Verify the data
    const verifyQuery = "SELECT COUNT(*) as count FROM price";
    const result = await query(verifyQuery);
    console.log(
      `🔍 Verification: ${result.rows[0].count} records in price table`
    );
  } catch (error) {
    console.error("❌ Error creating price table:", error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  createPriceTable()
    .then(() => {
      console.log("Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { createPriceTable };
