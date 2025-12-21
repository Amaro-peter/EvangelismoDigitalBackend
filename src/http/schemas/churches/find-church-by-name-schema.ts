import z from "zod";

export const findChurchByNameSchema = z.object({
  name: z.string().min(3, 'O nome deve ter no mínimo 3 caracteres'),
})

export type findChurchByNameSchema = z.infer<typeof findChurchByNameSchema>