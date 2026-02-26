import { logger } from '@lib/logger'
import { mailQueue } from '@lib/queue/mail-queue'
import { DistributedLock, LockToken } from '@lib/redis/helper/distributed-lock'
import { ContactEmailStrategy } from '@use-cases/forms/strategies/contact-email-strategy'
import { DecisionForChristEmailStrategy } from '@use-cases/forms/strategies/decision-for-christ-email-strategy'
import { IOutboxRepository, OutboxEvent, OutboxEventType } from 'core/contracts/repository/outbox-repository'
import { FormPayload } from 'core/types/use-cases/forms/form-payload'

/**
 * Janela mínima para considerar um evento SENDING "travado".
 *
 * Um dispatch normal (BullMQ add) leva < 1s em condições normais.
 * 30s é uma margem conservadora que tolera alta latência de rede para o Redis
 * sem gerar falsos positivos.
 */
const STUCK_SENDING_THRESHOLD_MS = 30_000

export class OutboxProcessor {
  private readonly LOCK_KEY = 'lock:outbox-processor'

  /**
   * TTL do lock por evento. Renovado antes de cada evento para que o lock
   * total nunca precise prever a duração do batch inteiro.
   */
  private readonly LOCK_TTL_MS = 10_000

  constructor(private outboxRepository: IOutboxRepository) {}

  // ─── Fluxo Principal (signal path + cron de eventos novos) ─────────────────

  async processEvents(): Promise<void> {
    const lockToken = await DistributedLock.acquire(this.LOCK_KEY, this.LOCK_TTL_MS)

    if (!lockToken) {
      logger.info('🔒 Outbox já está sendo processada por outra instância. Pulando.')
      return
    }

    try {
      await this.processBatch(lockToken)
    } finally {
      await DistributedLock.release(this.LOCK_KEY, lockToken)
    }
  }

  // ─── Fluxo de Recuperação (cron de eventos travados) ───────────────────────

  /**
   * Recupera eventos que ficaram presos em SENDING após um crash.
   *
   * Usa o mesmo lock distribuído do fluxo principal para evitar que ambos
   * os fluxos compitam pelo mesmo evento simultaneamente.
   *
   * Chamado pelo cron de meia-noite em conjunto com processEvents().
   */
  async recoverStuckSendingEvents(): Promise<void> {
    const lockToken = await DistributedLock.acquire(this.LOCK_KEY, this.LOCK_TTL_MS)

    if (!lockToken) {
      logger.info('🔒 Lock indisponível para recuperação de eventos travados. Pulando.')
      return
    }

    try {
      const stuckEvents = await this.outboxRepository.findStuck(STUCK_SENDING_THRESHOLD_MS)

      if (stuckEvents.length === 0) {
        logger.info('✅ Nenhum evento SENDING travado encontrado.')
        return
      }

      logger.warn(`⚠️ ${stuckEvents.length} evento(s) SENDING travado(s). Reprocessando...`)

      for (const event of stuckEvents) {
        const lockRenewed = await DistributedLock.renew(this.LOCK_KEY, lockToken, this.LOCK_TTL_MS)

        if (!lockRenewed) {
          logger.error('⏰ Lock perdido durante recuperação de eventos travados. Interrompendo.')
          return
        }

        await this.processSingleEvent(event)
      }
    } finally {
      await DistributedLock.release(this.LOCK_KEY, lockToken)
    }
  }

  // ─── Processamento de Batch ─────────────────────────────────────────────────

  private async processBatch(lockToken: LockToken): Promise<void> {
    // findPending retorna APENAS eventos PENDING.
    // Eventos SENDING são domínio exclusivo de recoverStuckSendingEvents.
    const events = await this.outboxRepository.findPending(50)

    if (events.length === 0) {
      return
    }

    logger.info(`🚀 Processando ${events.length} evento(s) da Outbox...`)

    for (const event of events) {
      const lockRenewed = await DistributedLock.renew(this.LOCK_KEY, lockToken, this.LOCK_TTL_MS)

      if (!lockRenewed) {
        logger.error(
          { eventId: event.publicId },
          '⏰ Lock perdido antes de processar o próximo evento. Interrompendo para evitar concorrência.',
        )
        return
      }

      await this.processSingleEvent(event)
    }
  }

  // ─── Processamento Individual ───────────────────────────────────────────────

  /**
   * Processa um único evento com proteção contra duplicatas em dois níveis:
   *
   * NÍVEL 1 — Status SENDING (banco de dados):
   *   Persiste a intenção de dispatch ANTES de enviá-lo ao BullMQ.
   *   Se o processo crashar após o dispatch mas antes do delete, o evento
   *   permanece SENDING no banco. O cron de recuperação o detecta via
   *   findStuck e chama processSingleEvent novamente.
   *
   * NÍVEL 2 — jobId derivado do publicId (BullMQ):
   *   Ao retentar, o mailQueue.add usa o mesmo jobId da tentativa anterior.
   *   O BullMQ descarta o job duplicado se ele ainda existir na fila,
   *   garantindo que o worker de email processe o envio no máximo uma vez.
   *
   * Com os dois níveis combinados, o sistema passa de at-least-once delivery
   * sem controle para at-most-once delivery do ponto de vista do usuário final.
   */
  async processSingleEvent(event: OutboxEvent): Promise<void> {
    try {
      // 1. Marca como SENDING para travar o evento
      await this.outboxRepository.updateStatus(event.publicId, OutboxEventType.SENDING)

      await this.dispatchToBullMQ(event)
    } catch (error) {
      // Se o Redis cair, reverte para PENDING
      await this.outboxRepository.updateStatus(event.publicId, OutboxEventType.PENDING)
      logger.error({ publicId: event.publicId, error }, '❌ Falha no dispatch, revertido para PENDING')
    }
  }

  // ─── Dispatch ───────────────────────────────────────────────────────────────

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
      {
        jobId: event.publicId,
      },
    )
  }
}
