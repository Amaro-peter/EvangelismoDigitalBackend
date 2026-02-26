import { FormPayload } from 'core/types/use-cases/forms/form-payload'

export enum OutboxEventType {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
}

export interface OutBoxEventInputData {
  status: OutboxEventType
  type: string
  payload: FormPayload
}

export interface OutboxEvent {
  id: number
  publicId: string
  type: string
  status: OutboxEventType
  payload: unknown
  occurredAt: Date
  sendingAt: Date | null
}

export interface IOutboxRepository {
  create(data: OutBoxEventInputData): Promise<OutboxEvent>
  findPending(limit: number): Promise<OutboxEvent[]>
  /**
   * Retorna eventos com status SENDING cujo sendingAt é mais antigo que `thresholdMs`.
   *
   * Esses eventos iniciaram o dispatch mas não foram deletados — sinal de crash
   * entre o updateStatus(SENDING) e o delete. O cron de recuperação os reprocessa.
   *
   * O BullMQ descartará jobs duplicados graças ao jobId baseado no publicId,
   * garantindo que o reenvio ao BullMQ seja idempotente.
   *
   * @param thresholdMs - Tempo mínimo em ms que o evento deve estar SENDING
   *                      para ser considerado travado. Valor sugerido: 30_000.
   */
  findStuck(thresholdMs: number): Promise<OutboxEvent[]>
  updateStatus(publicId: string, status: OutboxEventType): Promise<void>
  findByPublicId(publicId: string): Promise<OutboxEvent | null>
  delete(publicId: string): Promise<void>
}
