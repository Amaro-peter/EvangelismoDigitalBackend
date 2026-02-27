import { logger } from '@lib/logger'
import { mailQueue } from '@lib/queue/mail-queue'
import { DistributedLock, LockToken } from '@lib/redis/helper/distributed-lock'
import { ContactEmailStrategy } from '@use-cases/forms/strategies/contact-email-strategy'
import { DecisionForChristEmailStrategy } from '@use-cases/forms/strategies/decision-for-christ-email-strategy'
import { IOutboxRepository, OutboxEvent, OutboxEventType } from 'core/contracts/repository/outbox-repository'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

const STUCK_SENDING_THRESHOLD_MS = 30_000

export class OutboxProcessor {
  private readonly LOCK_KEY = 'lock:outbox-processor'
  private readonly LOCK_TTL_MS = 10_000

  constructor(private outboxRepository: IOutboxRepository) {}

  async processEvents(): Promise<void> {
    let lockToken: LockToken | null = null

    try {
      lockToken = await DistributedLock.acquire(this.LOCK_KEY, this.LOCK_TTL_MS)
      if (!lockToken) {
        logger.warn('processEvents: Processamento ignorado. Outra instância já está rodando.')
        return
      }

      const pendingEventsResult = await this.outboxRepository.findPending(100)

      // Verificação do Result
      if (pendingEventsResult.success === false) {
        logger.error({ error: pendingEventsResult.error }, '❌ Erro de Infra ao buscar eventos pendentes.')
        return
      }

      const pendingEvents = pendingEventsResult.value

      if (pendingEvents.length === 0) return

      logger.info(`Processando ${pendingEvents.length} eventos pendentes da Outbox...`)

      for (const event of pendingEvents) {
        await DistributedLock.renew(this.LOCK_KEY, lockToken, this.LOCK_TTL_MS)
        await this.processSingleEvent(event)
      }
    } catch (error) {
      logger.error({ error }, '❌ Erro crítico inesperado no loop principal de processEvents')
    } finally {
      if (lockToken) {
        await DistributedLock.release(this.LOCK_KEY, lockToken)
      }
    }
  }

  async recoverStuckSendingEvents(): Promise<void> {
    const RECOVERY_LOCK_KEY = 'lock:outbox-recovery'
    let lockToken: LockToken | null = null

    try {
      lockToken = await DistributedLock.acquire(RECOVERY_LOCK_KEY, this.LOCK_TTL_MS)
      if (!lockToken) return

      const thresholdDate = new Date(Date.now() - STUCK_SENDING_THRESHOLD_MS)
      const stuckEventsResult = await this.outboxRepository.findStuck(thresholdDate)

      // Verificação do Result
      if (stuckEventsResult.success === false) {
        logger.error({ error: stuckEventsResult.error }, '❌ Erro de Infra ao buscar eventos travados na Outbox.')
        return
      }

      const stuckEvents = stuckEventsResult.value

      if (stuckEvents.length > 0) {
        logger.warn(`♻️ Encontrados ${stuckEvents.length} eventos travados em SENDING. Iniciando recuperação...`)
        for (const event of stuckEvents) {
          await DistributedLock.renew(RECOVERY_LOCK_KEY, lockToken, this.LOCK_TTL_MS)
          await this.processSingleEvent(event)
        }
      }
    } catch (error) {
      logger.error({ error }, '❌ Erro crítico inesperado no recoverStuckSendingEvents')
    } finally {
      if (lockToken) {
        await DistributedLock.release(RECOVERY_LOCK_KEY, lockToken)
      }
    }
  }

  async processSingleEvent(event: OutboxEvent): Promise<void> {
    try {
      const updateResult = await this.outboxRepository.updateStatus(event.publicId, OutboxEventType.SENDING)

      // Se não conseguimos atualizar para SENDING, jogamos para o catch reverter
      if (updateResult.success === false) throw updateResult.error

      await this.dispatchToBullMQ(event)
    } catch (error) {
      const revertResult = await this.outboxRepository.updateStatus(event.publicId, OutboxEventType.PENDING)

      if (revertResult.success === false) {
        logger.error(
          { publicId: event.publicId, error: revertResult.error },
          '🚨 FATAL: Falha ao reverter status para PENDING. Inconsistência na DB.',
        )
      } else {
        logger.error({ publicId: event.publicId, error }, '❌ Falha no dispatch, revertido para PENDING')
      }
    }
  }

  private async dispatchToBullMQ(event: OutboxEvent): Promise<void> {
    const payload = event.payload as FormPayload

    const strategy = payload.decisaoPorCristo ? new DecisionForChristEmailStrategy() : new ContactEmailStrategy()

    const userJob = strategy.buildUserEmail(payload)
    const staffJob = strategy.buildStaffEmail(payload)

    await mailQueue.add(
      'outbox-dispatch',
      {
        publicId: event.publicId,
        emails: [userJob, staffJob],
      },
      { jobId: event.publicId },
    )
  }
}
