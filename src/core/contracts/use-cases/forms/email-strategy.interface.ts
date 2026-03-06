import { IMailJobData } from 'core/contracts/lib/queue/mail-job-data.interface'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

export interface IFormEmailStrategy {
  buildUserEmail(form: FormPayload): IMailJobData
  buildStaffEmail(form: FormPayload, ipAddress: string): IMailJobData
}
