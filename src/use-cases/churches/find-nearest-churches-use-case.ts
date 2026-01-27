import { ChurchesRepository, NearbyChurch } from '@repositories/churches-repository'
import { LatitudeRangeError } from '@use-cases/errors/latitude-range-error'
import { LongitudeRangeError } from '@use-cases/errors/longitude-range-error'

interface FindNearestChurchesRequest {
  userLat: number
  userLon: number
}

interface FindNearestChurchesResponse {
  churches: NearbyChurch[]
  totalFound: number
}

export class FindNearestChurchesUseCase {
  constructor(private churchesRepository: ChurchesRepository) {}

  async execute({ userLat, userLon }: FindNearestChurchesRequest): Promise<FindNearestChurchesResponse> {
    if (userLat < -90 || userLat > 90) {
      throw new LatitudeRangeError()
    }

    if (userLon < -180 || userLon > 180) {
      throw new LongitudeRangeError()
    }

    const churches = await this.churchesRepository.findNearest({
      userLat,
      userLon,
      limit: 20,
    })

    return {
      churches,
      totalFound: churches.length,
    }
  }
}
