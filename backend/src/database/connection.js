import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration:
// - If DB_HOST is set, use Postgres
// - Otherwise, fallback to SQLite (local dev quickstart)
const isPostgres = !!process.env.DB_HOST;
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
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  : {
      dialect: 'sqlite',
      storage: process.env.DATABASE_URL || 'fresh.db',
      logging: false,
      define: {
        timestamps: true,
        underscored: false,
        freezeTableName: true
      }
    };

// Create Sequelize instance
export const sequelize = new Sequelize(config);

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
