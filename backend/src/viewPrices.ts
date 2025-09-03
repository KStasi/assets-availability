import { query } from "./db";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

interface PriceRecord {
  id: number;
  token: string;
  price: number;
  timestamp: string;
  created_at: string;
}

interface PriceSummary {
  token: string;
  latest_price: number;
  latest_timestamp: string;
  total_records: number;
  price_range: {
    min: number;
    max: number;
  };
}

class PriceViewer {
  /**
   * Get all price records from the database
   */
  async getAllPrices(): Promise<PriceRecord[]> {
    try {
      const result = await query(`
        SELECT id, token, price, timestamp, created_at
        FROM price
        ORDER BY token, timestamp DESC
      `);
      return result.rows;
    } catch (error) {
      console.error("Error fetching all prices:", error);
      throw error;
    }
  }

  /**
   * Get latest price for each token
   */
  async getLatestPrices(): Promise<PriceRecord[]> {
    try {
      const result = await query(`
        SELECT DISTINCT ON (token) 
          id, token, price, timestamp, created_at
        FROM price
        ORDER BY token, timestamp DESC
      `);
      return result.rows;
    } catch (error) {
      console.error("Error fetching latest prices:", error);
      throw error;
    }
  }

  /**
   * Get price history for a specific token
   */
  async getTokenPriceHistory(token: string): Promise<PriceRecord[]> {
    try {
      const result = await query(
        `
        SELECT id, token, price, timestamp, created_at
        FROM price
        WHERE token = $1
        ORDER BY timestamp DESC
      `,
        [token.toLowerCase()]
      );
      return result.rows;
    } catch (error) {
      console.error(`Error fetching price history for ${token}:`, error);
      throw error;
    }
  }

  /**
   * Get price summary statistics for each token
   */
  async getPriceSummary(): Promise<PriceSummary[]> {
    try {
      const result = await query(`
        SELECT 
          token,
          price as latest_price,
          timestamp as latest_timestamp,
          COUNT(*) as total_records,
          MIN(price) as min_price,
          MAX(price) as max_price
        FROM price
        WHERE timestamp = (
          SELECT MAX(timestamp) 
          FROM price p2 
          WHERE p2.token = price.token
        )
        GROUP BY token, price, timestamp
        ORDER BY token
      `);

      return result.rows.map((row: any) => ({
        token: row.token,
        latest_price: parseFloat(row.latest_price),
        latest_timestamp: row.latest_timestamp,
        total_records: parseInt(row.total_records),
        price_range: {
          min: parseFloat(row.min_price),
          max: parseFloat(row.max_price),
        },
      }));
    } catch (error) {
      console.error("Error fetching price summary:", error);
      throw error;
    }
  }

  /**
   * Search for tokens by name (case-insensitive)
   */
  async searchTokens(searchTerm: string): Promise<PriceRecord[]> {
    try {
      const result = await query(
        `
        SELECT DISTINCT ON (token) 
          id, token, price, timestamp, created_at
        FROM price
        WHERE token ILIKE $1
        ORDER BY token, timestamp DESC
      `,
        [`%${searchTerm}%`]
      );
      return result.rows;
    } catch (error) {
      console.error(
        `Error searching for tokens with term "${searchTerm}":`,
        error
      );
      throw error;
    }
  }

  /**
   * Get tokens with prices above a certain threshold
   */
  async getTokensAbovePrice(threshold: number): Promise<PriceRecord[]> {
    try {
      const result = await query(
        `
        SELECT DISTINCT ON (token) 
          id, token, price, timestamp, created_at
        FROM price
        WHERE price >= $1
        ORDER BY token, timestamp DESC
      `,
        [threshold]
      );
      return result.rows;
    } catch (error) {
      console.error(`Error fetching tokens above price ${threshold}:`, error);
      throw error;
    }
  }

