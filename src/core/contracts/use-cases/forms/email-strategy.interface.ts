import { MailJobData } from "@lib/queue/mail-queue";
import { FormPayload } from "core/types/use-cases/forms/form-payload";

export interface IFormEmailStrategy {
    buildUserEmail(form: FormPayload): MailJobData
    buildStaffEmail(form: FormPayload, ipAddress: string): MailJobData
}