import type { Prisma } from '@prisma/client'
import { sanitizePayload } from '../../integrations/core/sanitize'
import { addMonths } from '../subscription-state'
import { PAID_STATUSES, type AsaasPayment } from './asaas.types'

// Regras puras das cobranças do Asaas: datas, espelho local e payload sem dado de cartão

/** Chaves que nunca são gravadas: dados de cartão e tokens (além do que o sanitizePayload já tira) */
const CARD_KEY = /(credit_?card|card_?number|card_?token|cvv|ccv|holder)/i

function stripCard(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCard)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !CARD_KEY.test(key))
        .map(([key, child]) => [key, stripCard(child)]),
    )
  }
  return value
}

/** Payload para gravar (webhook e espelho da cobrança): sem cartão, sem tokens, no máximo 8 KB */
export function safePayload(value: unknown): Prisma.InputJsonValue {
  return sanitizePayload(stripCard(value))
}

/** "2026-12-11" → 11/12/2026 12:00 UTC (meio-dia: o dia não muda em nenhum fuso do Brasil) */
export function asaasDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null
  return new Date(`${value.slice(0, 10)}T12:00:00.000Z`)
}

/** Hoje (ou a data dada) no fuso de São Paulo, no formato AAAA-MM-DD do Asaas */
export function asaasDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date)
}

export function isPaidStatus(status: string | null | undefined) {
  return !!status && PAID_STATUSES.includes(status)
}

/** Fim do período pago por esta cobrança: um mês depois do vencimento */
export function periodEndForPayment(payment: Pick<AsaasPayment, 'dueDate'>): Date | null {
  const due = asaasDate(payment.dueDate)
  return due ? addMonths(due, 1) : null
}

/** Dados do model Payment a partir do objeto do Asaas */
export function paymentData(organizationId: string, payment: AsaasPayment, statusOverride?: string) {
  return {
    organizationId,
    asaasSubscriptionId: payment.subscription ?? null,
    value: payment.value,
    netValue: payment.netValue ?? null,
    status: statusOverride ?? payment.status,
    billingType: payment.billingType ?? null,
    dueDate: asaasDate(payment.dueDate),
    paidAt: asaasDate(payment.paymentDate ?? payment.clientPaymentDate ?? null),
    invoiceUrl: payment.invoiceUrl ?? null,
    bankSlipUrl: payment.bankSlipUrl ?? null,
    description: payment.description ?? null,
    raw: safePayload(payment),
  }
}

type PaymentDb = Pick<Prisma.TransactionClient, 'payment'>

/** Cria ou atualiza o espelho local pelo id do Asaas; devolve o status que estava gravado antes */
export async function upsertPayment(db: PaymentDb, organizationId: string, payment: AsaasPayment, statusOverride?: string) {
  const previous = await db.payment.findUnique({ where: { asaasPaymentId: payment.id }, select: { status: true } })
  const data = paymentData(organizationId, payment, statusOverride)
  await db.payment.upsert({
    where: { asaasPaymentId: payment.id },
    create: { asaasPaymentId: payment.id, ...data },
    update: data,
  })
  return previous?.status ?? null
}

/** O maior entre dois fins de período (o vencimento nunca anda para trás) */
export function laterDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}
