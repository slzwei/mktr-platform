import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration - Use SQLite for testing
const config = {
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
