import { FastifyInstance } from "fastify";
import { formSubmission } from './form.controller'

export async function formsRoutes(app: FastifyInstance) {
  app.post('/submit-form', formSubmission)
}
