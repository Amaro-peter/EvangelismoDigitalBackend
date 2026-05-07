import { IAddressData } from 'core/contracts/use-cases/providers/address-provider.interface'
import { EnumGeoPrecision } from 'core/contracts/use-cases/providers/geo-provider.interface'

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
  static fromOsm(data: OsmRawData): EnumGeoPrecision {
    const rank = Number(data.place_rank) || 0
    const type = data.type || ''
    const category = data.class || '' // 'class' geralmente mapeia categoria

    // 1. Alta Precisão (ROOFTOP)
    // Rank 30 = Endereço exato com número
    // Rank 26-29 = Rua/Estrada
    if (rank >= 26) return EnumGeoPrecision.ROOFTOP

    if (
      ['house', 'building', 'residential', 'apartments', 'commercial'].includes(type) ||
      ['highway', 'secondary', 'primary', 'road'].includes(category)
    ) {
      return EnumGeoPrecision.ROOFTOP
    }

    // 2. Média Precisão (NEIGHBORHOOD)
    // Rank 16-25 = Vilas, Bairros, Distritos
    if (rank >= 16) return EnumGeoPrecision.NEIGHBORHOOD

    if (['neighbourhood', 'suburb', 'quarter', 'hamlet', 'district'].includes(type) || data.addresstype === 'suburb') {
      return EnumGeoPrecision.NEIGHBORHOOD
    }

    // 3. Baixa Precisão (CITY)
    // Rank < 16 = Cidades, Estados, Países
    return EnumGeoPrecision.CITY
  }

  /**
   * Estratégia para provedores de CEP (AwesomeAPI, ViaCEP)
   * Baseada na presença de campos.
   */
  static fromAddressData(data: Partial<IAddressData>): EnumGeoPrecision {
    // Se tem logradouro (nome da rua), consideramos precisão alta (nível de rua)
    if (data.logradouro && data.logradouro.trim() !== '') {
      return EnumGeoPrecision.ROOFTOP
    }

    // Se não tem rua, mas tem bairro, é precisão média
    if (data.bairro && data.bairro.trim() !== '') {
      return EnumGeoPrecision.NEIGHBORHOOD
    }

    // Se só tem cidade/estado, é precisão baixa
    return EnumGeoPrecision.CITY
  }
}
