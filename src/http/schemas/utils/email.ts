import z from 'zod'

export const emailSchema = z.email().transform((email) => email.toLowerCase())
