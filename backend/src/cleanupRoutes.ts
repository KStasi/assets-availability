import { query } from "./db";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

interface RouteStats {
  provider: string;
  count: number;
  lastUpdated: string | null;
}

class RouteCleanup {
  /**
   * Get statistics about routes in the database
   */
  async getRouteStats(): Promise<RouteStats[]> {
    try {
      const result = await query(`
        SELECT 
          provider,
          COUNT(*) as count,
          MAX(last_updated) as last_updated
        FROM routes_cache
        GROUP BY provider
        ORDER BY provider
      `);

      return result.rows.map((row: any) => ({
        provider: row.provider,
        count: parseInt(row.count),
        lastUpdated: row.last_updated,
      }));
    } catch (error) {
      console.error("Error fetching route statistics:", error);
      throw error;
    }
  }

  /**
   * Get count of Oku routes specifically
   */
  async getOkuRouteCount(): Promise<number> {
    try {
      const result = await query(`
        SELECT COUNT(*) as count
        FROM routes_cache
        WHERE provider = 'Oku'
      `);
      return parseInt(result.rows[0].count);
    } catch (error) {
      console.error("Error fetching Oku route count:", error);
      throw error;
    }
  }

  /**
   * Clean all Oku routes from the database
   */
  async cleanOkuRoutes(): Promise<number> {
    try {
      console.log("🧹 Starting Oku routes cleanup...");

      // Get count before deletion
      const countBefore = await this.getOkuRouteCount();
      console.log(`📊 Found ${countBefore} Oku routes to delete`);

      if (countBefore === 0) {
        console.log("✅ No Oku routes found in database. Nothing to clean.");
        return 0;
      }

      // Delete all Oku routes
      const result = await query(`
        DELETE FROM routes_cache
        WHERE provider = 'Oku'
      `);

      const deletedCount = result.rowCount || 0;
      console.log(`🗑️  Successfully deleted ${deletedCount} Oku routes`);

      return deletedCount;
    } catch (error) {
      console.error("Error cleaning Oku routes:", error);
      throw error;
    }
  }

  /**
   * Clean routes by provider
   */
  async cleanRoutesByProvider(provider: string): Promise<number> {
    try {
      console.log(`🧹 Starting ${provider} routes cleanup...`);

      // Get count before deletion
      const result = await query(
        `
        SELECT COUNT(*) as count
        FROM routes_cache
        WHERE provider = $1
      `,
        [provider]
      );

      const countBefore = parseInt(result.rows[0].count);
      console.log(`📊 Found ${countBefore} ${provider} routes to delete`);

      if (countBefore === 0) {
        console.log(
          `✅ No ${provider} routes found in database. Nothing to clean.`
        );
        return 0;
      }

      // Delete routes by provider
      const deleteResult = await query(
        `
        DELETE FROM routes_cache
        WHERE provider = $1
      `,
        [provider]
      );

      const deletedCount = deleteResult.rowCount || 0;
      console.log(
        `🗑️  Successfully deleted ${deletedCount} ${provider} routes`
      );

      return deletedCount;
    } catch (error) {
      console.error(`Error cleaning ${provider} routes:`, error);
      throw error;
    }
  }

  /**
   * Clean all routes from the database
   */
  async cleanAllRoutes(): Promise<number> {
    try {
      console.log("🧹 Starting complete routes cleanup...");

      // Get count before deletion
      const result = await query("SELECT COUNT(*) as count FROM routes_cache");
      const countBefore = parseInt(result.rows[0].count);
      console.log(`📊 Found ${countBefore} total routes to delete`);

      if (countBefore === 0) {
        console.log("✅ No routes found in database. Nothing to clean.");
        return 0;
      }

      // Delete all routes
      const deleteResult = await query("DELETE FROM routes_cache");
      const deletedCount = deleteResult.rowCount || 0;
      console.log(`🗑️  Successfully deleted ${deletedCount} routes`);

      return deletedCount;
    } catch (error) {
      console.error("Error cleaning all routes:", error);
      throw error;
    }
  }

  /**
   * Clean routes older than a specified date
   */
  async cleanOldRoutes(daysOld: number): Promise<number> {
    try {
      console.log(
        `🧹 Starting cleanup of routes older than ${daysOld} days...`
      );

      // Get count before deletion
      const result = await query(`
        SELECT COUNT(*) as count
        FROM routes_cache
        WHERE last_updated < NOW() - INTERVAL '${daysOld} days'
      `);

      const countBefore = parseInt(result.rows[0].count);
      console.log(`📊 Found ${countBefore} routes older than ${daysOld} days`);

      if (countBefore === 0) {
        console.log(
          `✅ No routes older than ${daysOld} days found. Nothing to clean.`
        );
        return 0;
      }

      // Delete old routes
      const deleteResult = await query(`
        DELETE FROM routes_cache
        WHERE last_updated < NOW() - INTERVAL '${daysOld} days'
      `);

      const deletedCount = deleteResult.rowCount || 0;
      console.log(`🗑️  Successfully deleted ${deletedCount} old routes`);

      return deletedCount;
    } catch (error) {
      console.error(`Error cleaning routes older than ${daysOld} days:`, error);
      throw error;
    }
  }

