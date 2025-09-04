import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Database configuration:
// - If DB_HOST is set, use Postgres
// - Otherwise, fallback to SQLite (local dev quickstart)
const isPostgres = !!process.env.DB_HOST;
const shouldUseSSL = (() => {
  if (process.env.DB_SSL) {
    return String(process.env.DB_SSL).toLowerCase() !== 'false';
  }
  // Default to SSL in production environments (e.g., Render)
  return process.env.NODE_ENV === 'production';
})();
// Resolve absolute storage path for SQLite to avoid multiple DB files being created
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRootDir = path.resolve(__dirname, '../../');
const providedSqliteStorage = process.env.DATABASE_URL || 'fresh.db';
const resolvedSqliteStorage = path.isAbsolute(providedSqliteStorage)
  ? providedSqliteStorage
  : path.join(backendRootDir, providedSqliteStorage);

const config = isPostgres
  ? {
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
        freezeTableName: true
      },
      dialectOptions: shouldUseSSL
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: false
            }
          }
        : {},
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  : {
      dialect: 'sqlite',
      storage: resolvedSqliteStorage,
      logging: false,
      define: {
        timestamps: true,
        underscored: false,
        freezeTableName: true
      }
    };

// Create Sequelize instance
export const sequelize = new Sequelize(config);

// Log effective database configuration (non-sensitive)
try {
  const dialect = sequelize.getDialect();
  if (dialect === 'sqlite') {
    // @ts-ignore - storage present on sqlite config
    console.log(`🗄️ Using SQLite storage at: ${sequelize.options.storage}`);
  } else if (dialect === 'postgres') {
    console.log(`🗄️ Using Postgres database: ${process.env.DB_NAME} @ ${process.env.DB_HOST}:${process.env.DB_PORT || 5432}`);
  } else {
    console.log(`🗄️ Using database dialect: ${dialect}`);
  }
} catch (_) {}

// Test connection function
export async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection has been established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    return false;
  }
}

// Close connection function
export async function closeConnection() {
  try {
    await sequelize.close();
    console.log('✅ Database connection closed.');
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
  }
}
