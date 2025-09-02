import { Pool, PoolClient } from "pg";

let poolInstance: Pool | null = null;

export function getPool(): Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME || "assets_availability",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased to 10 seconds
    });
  }

  return poolInstance;
}

export async function db(): Promise<PoolClient> {
  const pool = getPool();
  return await pool.connect();
}

export async function query(text: string, params?: any[]): Promise<any> {
  const client = await db();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export async function queryWithRetry(
  text: string, 
  params?: any[], 
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await query(text, params);
    } catch (error) {
      console.log(`Database query attempt ${attempt}/${maxRetries} failed:`, error instanceof Error ? error.message : 'Unknown error');
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
}