  /**
   * Format price for display
   */
  formatPrice(price: number | string): string {
    const numPrice = typeof price === "string" ? parseFloat(price) : price;

    if (numPrice >= 1000) {
      return `$${numPrice.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    } else if (numPrice >= 1) {
      return `$${numPrice.toFixed(4)}`;
    } else {
      return `$${numPrice.toFixed(8)}`;
    }
  }

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  /**
   * Display prices in a table format
   */
  displayPricesTable(prices: PriceRecord[], title: string = "Prices"): void {
    console.log(`\n📊 ${title}`);
    console.log("=".repeat(80));

    if (prices.length === 0) {
      console.log("No prices found.");
      return;
    }

    // Table header
    console.log(
      "Token".padEnd(12) + "Price".padEnd(20) + "Timestamp".padEnd(25) + "ID"
    );
    console.log("-".repeat(80));

    // Table rows
    prices.forEach((price) => {
      console.log(
        price.token.padEnd(12) +
          this.formatPrice(price.price).padEnd(20) +
          this.formatTimestamp(price.timestamp).padEnd(25) +
          price.id.toString()
      );
    });

    console.log(`\nTotal: ${prices.length} records`);
  }

  /**
   * Display price summary in a compact format
   */
  displayPriceSummary(summaries: PriceSummary[]): void {
    console.log("\n📈 Price Summary");
    console.log("=".repeat(100));

    if (summaries.length === 0) {
      console.log("No price data found.");
      return;
    }

    // Table header
    console.log(
      "Token".padEnd(12) +
        "Latest Price".padEnd(20) +
        "Records".padEnd(10) +
        "Price Range".padEnd(30) +
        "Last Updated"
    );
    console.log("-".repeat(100));

    // Table rows
    summaries.forEach((summary) => {
      const priceRange = `${this.formatPrice(
        summary.price_range.min
      )} - ${this.formatPrice(summary.price_range.max)}`;
      console.log(
        summary.token.padEnd(12) +
          this.formatPrice(summary.latest_price).padEnd(20) +
          summary.total_records.toString().padEnd(10) +
          priceRange.padEnd(30) +
          this.formatTimestamp(summary.latest_timestamp)
      );
    });

    console.log(`\nTotal tokens: ${summaries.length}`);
  }

  /**
   * Display prices in JSON format
   */
  displayPricesJSON(prices: PriceRecord[]): void {
    console.log(JSON.stringify(prices, null, 2));
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<void> {
    try {
      const totalRecords = await query("SELECT COUNT(*) as count FROM price");
      const uniqueTokens = await query(
        "SELECT COUNT(DISTINCT token) as count FROM price"
      );
      const latestUpdate = await query(
        "SELECT MAX(timestamp) as latest FROM price"
      );
      const oldestRecord = await query(
        "SELECT MIN(timestamp) as oldest FROM price"
      );

      console.log("\n📊 Database Statistics");
      console.log("=".repeat(40));
      console.log(`Total price records: ${totalRecords.rows[0].count}`);
      console.log(`Unique tokens: ${uniqueTokens.rows[0].count}`);
      console.log(
        `Latest update: ${this.formatTimestamp(latestUpdate.rows[0].latest)}`
      );
      console.log(
        `Oldest record: ${this.formatTimestamp(oldestRecord.rows[0].oldest)}`
      );
    } catch (error) {
      console.error("Error fetching database statistics:", error);
    }
  }
}

// CLI interface
async function main() {
  const viewer = new PriceViewer();
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "all":
        const allPrices = await viewer.getAllPrices();
        viewer.displayPricesTable(allPrices, "All Price Records");
        break;

      case "latest":
        const latestPrices = await viewer.getLatestPrices();
        viewer.displayPricesTable(latestPrices, "Latest Prices");
        break;

      case "summary":
        const summary = await viewer.getPriceSummary();
        viewer.displayPriceSummary(summary);
        break;

      case "token":
        if (args.length < 2) {
          console.log("Usage: npm run view-prices token <token_symbol>");
          process.exit(1);
        }
        const tokenHistory = await viewer.getTokenPriceHistory(args[1]);
        viewer.displayPricesTable(
          tokenHistory,
          `Price History for ${args[1].toUpperCase()}`
        );
        break;

      case "search":
        if (args.length < 2) {
          console.log("Usage: npm run view-prices search <search_term>");
          process.exit(1);
        }
        const searchResults = await viewer.searchTokens(args[1]);
        viewer.displayPricesTable(
          searchResults,
          `Search Results for "${args[1]}"`
        );
        break;

      case "above":
        if (args.length < 2) {
          console.log("Usage: npm run view-prices above <price_threshold>");
          process.exit(1);
        }
        const threshold = parseFloat(args[1]);
        if (isNaN(threshold)) {
          console.log("Error: Price threshold must be a number");
          process.exit(1);
        }
        const aboveThreshold = await viewer.getTokensAbovePrice(threshold);
        viewer.displayPricesTable(aboveThreshold, `Tokens Above $${threshold}`);
        break;

      case "json":
        const jsonPrices = await viewer.getLatestPrices();
        viewer.displayPricesJSON(jsonPrices);
        break;

      case "stats":
        await viewer.getDatabaseStats();
        break;

      default:
        console.log("🔍 Price Viewer - View token prices from the database");
        console.log("\nUsage: npm run view-prices <command> [options]");
        console.log("\nCommands:");
        console.log("  all                    - Show all price records");
        console.log(
          "  latest                 - Show latest price for each token"
        );
        console.log(
          "  summary                - Show price summary with statistics"
        );
        console.log(
          "  token <symbol>         - Show price history for a specific token"
        );
        console.log("  search <term>          - Search for tokens by name");
        console.log(
          "  above <price>          - Show tokens with price above threshold"
        );
        console.log(
          "  json                   - Output latest prices in JSON format"
        );
        console.log("  stats                  - Show database statistics");
        console.log("\nExamples:");
        console.log("  npm run view-prices latest");
        console.log("  npm run view-prices token wbtc");
        console.log("  npm run view-prices search usd");
        console.log("  npm run view-prices above 1000");
        console.log("  npm run view-prices summary");
        break;
    }
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { PriceViewer };
