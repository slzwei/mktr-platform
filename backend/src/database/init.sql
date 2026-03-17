-- Database initialization script
-- This script runs when the PostgreSQL container starts for the first time

-- Create test database for backend tests (safe to fail if it already exists)
SELECT 'CREATE DATABASE mktr_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mktr_test')\gexec

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create indexes for better performance (Sequelize will create tables)
-- These are additional indexes that might be helpful

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Note: Sequelize will handle table creation and basic indexes
-- This file is mainly for PostgreSQL-specific setup
