import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// Create connection pool
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('Database connected');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

/**
 * Execute a query with parameters
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      console.log(`Slow query (${duration}ms): ${text.substring(0, 50)}...`);
    }
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}

/**
 * Check if database is connected
 */
export async function isConnected(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Close all connections (for graceful shutdown)
 */
export async function close(): Promise<void> {
  await pool.end();
  console.log('Database connections closed');
}

export default pool;
