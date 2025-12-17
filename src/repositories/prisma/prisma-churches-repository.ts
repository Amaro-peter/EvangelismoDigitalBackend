import { prisma } from '@lib/prisma'
import { ChurchesRepository, NearbyChurch, FindNearbyParams, Church } from '../churches-repository'
import { Prisma } from '@prisma/client'

export class PrismaChurchesRepository implements ChurchesRepository {
  async findNearest({ userLat, userLon, limit = 20 }: FindNearbyParams): Promise<NearbyChurch[]> {
    // Usando o operador KNN <-> do PostGIS para busca eficiente
    // ST_Distance retorna a distância em metros
    const churches = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT 
        id,
        public_id as "publicId",
        name,
        address,
        lat,
        lon,
        ROUND(
          ST_Distance(
            geog,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          )::numeric
        ) as "distanceMeters"
      FROM churches
      WHERE geog IS NOT NULL
      ORDER BY geog <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      LIMIT $3
    `,
      userLat,
      userLon,
      limit,
    )

    return churches.map((church: any) => ({
      ...church,
      distanceMeters: Number(church.distanceMeters),
      distanceKm: Number((church.distanceMeters / 1000).toFixed(2)),
    }))
  }

  async createChurch(data: Prisma.ChurchCreateInput): Promise<Church> {
    const church = await prisma.church.create({
      data,
    })
    
    return church
  }
}
