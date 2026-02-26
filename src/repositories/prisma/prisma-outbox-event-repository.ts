import { DatabaseContext } from '@lib/prisma/helpers/database-context'
import {
  IOutboxRepository,
  OutboxEvent,
  OutBoxEventInputData,
  OutboxEventType,
} from 'core/contracts/repository/outbox-repository'

/**
 * MIGRATION NECESSÁRIA:
 *
 * O campo `sendingAt` precisa ser adicionado ao model OutboxEvent no schema.prisma:
 *
 *   model OutboxEvent {
 *     id         Int              @id @default(autoincrement())
 *     publicId   String           @unique @default(uuid())
 *     type       String
 *     status     String           @default("PENDING")
 *     payload    Json
 *     occurredAt DateTime         @default(now())
 *     sendingAt  DateTime?                            // ← novo campo
 *   }
 *
 * Após editar o schema, rode:
 *   npx prisma migrate dev --name add_sending_at_to_outbox_event
 */

export class PrismaOutboxRepository implements IOutboxRepository {
  constructor(private readonly dbContext: DatabaseContext) {}

  async create(data: OutBoxEventInputData): Promise<OutboxEvent> {
    const outboxEvent = await this.dbContext.client.outboxEvent.create({
      data: {
        type: data.type,
        status: data.status,
        payload: data.payload,
      },
    })

    return this.toEntity(outboxEvent)
  }

  async findByPublicId(publicId: string): Promise<OutboxEvent | null> {
    const event = await this.dbContext.client.outboxEvent.findUnique({
      where: { publicId },
    })

    if (!event) return null

    return this.toEntity(event)
  }

  /**
   * Retorna apenas eventos PENDING.
   *
   * Eventos SENDING são intencionalmente excluídos — eles estão sob
   * responsabilidade exclusiva de findStuck para evitar que o fluxo
   * normal e o fluxo de recuperação compitam pelo mesmo evento.
   */
  async findPending(limit: number): Promise<OutboxEvent[]> {
    const events = await this.dbContext.client.outboxEvent.findMany({
      where: { status: OutboxEventType.PENDING },
      take: limit,
      orderBy: { occurredAt: 'asc' },
    })

    return events.map(this.toEntity)
  }

  /**
   * Retorna eventos SENDING cujo sendingAt é mais antigo que `thresholdMs`.
   *
   * Esses eventos iniciaram o dispatch mas não foram deletados, o que indica
   * crash entre o updateStatus(SENDING) e o delete. O OutboxProcessor os
   * reprocessa via recoverStuckSendingEvents.
   *
   * A query filtra por `sendingAt <= now() - thresholdMs` usando uma data
   * calculada no lado da aplicação para manter compatibilidade com qualquer
   * banco suportado pelo Prisma sem depender de funções SQL específicas.
   */
  async findStuck(thresholdMs: number): Promise<OutboxEvent[]> {
    const stuckBefore = new Date(Date.now() - thresholdMs)

    const events = await this.dbContext.client.outboxEvent.findMany({
      where: {
        status: OutboxEventType.SENDING,
        sendingAt: { lte: stuckBefore },
      },
      orderBy: { sendingAt: 'asc' },
    })

    return events.map(this.toEntity)
  }

  /**
   * Atualiza o status do evento.
   *
   * Quando o novo status é SENDING, persiste também o timestamp exato
   * da transição em `sendingAt`. Esse valor é a âncora temporal usada
   * por findStuck para determinar se o evento está travado.
   */
  async updateStatus(publicId: string, status: OutboxEventType): Promise<void> {
    await this.dbContext.client.outboxEvent.update({
      where: { publicId },
      data: {
        status,
        ...(status === OutboxEventType.SENDING && { sendingAt: new Date() }),
      },
    })
  }

  async delete(publicId: string): Promise<void> {
    await this.dbContext.client.outboxEvent.delete({
      where: { publicId },
    })
  }

  // ─── Mapper ──────────────────────────────────────────────────────────────────

  private toEntity(raw: {
    id: number
    publicId: string
    type: string
    status: string
    payload: unknown
    occurredAt: Date
    sendingAt: Date | null
  }): OutboxEvent {
    return {
      id: raw.id,
      publicId: raw.publicId,
      type: raw.type,
      status: raw.status as OutboxEventType,
      payload: raw.payload,
      occurredAt: raw.occurredAt,
      sendingAt: raw.sendingAt,
    }
  }
}
