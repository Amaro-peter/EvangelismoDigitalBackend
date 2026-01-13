export type GeoPrecision = 'ROOFTOP' | 'NEIGHBORHOOD' | 'CITY'

export interface GeoCoordinates {
  lat: number
  lon: number
  precision: GeoPrecision
}

export interface GeoSearchOptions {
  street?: string
  neighborhood?: string
  city: string
  state: string
  country: string
}

export interface GeocodingProvider {
  search(query: string): Promise<GeoCoordinates | null>
  searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null>
}
