import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

/**
 * A managed provider hands you ONE connection string. Accepting `DATABASE_URL`
 * (Render's "Internal Database URL") means a new deployment is wired by pasting
 * a single value instead of transcribing four, which is one place fewer for a
 * sandbox to end up pointed at the wrong database by a typo. The discrete
 * DB_* variables still win when they are set, so production is unchanged.
 */
function fromDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      sslmode: url.searchParams.get('sslmode'),
    };
  } catch {
    throw new Error('DATABASE_URL is set but is not a valid postgres:// URL.');
  }
}

const urlConfig = fromDatabaseUrl();

if (!process.env.DB_HOST && !urlConfig) {
  throw new Error('DB_HOST (or DATABASE_URL) is required. Run "docker compose up -d" for local PostgreSQL.');
}

const shouldUseSSL = (() => {
  if (process.env.DB_SSL) {
    return String(process.env.DB_SSL).toLowerCase() !== 'false';
  }
  // Default to SSL in production environments (e.g., Render)
  return process.env.NODE_ENV === 'production';
})();

const config = {
  dialect: 'postgres',
  host: process.env.DB_HOST || urlConfig?.host,
  port: Number(process.env.DB_PORT || urlConfig?.port || 5432),
  database: process.env.DB_NAME || urlConfig?.database,
  username: process.env.DB_USER || urlConfig?.username,
  password: process.env.DB_PASSWORD ?? urlConfig?.password,
  logging: false,
  define: {
    timestamps: true,
    underscored: false,
    freezeTableName: true,
  },
  dialectOptions: shouldUseSSL
    ? {
        ssl: {
          require: true,
          // rejectUnauthorized: false allows self-signed certs from managed DB providers
          // (e.g., Render, DigitalOcean). To use proper CA verification, set DB_CA_CERT
          // env var to the PEM-encoded CA certificate string.
          rejectUnauthorized: false,
          ...(process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT } : {}),
        },
      }
    : {},
  pool: {
    max: 10,
    // min 2 keeps a warm pair of connections open at all times. With min:0
    // the first incoming request after an idle period had to wait ~25s
    // to acquire a connection (observed under pg_net push load), causing
    // queued requests to hit the 30s acquire timeout. Render starter plan
    // tolerates 2 always-open connections without issue.
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
};

// Create Sequelize instance
export const sequelize = new Sequelize(/** @type {import('sequelize').Options} */ (config));

// Test connection function
export async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('Database connection has been established successfully.');
    return true;
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    return false;
  }
}

// Close connection function
export async function closeConnection() {
  try {
    await sequelize.close();
    console.log('Database connection closed.');
  } catch (error) {
    console.error('Error closing database connection:', error);
  }
}
