import { MailJobData } from '@lib/queue/mail-queue'
import { IFormEmailStrategy } from 'core/contracts/use-cases/forms/email-strategy.interface'
import { contactUserSubjectTextTemplate } from '@templates/contact-user/contact-user-subject-text'
import { contactUserTextTemplate } from '@templates/contact-user/contact-user-text'
import { contactUserHtmlTemplate } from '@templates/contact-user/contact-user-html'
import { contactStaffSubjectTextTemplate } from '@templates/contact-staff/contact-staff-subject-text'
import { contactStaffTextTemplate } from '@templates/contact-staff/contact-staff-text'
import { contactStaffHtmlTemplate } from '@templates/contact-staff/contact-staff-html'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

export class ContactEmailStrategy implements IFormEmailStrategy {
  buildUserEmail(form: FormPayload): MailJobData {
    const email = this.getStringField(form.email, 'form.email')
    const name = this.getStringField(form.name, 'form.name')

    return {
      to: email,
      subject: contactUserSubjectTextTemplate(name),
      message: contactUserTextTemplate(name),
      html: contactUserHtmlTemplate(name),
      context: { type: 'contact', recipient: 'user' },
    }
  }

  buildStaffEmail(form: FormPayload): MailJobData {
    const email = this.getStringField(form.email, 'form.email')
    const name = this.getStringField(form.name, 'form.name')
    const lastName = this.getOptionalStringField(form.lastName, 'form.lastName')

    return {
      to: process.env.ADMIN_EMAIL,
      subject: contactStaffSubjectTextTemplate(),
      message: contactStaffTextTemplate(name, email),
      html: contactStaffHtmlTemplate(name, lastName, email),
      context: { type: 'contact', recipient: 'internal' },
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
