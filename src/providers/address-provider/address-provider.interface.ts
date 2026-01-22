import { GeoPrecision } from 'providers/geo-provider/geo-provider.interface'

export interface AddressData {
  logradouro?: string
  bairro?: string
  localidade: string
  uf: string
  lat?: number
  lon?: number
  precision?: GeoPrecision
  providerName?: string
}

export interface AddressProvider {
  fetchAddress(cep: string, signal?: AbortSignal): Promise<AddressData | null>
}
