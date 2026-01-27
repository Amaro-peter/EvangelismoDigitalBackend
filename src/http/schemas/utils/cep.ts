import { z } from 'zod'

// Brazilian CEP: 5 digits, optional hyphen, 3 digits (e.g., 12345-678 or 12345678)
export const cepSchema = z.string().regex(/^\d{5}-?\d{3}$/, {
  message: 'CEP inválido. Use o formato 12345-678 ou 12345678.',
})

export type CepSchemaType = z.infer<typeof cepSchema>
