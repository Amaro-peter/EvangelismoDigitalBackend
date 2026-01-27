import { NearbyChurch } from '@repositories/churches-repository'
import axios, { AxiosResponse } from 'axios'

/* =======================
   Input Types
======================= */

export interface User {
  userLat: number
  userLon: number
}

export interface FindNearestProps {
  churches: NearbyChurch[]
  user: User
}

/* =======================
   Valhalla Request Types
======================= */

interface LatLon {
  lat: number
  lon: number
}

interface SourcesToTargetsRequest {
  sources: LatLon[]
  targets: LatLon[]
  costing: 'pedestrian'
}

/* =======================
   Valhalla Response Types
======================= */

interface SourceTargetResult {
  from_index: number
  to_index: number
  time: number // seconds
  distance: number // kilometers
  begin_heading?: number
  end_heading?: number
  begin_lat: number
  begin_lon: number
  end_lat: number
  end_lon: number
}

interface ValhallaResponse {
  sources_to_targets: SourceTargetResult[][]
  sources: LatLon[]
  targets: LatLon[]
  units: 'kilometers'
  algorithm: 'costmatrix'
}

/* =======================
   Main Class
======================= */

export class FindTheNearestChurchUseCase{
  async findNearest({ churches, user }: FindNearestProps): Promise<NearbyChurch> {
    if (!churches.length) {
      throw new Error('Lista de igrejas vazia!')
    }

    const payload: SourcesToTargetsRequest = {
      sources: [
        {
          lat: user.userLat,
          lon: user.userLon,
        },
      ],
      targets: churches.map((church) => ({
        lat: church.lat,
        lon: church.lon,
      })),
      costing: 'pedestrian',
    }

    const valhallaUrl = 'http://host.docker.internal:8002'
    const response: AxiosResponse<ValhallaResponse> = await axios.post(
      `${valhallaUrl}/sources_to_targets`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )

    /**
     * Matrix layout:
     * sources_to_targets[sourceIndex][targetIndex]
     */
    const results = response.data.sources_to_targets[0]

    let nearestChurch: NearbyChurch | null = null
    let minDistanceKm = Number.POSITIVE_INFINITY

    results.forEach((result, index) => {
      // status !== 0 means unreachable (optional safety)
      if (!result || result.distance == null) return

      if (result.distance < minDistanceKm) {
        minDistanceKm = result.distance

        nearestChurch = {
          ...churches[index],
          distanceKm: result.distance,
          distanceMeters: result.distance * 1000,
        }
      }
    })

    if (!nearestChurch) {
      throw new Error('Nenhuma igreja próxima encontrada!')
    }

    return nearestChurch
  }
}