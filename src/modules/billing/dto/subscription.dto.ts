import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { PLAN_IDS } from '../plans.config'

export const SUBSCRIBE_BILLING_TYPES = ['CREDIT_CARD', 'PIX', 'BOLETO'] as const

export class SubscribeDto {
  @IsIn(PLAN_IDS)
  planId: string

  /** Sem valor: os usuários incluídos no plano */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  seats?: number

  /** Cartão: renovação automática. PIX ou boleto: cobrança mensal */
  @IsIn(SUBSCRIBE_BILLING_TYPES)
  billingType: string
}

export class ChangeSubscriptionDto {
  @IsOptional()
  @IsIn(PLAN_IDS)
  planId?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  seats?: number
}

export class CancelSubscriptionDto {
  @IsString()
  @IsNotEmpty({ message: 'Conte o motivo do cancelamento' })
  @MaxLength(500)
  reason: string
}
