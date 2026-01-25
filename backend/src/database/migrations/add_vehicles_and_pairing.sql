-- Migration: Create vehicles table and add device pairing columns
-- Date: 2026-01-25

-- Create vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carplate VARCHAR(255) NOT NULL UNIQUE,
    "masterDeviceId" UUID REFERENCES devices(id) ON DELETE SET NULL,
    "slaveDeviceId" UUID REFERENCES devices(id) ON DELETE SET NULL,
    "campaignIds" JSONB NOT NULL DEFAULT '[]',
    "hotspotSsid" VARCHAR(255),
    "hotspotPassword" VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for vehicles
CREATE INDEX IF NOT EXISTS idx_vehicles_master ON vehicles("masterDeviceId");
CREATE INDEX IF NOT EXISTS idx_vehicles_slave ON vehicles("slaveDeviceId");

-- Add device pairing columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'vehicleId') THEN
        ALTER TABLE devices ADD COLUMN "vehicleId" UUID REFERENCES vehicles(id) ON DELETE SET NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'devices' AND column_name = 'role') THEN
        -- Create enum type if not exists
        CREATE TYPE device_role AS ENUM ('master', 'slave');
        ALTER TABLE devices ADD COLUMN role device_role;
    END IF;
END $$;

-- Create index for device vehicle lookup
CREATE INDEX IF NOT EXISTS idx_devices_vehicle ON devices("vehicleId");
