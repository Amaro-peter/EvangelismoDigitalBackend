import { CepToLatLonUseCase } from "@use-cases/churches/cep-to-lat-lon-use-case"

export function makeCepToLatLonUseCase() {
    const cepToLatLonUseCase = new CepToLatLonUseCase()

    return cepToLatLonUseCase
}