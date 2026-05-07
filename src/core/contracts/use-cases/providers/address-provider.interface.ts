import { EnumGeoPrecision } from './geo-provider.interface'

export interface IAddressData {
  logradouro?: string
  bairro?: string
  localidade: string
  uf: string
  lat?: number
  lon?: number
  precision?: EnumGeoPrecision
  providerName?: string
}

export interface IAddressProvider {
  fetchAddress(cep: string, signal?: AbortSignal): Promise<IAddressData | null>
}