  /**
   * Display route statistics in a table format
   */
  displayRouteStats(stats: RouteStats[]): void {
    console.log("\n📊 Route Statistics");
    console.log("=".repeat(60));

    if (stats.length === 0) {
      console.log("No routes found in database.");
      return;
    }

    // Table header
    console.log("Provider".padEnd(15) + "Count".padEnd(10) + "Last Updated");
    console.log("-".repeat(60));

    // Table rows
    stats.forEach((stat) => {
      const lastUpdated = stat.lastUpdated
        ? new Date(stat.lastUpdated).toLocaleString()
        : "Never";

      console.log(
        stat.provider.padEnd(15) +
          stat.count.toString().padEnd(10) +
          lastUpdated
      );
    });

    const totalRoutes = stats.reduce((sum, stat) => sum + stat.count, 0);
    console.log("-".repeat(60));
    console.log(`Total routes: ${totalRoutes}`);
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<void> {
    try {
      const totalRoutes = await query(
        "SELECT COUNT(*) as count FROM routes_cache"
      );
      const uniqueProviders = await query(
        "SELECT COUNT(DISTINCT provider) as count FROM routes_cache"
      );
      const latestUpdate = await query(
        "SELECT MAX(last_updated) as latest FROM routes_cache"
      );
      const oldestRecord = await query(
        "SELECT MIN(last_updated) as oldest FROM routes_cache"
      );

      console.log("\n📊 Database Statistics");
      console.log("=".repeat(40));
      console.log(`Total routes: ${totalRoutes.rows[0].count}`);
      console.log(`Unique providers: ${uniqueProviders.rows[0].count}`);
      console.log(
        `Latest update: ${
          latestUpdate.rows[0].latest
            ? new Date(latestUpdate.rows[0].latest).toLocaleString()
            : "Never"
        }`
      );
      console.log(
        `Oldest record: ${
          oldestRecord.rows[0].oldest
            ? new Date(oldestRecord.rows[0].oldest).toLocaleString()
            : "Never"
        }`
      );
    } catch (error) {
      console.error("Error fetching database statistics:", error);
    }
  }
}

// CLI interface
async function main() {
  const cleanup = new RouteCleanup();
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "oku":
        const deletedOku = await cleanup.cleanOkuRoutes();
        console.log(
          `\n✅ Oku cleanup completed. Deleted ${deletedOku} routes.`
        );
        break;

      case "provider":
        if (args.length < 2) {
          console.log("Usage: npm run cleanup-routes provider <provider_name>");
          process.exit(1);
        }
        const deletedProvider = await cleanup.cleanRoutesByProvider(args[1]);
        console.log(
          `\n✅ ${args[1]} cleanup completed. Deleted ${deletedProvider} routes.`
        );
        break;

      case "all":
        const deletedAll = await cleanup.cleanAllRoutes();
        console.log(
          `\n✅ Complete cleanup completed. Deleted ${deletedAll} routes.`
        );
        break;

      case "old":
        if (args.length < 2) {
          console.log("Usage: npm run cleanup-routes old <days>");
          process.exit(1);
        }
        const days = parseInt(args[1]);
        if (isNaN(days) || days < 1) {
          console.log("Error: Days must be a positive number");
          process.exit(1);
        }
        const deletedOld = await cleanup.cleanOldRoutes(days);
        console.log(
          `\n✅ Old routes cleanup completed. Deleted ${deletedOld} routes.`
        );
        break;

      case "stats":
        const stats = await cleanup.getRouteStats();
        cleanup.displayRouteStats(stats);
        break;

      case "db-stats":
        await cleanup.getDatabaseStats();
        break;

      default:
        console.log("🧹 Route Cleanup Tool - Clean routes from the database");
        console.log("\nUsage: npm run cleanup-routes <command> [options]");
        console.log("\nCommands:");
        console.log("  oku                    - Clean all Oku routes");
        console.log("  provider <name>        - Clean routes by provider name");
        console.log(
          "  all                    - Clean all routes from database"
        );
        console.log(
          "  old <days>             - Clean routes older than specified days"
        );
        console.log(
          "  stats                  - Show route statistics by provider"
        );
        console.log(
          "  db-stats               - Show general database statistics"
        );
        console.log("\nExamples:");
        console.log("  npm run cleanup-routes oku");
        console.log("  npm run cleanup-routes provider LiFi");
        console.log("  npm run cleanup-routes old 7");
        console.log("  npm run cleanup-routes stats");
        console.log("  npm run cleanup-routes all");
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

export { RouteCleanup };
