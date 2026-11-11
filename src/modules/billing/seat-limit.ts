import { HttpException, HttpStatus } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { planName } from './plans.config'

type Db = Pick<Prisma.TransactionClient, 'organization' | 'user'>

/** 402 SEAT_LIMIT se a organização já tem tantos usuários ativos quanto os assentos contratados */
export async function assertSeatAvailable(db: Db, organizationId: string) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { seats: true, plan: true },
  })
  if (!organization) return
  const active = await db.user.count({ where: { organizationId, active: true } })
  if (active >= organization.seats) {
    const users = organization.seats === 1 ? '1 usuário' : `${organization.seats} usuários`
    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'SEAT_LIMIT',
        message: `Limite de ${users} do plano ${planName(organization.plan)} atingido. Fale com o suporte para ampliar.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    )
  }
}
