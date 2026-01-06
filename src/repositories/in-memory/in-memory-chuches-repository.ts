import { Prisma } from '@prisma/client'
import {
  ChurchesRepository,
  Church,
  ChurchAlreadyExists,
  NearbyChurch,
  FindNearbyParams,
} from '@repositories/churches-repository'
import { randomUUID } from 'node:crypto'

export class InMemoryChurchesRepository implements ChurchesRepository {
  public items: Church[] = []

  async findNearest(params: FindNearbyParams): Promise<NearbyChurch[]> {
    const { userLat, userLon, limit = 10, maxRadiusMeters = 50000 } = params

    // Calculate distance using Haversine formula
    const churchesWithDistance = this.items.map((church) => {
      const R = 6371000 // Earth's radius in meters
      const φ1 = (userLat * Math.PI) / 180
      const φ2 = (church.lat * Math.PI) / 180
      const Δφ = ((church.lat - userLat) * Math.PI) / 180
      const Δλ = ((church.lon - userLon) * Math.PI) / 180

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

      const distanceMeters = R * c
      const distanceKm = distanceMeters / 1000

      return {
        id: church.id,
        name: church.name,
        address: church.address,
        lat: church.lat,
        lon: church.lon,
        distanceMeters,
        distanceKm,
      }
    })

    // Filter by max radius and sort by distance
    return churchesWithDistance
      .filter((church) => church.distanceMeters <= maxRadiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit)
  }

  async findByParams(params: ChurchAlreadyExists): Promise<Church | null> {
    const church = this.items.find(
      (item) => item.name === params.name && item.lat === params.lat && item.lon === params.lon,
    )

    return church ?? null
  }

  async findByName(name: string): Promise<Church | null> {
    const church = this.items.find((item) => item.name === name)

    return church ?? null
  }

  async createChurch(data: Prisma.ChurchCreateInput): Promise<Church | null> {
    const now = new Date()
    const church: Church = {
      id: this.items.length + 1,
      publicId: randomUUID(),
      name: data.name,
      address: data.address ?? null,
      lat: data.lat as number,
      lon: data.lon as number,
      geog: null,
      createdAt: now,
      updatedAt: now,
    }

    this.items.push(church)
    return church
  }

  async deleteChurchByPublicId(publicId: string): Promise<Church | null> {
    const churchIndex = this.items.findIndex((item) => item.publicId === publicId)

    if (churchIndex === -1) {
      return null
    }

    const [deletedChurch] = this.items.splice(churchIndex, 1)
    return deletedChurch
  }
}
