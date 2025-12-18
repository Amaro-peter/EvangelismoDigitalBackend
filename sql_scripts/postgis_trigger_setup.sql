-- Enable PostGIS (safe & idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add geog column if it doesn't exist (assuming it's created via Prisma schema)
-- Note: Prisma schema defines geog as Unsupported("geography(Point, 4326)")?, so ensure it's added in migration

-- Create or replace trigger function to calculate geog on insert/update
CREATE OR REPLACE FUNCTION update_church_geog() RETURNS TRIGGER AS $$
BEGIN
    NEW.geog := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326)::geography;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-calculate geog for seed inserts and individual church inserts
DROP TRIGGER IF EXISTS trg_update_church_geog ON churches;
CREATE TRIGGER trg_update_church_geog BEFORE INSERT OR UPDATE ON churches
FOR EACH ROW EXECUTE PROCEDURE update_church_geog();

-- Spatial index (created once, reused forever)
CREATE INDEX IF NOT EXISTS churches_geog_gist_idx
ON churches
USING GIST (geog);

-- Optional documentation
COMMENT ON COLUMN churches.geog
IS 'Auto-calculated geography point derived from lat/lon via trigger';