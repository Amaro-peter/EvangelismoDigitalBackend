import { IErrorDetail } from 'core/contracts/errors/error-detail.interface'

export const OUTBOX_EVENT_NOT_FOUND_ERROR: IErrorDetail = {
  code: 'OUTBOX_EVENT_NOT_FOUND',
  message: 'O evento de outbox solicitado não foi encontrado no banco de dados.',
}

export const OUTBOX_OPERATION_FAILED_ERROR: IErrorDetail = {
  code: 'OUTBOX_OPERATION_FAILED',
  message: 'Falha ao processar operação da outbox no banco de dados.',
}
