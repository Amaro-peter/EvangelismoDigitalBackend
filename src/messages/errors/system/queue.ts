import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'

export const JOB_ALREADY_PROCESSING_ERROR: IErrorDetail = {
  message: 'Bloqueio de Idempotência: Job em processamento simultâneo por outra thread.',
  code: 'JOB_ALREADY_PROCESSING',
}

export const SMTP_DISPATCH_ERROR: IErrorDetail = {
  message: 'Falha crítica ao despachar os e-mails via servidor SMTP.',
  code: 'SMTP_DISPATCH_FAILED',
}
