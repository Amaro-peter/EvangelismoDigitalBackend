-- PostGIS Extension Setup for Churches Table
-- This script is idempotent and safe to run multiple times

-- 1. Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Verify churches table exists before proceeding
DO $$
BEGIN
    -- Check if churches table exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_name = 'churches'
    ) THEN
        RAISE NOTICE 'Churches table does not exist yet. Skipping column addition.';
    ELSE
        -- Add geography column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'churches' AND column_name = 'geog'
        ) THEN
            ALTER TABLE "churches"
            ADD COLUMN geog GEOGRAPHY(Point, 4326)
            GENERATED ALWAYS AS (
                ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
            ) STORED;
            
            RAISE NOTICE 'Added geog column to churches table';
        ELSE
            RAISE NOTICE 'Column geog already exists in churches table';
        END IF;
    END IF;
END $$;

-- 3. Create spatial index for efficient KNN queries
CREATE INDEX IF NOT EXISTS "churches_geog_idx"
ON "churches"
USING GIST (geog);

-- 4. Add comment
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'churches' AND column_name = 'geog'
    ) THEN
        COMMENT ON COLUMN "churches".geog IS 'Auto-generated geography point from lon/lat for spatial queries';
    END IF;
END $$;

-- 5. Verify PostGIS setup
DO $$
BEGIN
    RAISE NOTICE 'PostGIS version: %', PostGIS_Version();
    RAISE NOTICE 'PostGIS setup completed successfully';
END $$;
