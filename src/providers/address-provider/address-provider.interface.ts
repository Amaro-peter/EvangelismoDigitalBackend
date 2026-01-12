
export interface AddressData {
    logradouro?: string;
    bairro?: string;
    localidade: string;
    uf: string;
}

export interface AddressProvider {
    fetchAddress(cep: string): Promise<AddressData>
}