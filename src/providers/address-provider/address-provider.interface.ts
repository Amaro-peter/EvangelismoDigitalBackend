export interface AddressData {
  logradouro?: string
  bairro?: string
  localidade: string
  uf: string
  lat?: number
  lon?: number
}

export interface AddressProvider {
  fetchAddress(cep: string, signal?: AbortSignal): Promise<AddressData>
}
