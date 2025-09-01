import { db } from "./db";

export function runMigrations(): void {
  const database = db();

  // Create tokens table
  database.exec(
    `
    CREATE TABLE IF NOT EXISTS tokens (
      symbol   TEXT PRIMARY KEY,
      address  TEXT NOT NULL,
      decimals INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS routes_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair_from TEXT NOT NULL,
      pair_to TEXT NOT NULL,
      routes_data TEXT NOT NULL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS slippage_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair_from TEXT NOT NULL,
      pair_to TEXT NOT NULL,
      amount_1000 REAL,
      amount_10000 REAL,
      amount_50000 REAL,
      amount_100000 REAL,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_routes_pair ON routes_cache(pair_from, pair_to);
    CREATE INDEX IF NOT EXISTS idx_slippage_pair ON slippage_cache(pair_from, pair_to);
  `,
    (err: Error | null) => {
      if (err) {
        console.error("Migration error:", err);
      } else {
        console.log("Migrations completed successfully");
      }
    }
  );
}
