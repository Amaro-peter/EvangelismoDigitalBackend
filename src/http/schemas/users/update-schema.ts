import { z } from 'zod'
import { cpfSchema } from '@schemas/utils/cpf'
import { emailSchema } from '@schemas/utils/email'
import { usernameSchema } from '../utils/username'

export const updateSchema = z.object({
  name: z.string().trim().min(4).optional(),
  email: emailSchema.optional(),
  cpf: cpfSchema.optional(),
  username: usernameSchema.optional(),
})

export type updateSchemaType = z.infer<typeof updateSchema>
