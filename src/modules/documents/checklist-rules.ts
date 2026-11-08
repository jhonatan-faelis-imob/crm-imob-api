export const DOCUMENT_CATEGORIES = ['pessoal', 'renda', 'fgts', 'imovel', 'outro'] as const
export const DOCUMENT_HOLDERS = ['titular', 'conjuge'] as const
export const DOCUMENT_APPLIES_WHEN = ['always', 'has_fgts'] as const
export const CHECKLIST_STATUSES = ['pendente', 'recebido', 'aprovado', 'recusado', 'dispensado'] as const

export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number]

export const MAX_ACTIVE_REQUIREMENTS = 40
export const MAX_ITEMS_PER_LEAD = 60
export const MAX_BULK_ITEMS = 50

const SPOUSE_MARITAL_STATUSES = ['casado', 'uniao_estavel']
// Obrigatório que ainda depende do cliente
const PENDING_STATUSES: string[] = ['pendente', 'recusado']

export interface ChecklistLead {
  spouseName: string | null
  maritalStatus: string | null
  fgtsValue: { toString(): string } | number | null
}

export function hasSpouse(lead: ChecklistLead) {
  return !!lead.spouseName?.trim() || SPOUSE_MARITAL_STATUSES.includes(lead.maritalStatus ?? '')
}

export function hasFgts(lead: ChecklistLead) {
  return Number(lead.fgtsValue ?? 0) > 0
}

export function requirementApplies(requirement: { holder: string; appliesWhen: string }, lead: ChecklistLead) {
  if (requirement.holder === 'conjuge' && !hasSpouse(lead)) return false
  if (requirement.appliesWhen === 'has_fgts' && !hasFgts(lead)) return false
  return true
}

export function isPendingRequired(item: { required: boolean; status: string }) {
  return item.required && PENDING_STATUSES.includes(item.status)
}

export function summarizeChecklist(items: { status: string; required: boolean }[]) {
  const counts: Record<ChecklistStatus, number> = { pendente: 0, recebido: 0, aprovado: 0, recusado: 0, dispensado: 0 }
  let requiredTotal = 0
  let requiredApproved = 0
  let pendingRequired = 0

  for (const item of items) {
    if (item.status in counts) counts[item.status as ChecklistStatus] += 1
    if (!item.required || item.status === 'dispensado') continue
    requiredTotal += 1
    if (item.status === 'aprovado') requiredApproved += 1
    if (isPendingRequired(item)) pendingRequired += 1
  }

  return {
    counts,
    requiredTotal,
    requiredApproved,
    percent: requiredTotal === 0 ? null : Math.round((requiredApproved / requiredTotal) * 100),
    pendingRequired,
  }
}

export interface LeadDocsSummary {
  requiredTotal: number
  requiredApproved: number
  received: number
  pendingRequired: number
}

// Resumo da lista de leads a partir de um groupBy (leadId, status, required): sem N+1
export function docsByLead(
  groups: { leadId: string; status: string; required: boolean; _count: { _all: number } }[],
): Map<string, LeadDocsSummary> {
  const result = new Map<string, LeadDocsSummary>()
  for (const group of groups) {
    const docs = result.get(group.leadId) ?? { requiredTotal: 0, requiredApproved: 0, received: 0, pendingRequired: 0 }
    const count = group._count._all
    if (group.status === 'recebido') docs.received += count
    if (group.required && group.status !== 'dispensado') {
      docs.requiredTotal += count
      if (group.status === 'aprovado') docs.requiredApproved += count
      if (PENDING_STATUSES.includes(group.status)) docs.pendingRequired += count
    }
    result.set(group.leadId, docs)
  }
  return result
}

// recebido: receivedAt só na primeira vez; aprovado: approvedAt agora e receivedAt se faltar;
// pendente: limpa as duas; recusado e dispensado não mexem nas datas
export function statusDates(
  status: ChecklistStatus,
  current: { receivedAt: Date | null },
  now: Date,
): { receivedAt?: Date | null; approvedAt?: Date | null } {
  if (status === 'recebido') return current.receivedAt ? {} : { receivedAt: now }
  if (status === 'aprovado') return { approvedAt: now, ...(current.receivedAt ? {} : { receivedAt: now }) }
  if (status === 'pendente') return { receivedAt: null, approvedAt: null }
  return {}
}

export function pendingDocumentsText(items: { name: string; holder: string; required: boolean; status: string }[]) {
  return items
    .filter(isPendingRequired)
    .map((item) => `• ${item.name}${item.holder === 'conjuge' ? ' (cônjuge)' : ''}`)
    .join('\n')
}
