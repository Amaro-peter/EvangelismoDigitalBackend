import { Church, NearbyChurch } from '@repositories/churches-repository'

type HTTPChurch = {
  publicId: string
  name: string
  address: string
  lat: number
  lon: number
  geog: unknown | null
  createdAt: Date
  updatedAt: Date
}

type HTTPNearbyChurch = {
  publicId: string
  name: string
  address: string | null
  lat: number
  lon: number
  distanceKm: number
  distanceMeters: number
}

export class ChurchPresenter {
  static toHTTP(church: Church): HTTPChurch
  static toHTTP(churches: Church[]): HTTPChurch[]
  static toHTTP(church: NearbyChurch): HTTPNearbyChurch
  static toHTTP(churches: NearbyChurch[]): HTTPNearbyChurch[]
  static toHTTP(
    input: Church | Church[] | NearbyChurch | NearbyChurch[],
  ): HTTPChurch | HTTPChurch[] | HTTPNearbyChurch | HTTPNearbyChurch[] {
    if (Array.isArray(input)) {
      return input.map((c) => {
        if ('distanceKm' in c && 'distanceMeters' in c) {
          return this.toHTTP(c as NearbyChurch)
        }
        return this.toHTTP(c as Church)
      }) as HTTPChurch[] | HTTPNearbyChurch[]
    }

    if ('distanceKm' in input && 'distanceMeters' in input) {
      return {
        publicId: input.publicId,
        name: input.name,
        address: input.address,
        lat: input.lat,
        lon: input.lon,
        distanceKm: input.distanceKm,
        distanceMeters: input.distanceMeters,
      }
    }

    return {
      publicId: input.publicId,
      name: input.name,
      address: input.address,
      lat: input.lat,
      lon: input.lon,
      geog: input.geog,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    }
  }
}
