

export interface GeoCoordinates {
    lat: number,
    lon: number,
}

export interface GeoSearchOptions {
    street?: string,
    neighborhood?: string,
    city: string,
    state: string,
    country: string,
}

export interface GeocodingProvider {
    search(query: string): Promise<GeoCoordinates | null>
    searchStructured(options: GeoSearchOptions): Promise<GeoCoordinates | null>
}