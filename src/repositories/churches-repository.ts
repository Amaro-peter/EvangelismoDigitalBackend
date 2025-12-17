import { Prisma } from "@prisma/client"

export interface NearbyChurch {
    id: number
    name: string
    address: string | null
    lat: number
    lon: number
    distanceKm: number
    distanceMeters: number
}

export interface FindNearbyParams {
  userLat: number
  userLon: number
  limit?: number
  maxRadiusMeters?: number
}

export interface Church {
  id: number
  publicId: string
  name: string
  address: string | null
  lat: number
  lon: number
  geog?: unknown | null
  createdAt: Date
  updatedAt: Date
}

export interface ChurchesRepository {
    findNearest(params: FindNearbyParams): Promise<NearbyChurch[]>
    createChurch(data: Prisma.ChurchCreateInput): Promise<Church>
}

