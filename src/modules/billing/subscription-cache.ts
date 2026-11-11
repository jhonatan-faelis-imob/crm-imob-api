import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { SubscriptionSnapshot } from './subscription-state'

const TTL_MS = 60_000

type Entry = { snapshot: SubscriptionSnapshot | null; expiresAt: number }

/**
 * Situação da assinatura por organização, em memória por 60 s (por réplica).
 * Quem altera a assinatura chama invalidate; noutra réplica a mudança aparece em até 60 s
 */
@Injectable()
export class SubscriptionCache {
  private entries = new Map<string, Entry>()

  constructor(private prisma: PrismaService) {}

  async get(organizationId: string, now = Date.now()): Promise<SubscriptionSnapshot | null> {
    const cached = this.entries.get(organizationId)
    if (cached && cached.expiresAt > now) return cached.snapshot
    const snapshot = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true },
    })
    this.entries.set(organizationId, { snapshot, expiresAt: now + TTL_MS })
    return snapshot
  }

  invalidate(organizationId?: string) {
    if (organizationId) this.entries.delete(organizationId)
    else this.entries.clear()
  }
}
