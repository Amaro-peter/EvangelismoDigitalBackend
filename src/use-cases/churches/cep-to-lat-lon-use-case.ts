import { CoordinatesNotFoundError } from "@use-cases/errors/coordinates-not-found-error"
import { InvalidCepError } from "@use-cases/errors/invalid-cep-error"
import axios from "axios"


interface CepToLatLonRequest {
    cep: string
}

interface CepToLatLonResponse {
    userLat: number
    userLon: number
}

export class CepToLatLonUseCase {
    async execute({ cep }: CepToLatLonRequest): Promise<CepToLatLonResponse> {
        const viaCepRes = await axios.get(
            `https://viacep.com.br/ws/${cep}/json/`
        )

        if(viaCepRes.data.erro) {
            throw new InvalidCepError()
        }

        const { logradouro, localidade, uf } = viaCepRes.data
        const address = `${logradouro}, ${localidade} - ${uf}, Brazil`

        const geoRes = await axios.get(
            "https://nominatim.openstreetmap.org/search",
            {
                params: {
                    q: address,
                    format: "json",
                    limit: 1,
                },
                headers: {
                    "User-Agent": "EvangelismoDigitalBackend/1.0"
                },
            }
        );
        
        if(!geoRes.data.length) {
            throw new CoordinatesNotFoundError()
        }

        return {
            userLat: Number(geoRes.data[0].lat),
            userLon: Number(geoRes.data[0].lon),
        };
    }
}