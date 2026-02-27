import { IFormEmailStrategy } from 'core/contracts/use-cases/forms/email-strategy.interface'
import { decisionForChristUserSubjectText } from '@templates/decision-for-christ-user/decision-for-christ-user-subject-text'
import { decisionForChristUserTextTemplate } from '@templates/decision-for-christ-user/decision-for-christ-user-text'
import { decisionForChristUserHtmlTemplate } from '@templates/decision-for-christ-user/decision-for-christ-user-html'
import { decisionForChristStaffSubjectText } from '@templates/decision-for-christ-staff/decision-for-christ-staff-subject-text'
import { decisionForChristStaffTextTemplate } from '@templates/decision-for-christ-staff/decision-for-christ-staff-text'
import { decisionForChristStaffHtmlTemplate } from '@templates/decision-for-christ-staff/decision-for-christ-staff-html'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'
import { MailJobData } from 'core/contracts/lib/queue/mail-job-data'
import { env } from '@env/index'

export class DecisionForChristEmailStrategy implements IFormEmailStrategy {
  buildUserEmail(form: FormPayload): MailJobData {
    const email = this.getStringField(form.email, 'form.email')
    const name = this.getStringField(form.name, 'form.name')

    return {
      to: email,
      subject: decisionForChristUserSubjectText(),
      message: decisionForChristUserTextTemplate(name),
      html: decisionForChristUserHtmlTemplate(name),
      context: { type: 'decision-for-Christ', recipient: 'user' },
    }
  }

  buildStaffEmail(form: FormPayload): MailJobData {
    const email = this.getStringField(form.email, 'form.email')
    const name = this.getStringField(form.name, 'form.name')
    const lastName = this.getStringField(form.lastName, 'form.lastName')
    const location = this.getOptionalStringField(form.location, 'form.location')

    return {
      to: env.ADMIN_EMAIL,
      subject: decisionForChristStaffSubjectText(),
      message: decisionForChristStaffTextTemplate(name, email),
      html: decisionForChristStaffHtmlTemplate(name, lastName, email, location),
      context: { type: 'decision-for-Christ', recipient: 'internal' },
    }
  }

  private getStringField(value: unknown, fieldName: string): string {
    if (typeof value === 'string') {
      return value
    }
    throw new Error(`Invalid value for ${fieldName}: expected a string.`)
  }

  private getOptionalStringField(value: unknown, fieldName: string): string {
    if (value === undefined || typeof value === 'string') {
      return value || '' // Return an empty string if undefined
    }
    throw new Error(`Invalid value for ${fieldName}: expected a string or undefined.`)
  }
}
