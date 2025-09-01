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
