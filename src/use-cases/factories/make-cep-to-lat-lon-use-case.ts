import { CepToLatLonUseCase } from "@use-cases/churches/cep-to-lat-lon-use-case"
import { ViaCepProvider } from 'providers/address-provider/viaCep-provider'
import { NominatimGeoProvider } from 'providers/geo-provider/nominatim-provider'

export function makeCepToLatLonUseCase() {
  const geoProvider = new NominatimGeoProvider()
  const viaCepProvider = new ViaCepProvider()
  const cepToLatLonUseCase = new CepToLatLonUseCase(geoProvider, viaCepProvider)

  return cepToLatLonUseCase
}