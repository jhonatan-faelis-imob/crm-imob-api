import { BadRequestException } from '@nestjs/common'
import { normalizePhone, formatPhone } from '../../common/utils/phone'
import { onlyDigits } from './document'
import type { BillingInfoDto } from './dto/billing-info.dto'

export type BillingInfoData = {
  billingName?: string | null
  billingDocument?: string | null
  billingEmail?: string | null
  billingPhone?: string | null
}

/** Normaliza para gravar: vazio vira null, documento só dígitos, telefone (DD) 9XXXX-XXXX */
export function billingInfoData(dto: BillingInfoDto): BillingInfoData {
  const data: BillingInfoData = {}
  if (dto.billingName !== undefined) data.billingName = dto.billingName || null
  if (dto.billingDocument !== undefined) data.billingDocument = dto.billingDocument ? onlyDigits(dto.billingDocument) : null
  if (dto.billingEmail !== undefined) data.billingEmail = dto.billingEmail || null
  if (dto.billingPhone !== undefined) {
    if (!dto.billingPhone) data.billingPhone = null
    else {
      const digits = normalizePhone(dto.billingPhone)
      if (!digits) throw new BadRequestException('Telefone de cobrança deve ter 10 ou 11 dígitos com DDD')
      data.billingPhone = formatPhone(digits)
    }
  }
  return data
}
