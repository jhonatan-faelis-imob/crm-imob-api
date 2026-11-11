// Contratos do Asaas (API v3), com os nomes de campo da documentação oficial (docs.asaas.com).
// Só os campos que o sistema usa; o resto do objeto é ignorado

export type AsaasBillingType = 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX'
export const ASAAS_BILLING_TYPES: AsaasBillingType[] = ['CREDIT_CARD', 'PIX', 'BOLETO', 'UNDEFINED']

/** POST /v3/customers e PUT /v3/customers/{id} */
export interface AsaasCustomerInput {
  name: string
  cpfCnpj: string
  email?: string
  phone?: string
  mobilePhone?: string
  externalReference?: string
}

export interface AsaasCustomer {
  id: string
  name: string
}

/** POST /v3/subscriptions */
export interface AsaasSubscriptionInput {
  customer: string
  billingType: AsaasBillingType
  value: number
  /** AAAA-MM-DD */
  nextDueDate: string
  cycle: 'MONTHLY'
  description?: string
  externalReference?: string
  callback?: { successUrl: string; autoRedirect?: boolean }
}

/**
 * PUT /v3/subscriptions/{id}. Atenção: o schema da referência (SubscriptionUpdateRequestDTO) não lista "value",
 * mas a própria página fala em "alterar o valor" da assinatura; o valor vai em "value", o mesmo nome da criação.
 * Conferir no sandbox (ver CLAUDE.md)
 */
export interface AsaasSubscriptionUpdate {
  value?: number
  description?: string
  billingType?: AsaasBillingType
  updatePendingPayments?: boolean
}

export interface AsaasSubscription {
  id: string
  customer: string
  billingType: string
  value: number
  nextDueDate: string
  cycle: string
  description?: string | null
  /** ACTIVE | EXPIRED | INACTIVE */
  status: string
  deleted?: boolean
  externalReference?: string | null
}

/** Status de cobrança da documentação */
export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'

export interface AsaasPayment {
  id: string
  customer?: string | null
  subscription?: string | null
  value: number
  netValue?: number | null
  status: string
  billingType?: string | null
  /** AAAA-MM-DD */
  dueDate?: string | null
  paymentDate?: string | null
  clientPaymentDate?: string | null
  invoiceUrl?: string | null
  bankSlipUrl?: string | null
  description?: string | null
  externalReference?: string | null
  deleted?: boolean
}

/** GET /v3/subscriptions/{id}/payments */
export interface AsaasList<T> {
  object: 'list'
  hasMore: boolean
  totalCount: number
  limit: number
  offset: number
  data: T[]
}

/** Corpo do webhook: id do evento, nome do evento e o objeto relacionado (payment ou subscription) */
export interface AsaasWebhookEvent {
  id: string
  event: string
  dateCreated?: string
  payment?: AsaasPayment
  subscription?: AsaasSubscription
}

/** Pagamento confirmado ou recebido: libera o acesso */
export const PAID_EVENTS = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'] as const
/** Vencida ou estornada: passa para atrasada (a tarefa diária bloqueia depois da tolerância) */
export const DELINQUENT_EVENTS = ['PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'] as const
/** Só atualizam o espelho local da cobrança */
export const PAYMENT_SYNC_EVENTS = ['PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_DELETED', 'PAYMENT_RESTORED'] as const
/** Mantêm asaasSubscriptionId e billingType em dia */
export const SUBSCRIPTION_SYNC_EVENTS = ['SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED'] as const
/** Assinatura encerrada no Asaas: o vínculo local é desfeito (a situação segue a tarefa diária) */
export const SUBSCRIPTION_END_EVENTS = ['SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED'] as const

/** Cobrança paga (status do Asaas) */
export const PAID_STATUSES = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']
