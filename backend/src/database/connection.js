import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DB_HOST) {
  throw new Error('DB_HOST is required. Run "docker compose up -d" for local PostgreSQL.');
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
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
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
export const sequelize = new Sequelize(config);

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
