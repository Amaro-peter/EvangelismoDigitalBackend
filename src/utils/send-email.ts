import { env } from '@env/index'
import { logger } from '@lib/logger'
import nodemailer, { SentMessageInfo, Transporter } from 'nodemailer'
import { Attachment } from 'nodemailer/lib/mailer'

let transporter: Transporter | null = null
let isVerified = false

async function getTransporter(): Promise<Transporter> {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_EMAIL,
        pass: env.SMTP_PASSWORD,
      },
    })

    // Verificar apenas uma vez
    if (!isVerified) {
      try {
        await transporter.verify()
        logger.info('transportador SMTP verificado com sucesso')
        isVerified = true
      } catch (error) {
        logger.error({ error }, 'transportador SMTP falhou na verificação')
        throw error
      }
    }
  }

  return transporter
}

interface SendEmailRequest {
  to: string
  subject: string
  message: string
  html: string
  attachments?: Attachment[]
}

export async function sendEmail({
  to,
  subject,
  message,
  html,
  attachments,
}: SendEmailRequest): Promise<SentMessageInfo> {
  try {
    const emailTransporter = await getTransporter()

    const info = await emailTransporter.sendMail({
      from: env.SMTP_EMAIL,
      to,
      subject,
      text: message,
      html,
      ...(attachments ? { attachments } : {}),
    })

    logger.info({ sentTo: to, messageId: info.messageId }, 'Mensagem de e-mail enviada com sucesso')

    return info
  } catch (error) {
    logger.error({ error }, 'Erro ao enviar e-mail')

    throw error
  }
}
