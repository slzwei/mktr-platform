import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:55432/mktr';
const SCHEMA = process.env.PG_SCHEMA || 'leadgen';

export const pool = new Pool({ connectionString: DATABASE_URL });

export async function withClient(fn) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    return await fn(client);
  } finally {
    client.release();
  }
}

export { SCHEMA };


