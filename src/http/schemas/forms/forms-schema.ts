import { z } from 'zod'
import { emailSchema } from '@schemas/utils/email'

export const formsSchema = z.object({
  name: z.string().trim().min(4).max(255),
  email: emailSchema,
  decisaoPorCristo: z.boolean(),
})

export type formsSchemaType = z.infer<typeof formsSchema>