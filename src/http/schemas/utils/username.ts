import z from 'zod'

export const usernameSchema = z.string().trim().min(3).max(60)

export type UsernameSchemaType = z.infer<typeof usernameSchema>
