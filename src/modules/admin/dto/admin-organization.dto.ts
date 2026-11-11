import { Transform } from 'class-transformer'
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { trimLowerEmail } from '../../../common/utils/email'
import { BillingInfoDto } from '../../billing/dto/billing-info.dto'
import { PLAN_IDS, SUBSCRIPTION_STATUSES } from '../../billing/plans.config'
import { SLUG_PATTERN } from '../../organizations/dto/onboarding.dto'

const money = { maxDecimalPlaces: 2 }

export class ListAdminOrganizationsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string

  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: string
}

/** Cria a imobiliária e o primeiro diretor de uma vez */
export class CreateAdminOrganizationDto extends BillingInfoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string

  @IsString()
  @Matches(SLUG_PATTERN, { message: 'Slug: só letras minúsculas, números e hífen' })
  @MaxLength(60)
  slug: string

  @IsIn(PLAN_IDS)
  plan: string

  /** Sem valor: os assentos do plano */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  seats?: number

  /** Sem valor: teste */
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  subscriptionStatus?: string

  /** Sem valor e em teste: hoje + TRIAL_DAYS */
  @IsOptional()
  @IsDateString()
  trialEndsAt?: string

  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string

  /** Sem valor: preço de tabela (priceFor) */
  @IsOptional()
  @IsNumber(money)
  @Min(0)
  monthlyPrice?: number

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  directorName: string

  @Transform(trimLowerEmail)
  @IsEmail({}, { message: 'E-mail do diretor inválido' })
  directorEmail: string

  /** Sem senha: gera e devolve uma única vez em temporaryPassword */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
  @MaxLength(72)
  directorPassword?: string
}

export class UpdateAdminOrganizationDto extends BillingInfoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string

  @IsOptional()
  @IsIn(PLAN_IDS)
  plan?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  seats?: number

  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  subscriptionStatus?: string

  /** null limpa */
  @IsOptional()
  @IsNumber(money)
  @Min(0)
  monthlyPrice?: number | null

  /** null limpa */
  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string | null

  /** null limpa */
  @IsOptional()
  @IsDateString()
  trialEndsAt?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string
}

export class BlockOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo' })
  @MaxLength(500)
  reason: string
}

export const PAYMENT_METHODS = ['pix', 'boleto', 'cartao', 'transferencia', 'dinheiro', 'outro'] as const

export class RegisterPaymentDto {
  @IsNumber(money)
  @Min(0.01)
  amount: number

  @IsDateString()
  paidAt: string

  @IsIn(PAYMENT_METHODS)
  method: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
