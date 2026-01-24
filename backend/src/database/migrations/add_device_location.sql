-- Migration: Add GPS location columns to devices table
-- Safe migration: all columns nullable, no data loss

ALTER TABLE devices ADD COLUMN IF NOT EXISTS latitude FLOAT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS longitude FLOAT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS "locationUpdatedAt" TIMESTAMP WITH TIME ZONE;
