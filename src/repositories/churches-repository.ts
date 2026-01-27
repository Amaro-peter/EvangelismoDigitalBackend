export interface ChurchAlreadyExists {
  name: string
  lat: number
  lon: number
}

export interface NearbyChurch {
  id: number
  publicId: string
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
  address: string
  lat: number
  lon: number
  geog?: unknown | null
  createdAt: Date
  updatedAt: Date
}

export interface ChurchesRepository {
  findNearest(params: FindNearbyParams): Promise<NearbyChurch[]>
  findByParams(params: ChurchAlreadyExists): Promise<Church | null>
  findByName(name: string): Promise<Church | null>
  createChurch(data: Omit<Church, 'id' | 'publicId' | 'createdAt' | 'updatedAt' | 'geog'>): Promise<Church | null>
  deleteChurchByPublicId(publicId: string): Promise<Church | null>
}
