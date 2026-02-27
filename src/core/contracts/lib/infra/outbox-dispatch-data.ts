import { MailJobData } from '../queue/mail-job-data'

export interface OutboxDispatchData {
  publicId: string
  emails: MailJobData[]
}
