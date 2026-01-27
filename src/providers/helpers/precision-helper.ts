import { AddressData } from "providers/address-provider/address-provider.interface"
import { GeoPrecision } from "providers/geo-provider/geo-provider.interface"

// Tipagem flexível para aceitar dados brutos do Nominatim/LocationIQ
interface OsmRawData {
  place_rank?: string | number
  type?: string
  class?: string // 'class' pode vir da API, apesar de ser reservado no JS
  addresstype?: string
}

export class PrecisionHelper {
  /**
   * Estratégia para provedores baseados em OpenStreetMap (Nominatim, LocationIQ)
   */
  static fromOsm(data: OsmRawData): GeoPrecision {
    const rank = Number(data.place_rank) || 0
    const type = data.type || ''
    const category = data.class || '' // 'class' geralmente mapeia categoria

    // 1. Alta Precisão (ROOFTOP)
    // Rank 30 = Endereço exato com número
    // Rank 26-29 = Rua/Estrada
    if (rank >= 26) return GeoPrecision.ROOFTOP

    if (
      ['house', 'building', 'residential', 'apartments', 'commercial'].includes(type) ||
      ['highway', 'secondary', 'primary', 'road'].includes(category)
    ) {
      return GeoPrecision.ROOFTOP
    }

    // 2. Média Precisão (NEIGHBORHOOD)
    // Rank 16-25 = Vilas, Bairros, Distritos
    if (rank >= 16) return GeoPrecision.NEIGHBORHOOD

    if (['neighbourhood', 'suburb', 'quarter', 'hamlet', 'district'].includes(type) || data.addresstype === 'suburb') {
      return GeoPrecision.NEIGHBORHOOD
    }

    // 3. Baixa Precisão (CITY)
    // Rank < 16 = Cidades, Estados, Países
    return GeoPrecision.CITY
  }

  /**
   * Estratégia para provedores de CEP (AwesomeAPI, ViaCEP)
   * Baseada na presença de campos.
   */
  static fromAddressData(data: Partial<AddressData>): GeoPrecision {
    // Se tem logradouro (nome da rua), consideramos precisão alta (nível de rua)
    if (data.logradouro && data.logradouro.trim() !== '') {
      return GeoPrecision.ROOFTOP
    }

    // Se não tem rua, mas tem bairro, é precisão média
    if (data.bairro && data.bairro.trim() !== '') {
      return GeoPrecision.NEIGHBORHOOD
    }

    // Se só tem cidade/estado, é precisão baixa
    return GeoPrecision.CITY
  }
}
