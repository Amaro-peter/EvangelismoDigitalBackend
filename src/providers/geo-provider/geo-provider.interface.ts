export enum GeoPrecision {
  ROOFTOP = 'ROOFTOP',
  NEIGHBORHOOD = 'NEIGHBORHOOD',
  CITY = 'CITY',
  NO_CERTAINTY = 'NO_CERTAINTY',
}

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

export enum GeoCacheScope {
  SEARCH = 'search',
  SEARCH_STRUCTURED = 'searchStructured',
}

export interface GeocodingProvider {
  search(query: string, signal?: AbortSignal): Promise<GeoCoordinates | null>
  searchStructured(options: GeoSearchOptions, signal?: AbortSignal): Promise<GeoCoordinates | null>
}
