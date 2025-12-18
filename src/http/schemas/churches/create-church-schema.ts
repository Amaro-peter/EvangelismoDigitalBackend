import z from "zod";

export const createChurchBodySchema = z.object({
  name: z.string().min(3, 'O nome deve ter no mínimo 3 caracteres'),
  address: z.string().min(5, 'O endereço deve ter no mínimo 5 caracteres'),
  lat: z.coerce.number().min(-90, 'Latitude deve ser >= -90').max(90, 'Latitude deve ser <= 90'),
  lon: z.coerce.number().min(-180, 'Longitude deve ser >= -180').max(180, 'Longitude deve ser <= 180'),
})

export type createChurchBodySchema = z.infer<typeof createChurchBodySchema>

