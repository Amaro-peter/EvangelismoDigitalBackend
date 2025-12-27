import { prisma } from '@lib/prisma'
import { ChurchesRepository, NearbyChurch, FindNearbyParams, Church, ChurchAlreadyExists } from '../churches-repository'
import { Prisma } from '@prisma/client'

/**
 * FUTURE OPTIMIZATION: Table Partitioning for Geographic Regions
 *
 * As the 'churches' table grows (e.g., beyond 1M rows or 100GB), implement declarative partitioning
 * in PostgreSQL to improve query performance, especially for regional KNN searches. Partitioning
 * splits the table into smaller child tables based on a key (e.g., 'region'), allowing the query
 * planner to prune irrelevant partitions and speed up scans/index lookups.
 *
 * Note: Prisma doesn't natively support partitioning in its schema, so apply it via custom SQL
 * migrations (e.g., in a Prisma migration file or postgis_trigger_setup.sql). Prisma will query the
 * partitioned table transparently.
 *
 * Steps to Implement:
 * 1. Add a 'region' column to the Prisma schema and table:
 *    - In schema.prisma: Add `region String?` to the Church model.
 *    - Run `prisma migrate dev` to add the column.
 *    - Populate existing data: Use a raw query or script to set regions based on lat/lon or geog
 *      (e.g., via ST_Intersects with predefined region polygons).
 *
 * 2. Create a Trigger for Auto-Population:
 *    - In a migration SQL file, add a function and trigger to set 'region' on INSERT/UPDATE:
 *      ```
 *      CREATE OR REPLACE FUNCTION set_church_region() RETURNS TRIGGER AS $$
 *      BEGIN
 *        NEW.region := CASE  -- Customize based on your regions
 *          WHEN NEW.lat > 0 AND NEW.lon BETWEEN -180 AND 0 THEN 'Western Hemisphere North'
 *          -- Add more cases, or use ST_Intersects(geog, region_geom)
 *          ELSE 'Other'
 *        END;
 *        RETURN NEW;
 *      END;
 *      $$ LANGUAGE plpgsql;
 *
 *      CREATE TRIGGER trg_set_region BEFORE INSERT OR UPDATE ON churches
 *      FOR EACH ROW EXECUTE PROCEDURE set_church_region();
 *      ```
 *
 * 3. Apply Partitioning in a Migration:
 *    - Use list partitioning on 'region' (or range on lat/lon buckets for finer granularity).
 *    - Example SQL (run via `prisma db execute --file=partition.sql`):
 *      ```
 *      -- Backup and rename original table
 *      ALTER TABLE churches RENAME TO churches_old;
 *
 *      -- Create partitioned table (copy structure)
 *      CREATE TABLE churches (LIKE churches_old INCLUDING ALL) PARTITION BY LIST (region);
 *
 *      -- Create child partitions (add more as needed)
 *      CREATE TABLE churches_na PARTITION OF churches FOR VALUES IN ('NA');
 *      CREATE TABLE churches_eu PARTITION OF churches FOR VALUES IN ('EU');
 *      CREATE TABLE churches_default PARTITION OF churches DEFAULT;
 *
 *      -- Rebuild indexes on partitions if needed (e.g., GiST on geog per child)
 *      CREATE INDEX churches_na_geog_idx ON churches_na USING GIST (geog);
 *      -- Repeat for other partitions
 *
 *      -- Migrate data
 *      INSERT INTO churches SELECT * FROM churches_old;
 *      DROP TABLE churches_old;
 *      ```
 *
 * 4. Update Queries for Pruning:
 *    - In findNearest, infer or add a 'region' param and include `WHERE region = $X` to enable
 *      partition pruning. This combines with ST_DWithin for max efficiency.
 *
 * 5. Testing and Maintenance:
 *    - Test queries with EXPLAIN ANALYZE to confirm pruning.
 *    - Monitor with pg_partman extension for automated partition management.
 *    - If using read replicas, ensure replication handles partitions (logical replication preferred).
 *
 * Benefits: Faster queries, easier maintenance (e.g., vacuum per partition), better scalability.
 * Drawbacks: Slight insert overhead; plan for data movement if regions change.
 *
 * Implement when perf benchmarks show slowdowns in KNN queries.
 */

