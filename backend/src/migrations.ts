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
    
    CREATE INDEX IF NOT EXISTS idx_routes_pair ON routes_cache(pair_from, pair_to);
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
