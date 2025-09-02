import { queryWithRetry } from "./db";

export async function runMigrations(): Promise<void> {
  try {
    // Create tokens table
    await queryWithRetry(`
      CREATE TABLE IF NOT EXISTS tokens (
        symbol   VARCHAR(50) PRIMARY KEY,
        address  VARCHAR(100) NOT NULL,
        decimals INTEGER NOT NULL
      );
    `);

    // Create routes_cache table
    await queryWithRetry(`
      CREATE TABLE IF NOT EXISTS routes_cache (
        id SERIAL PRIMARY KEY,
        pair_from VARCHAR(100) NOT NULL,
        pair_to VARCHAR(100) NOT NULL,
        routes_data TEXT NOT NULL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create slippage_cache table
    await queryWithRetry(`
      CREATE TABLE IF NOT EXISTS slippage_cache (
        id SERIAL PRIMARY KEY,
        pair_from VARCHAR(100) NOT NULL,
        pair_to VARCHAR(100) NOT NULL,
        amount_1000 REAL,
        amount_10000 REAL,
        amount_50000 REAL,
        amount_100000 REAL,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await queryWithRetry(`
      CREATE INDEX IF NOT EXISTS idx_routes_pair ON routes_cache(pair_from, pair_to);
    `);

    await queryWithRetry(`
      CREATE INDEX IF NOT EXISTS idx_slippage_pair ON slippage_cache(pair_from, pair_to);
    `);

    // Add calculation_timestamp column to slippage_cache if it doesn't exist
    await queryWithRetry(`
      ALTER TABLE slippage_cache 
      ADD COLUMN IF NOT EXISTS calculation_timestamp TIMESTAMP WITH TIME ZONE;
    `);

    // Create index on calculation_timestamp for efficient latest data queries
    await queryWithRetry(`
      CREATE INDEX IF NOT EXISTS idx_slippage_calculation_timestamp ON slippage_cache(calculation_timestamp);
    `);

    console.log("Migrations completed successfully");
  } catch (err) {
    console.error("Migration error:", err);
    throw err;
  }
}
