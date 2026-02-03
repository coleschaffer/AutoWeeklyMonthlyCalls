import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// Only create pool if DATABASE_URL is configured
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL not configured');
    }

    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    pool.on('connect', () => {
      console.log('Database connected');
    });

    pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });
  }

  return pool;
}

/**
 * Check if database is configured
 */
export function isDatabaseConfigured(): boolean {
  return !!env.DATABASE_URL;
}

/**
 * Execute a query with parameters
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  if (!isDatabaseConfigured()) {
    throw new Error('Database not configured');
  }

  const start = Date.now();
  try {
    const result = await getPool().query<T>(text, params);
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
  return getPool().connect();
}

/**
 * Check if database is connected
 */
export async function isConnected(): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    return false;
  }

  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Close all connections (for graceful shutdown)
 */
export async function close(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connections closed');
  }
}
