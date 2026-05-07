import { IMailJobData } from '../queue/mail-job-data.interface'

export interface IOutboxDispatchData {
  publicId: string
  emails: IMailJobData[]
}
