import { z } from 'zod'

export const findNearestChurchesQuerySchema = z.object({
  lat: z.coerce.number().min(-90, 'Latitude deve ser >= -90').max(90, 'Latitude deve ser <= 90'),
  lon: z.coerce.number().min(-180, 'Longitude deve ser >= -180').max(180, 'Longitude deve ser <= 180'),
})

export type FindNearestChurchesQuery = z.infer<typeof findNearestChurchesQuerySchema>

// JSON Schema for Fastify validation
export const findNearestChurchesQueryJsonSchema = {
  type: 'object',
  required: ['lat', 'lon'],
  properties: {
    lat: {
      type: 'number',
      minimum: -90,
      maximum: 90,
    },
    lon: {
      type: 'number',
      minimum: -180,
      maximum: 180,
    },
  },
} as const
