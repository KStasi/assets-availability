import sqlite3 from "sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

let dbInstance: sqlite3.Database | null = null;

export function db(): sqlite3.Database {
  if (!dbInstance) {
    // Ensure data directory exists
    const dataDir = join(__dirname, "..", "data");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = join(dataDir, "app.db");
    dbInstance = new sqlite3.Database(dbPath);
  }

  return dbInstance;
}