interface RawChurch {
  id: number
  publicId: string
  name: string
  address: string | null
  lat: number
  lon: number
  distanceMeters: number
}

export class PrismaChurchesRepository implements ChurchesRepository {
  async findNearest({ userLat, userLon, limit = 20 }: FindNearbyParams): Promise<NearbyChurch[]> {
    // For small datasets, we use a safety margin of 5x the requested limit
    // This ensures KNN approximations don't exclude actual nearest churches
    const knnCandidates = Math.max(100, limit * 5)

    const churches = await prisma.$queryRawUnsafe<RawChurch[]>(
      `
      WITH knn_candidates AS (
        -- Phase 1: Fast KNN pre-filtering using bounding box approximations
        SELECT id, geog
        FROM churches
        WHERE geog IS NOT NULL
        ORDER BY geog <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        LIMIT $4  -- Get more candidates than needed for accuracy
      )
      -- Phase 2: Exact distance calculation and sorting on the smaller candidate set
      SELECT 
        c.id,
        c.public_id as "publicId",
        c.name,
        c.address,
        c.lat,
        c.lon,
        ST_Distance(
          c.geog,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) as "distanceMeters"
      FROM knn_candidates knn
      JOIN churches c ON c.id = knn.id
      ORDER BY ST_Distance(
        c.geog,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) ASC
      LIMIT $3  -- Final accurate results
    `,
      userLat,
      userLon,
      limit,
      knnCandidates,
    )

    return churches.map((church: RawChurch) => ({
      ...church,
      distanceMeters: parseFloat(Number(church.distanceMeters).toFixed(15)),
      distanceKm: parseFloat((church.distanceMeters / 1000).toFixed(15)),
    }))
  }

  async findByParams(params: ChurchAlreadyExists): Promise<Church | null> {
    const results = await prisma.$queryRaw<Church[]>`
      SELECT
        id,
        public_id as "publicId",
        name,
        address,
        lat,
        lon,
        geog::text as geog,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM churches
      WHERE 
        lower(trim(name)) = lower(trim(${params.name}))
        OR
        (
          round(lat::numeric, 6) = round(${params.lat}::numeric, 6)
          AND
          round(lon::numeric, 6) = round(${params.lon}::numeric, 6)
        )
      LIMIT 1
    `
    return results[0] ?? null
  }

  async findByName(name: string): Promise<Church | null> {
    const results = await prisma.$queryRaw<Church[]>`
      SELECT
        id,
        public_id as "publicId",
        name,
        address,
        lat,
        lon,
        geog::text as geog,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM churches
      WHERE lower(trim(name)) = lower(trim(${name}))
      LIMIT 1
    `
    return results[0] ?? null
  }

  async createChurch(data: Prisma.ChurchCreateInput): Promise<Church> {
    try {
      const church: Church = await prisma.$queryRaw<Church>`
        INSERT INTO churches (public_id, name, address, lat, lon, created_at, updated_at)
        VALUES (
          gen_random_uuid()::text,
          ${data.name},
          ${data.address},
          ${data.lat},
          ${data.lon},
          NOW(),
          NOW()
          )
        RETURNING
          id,
          public_id AS "publicId",
          name,
          address,
          lat,
          lon,
          geog::text AS geog,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `
      return church
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new Error('church-already-exists')
      }
      throw error
    }
  }

  async deleteChurchByPublicId(publicId: string): Promise<Church | null> {
    const rows = await prisma.$queryRaw<Church[]>`
      DELETE FROM churches 
      WHERE public_id = ${publicId}
      RETURNING
        id,
        public_id AS "publicId",
        name,
        address,
        lat,
        lon,
        geog::text AS geog,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `
    return rows[0] ?? null
  }
}
