import {
  docsByLead,
  hasSpouse,
  pendingDocumentsText,
  requirementApplies,
  statusDates,
  summarizeChecklist,
} from './checklist-rules'

const single = { spouseName: null, maritalStatus: 'solteiro', fgtsValue: null }

describe('requirementApplies', () => {
  it('skips spouse and FGTS documents for a single lead without FGTS', () => {
    expect(requirementApplies({ holder: 'conjuge', appliesWhen: 'always' }, single)).toBe(false)
    expect(requirementApplies({ holder: 'titular', appliesWhen: 'has_fgts' }, single)).toBe(false)
    expect(requirementApplies({ holder: 'titular', appliesWhen: 'always' }, single)).toBe(true)
  })

  it('includes them when there is a spouse and FGTS', () => {
    const lead = { spouseName: null, maritalStatus: 'uniao_estavel', fgtsValue: 15000 }
    expect(requirementApplies({ holder: 'conjuge', appliesWhen: 'always' }, lead)).toBe(true)
    expect(requirementApplies({ holder: 'titular', appliesWhen: 'has_fgts' }, lead)).toBe(true)
  })

  it('treats a spouse name as spouse even without marital status, and zero FGTS as none', () => {
    expect(hasSpouse({ spouseName: ' Ana ', maritalStatus: null, fgtsValue: null })).toBe(true)
    expect(hasSpouse({ spouseName: '   ', maritalStatus: null, fgtsValue: null })).toBe(false)
    expect(requirementApplies({ holder: 'titular', appliesWhen: 'has_fgts' }, { ...single, fgtsValue: '0.00' })).toBe(false)
  })
})

describe('summarizeChecklist', () => {
  it('leaves dismissed and optional items out of the required total', () => {
    const summary = summarizeChecklist([
      { status: 'aprovado', required: true },
      { status: 'recebido', required: true },
      { status: 'recusado', required: true },
      { status: 'pendente', required: true },
      { status: 'dispensado', required: true },
      { status: 'pendente', required: false },
    ])
    expect(summary).toMatchObject({ requiredTotal: 4, requiredApproved: 1, percent: 25, pendingRequired: 2 })
    expect(summary.counts).toEqual({ pendente: 2, recebido: 1, aprovado: 1, recusado: 1, dispensado: 1 })
  })

  it('returns null percent without required items', () => {
    expect(summarizeChecklist([{ status: 'dispensado', required: true }]).percent).toBeNull()
  })
})

describe('docsByLead', () => {
  it('adds up the groupBy rows per lead', () => {
    const docs = docsByLead([
      { leadId: 'a', status: 'aprovado', required: true, _count: { _all: 2 } },
      { leadId: 'a', status: 'pendente', required: true, _count: { _all: 3 } },
      { leadId: 'a', status: 'recebido', required: false, _count: { _all: 1 } },
      { leadId: 'a', status: 'dispensado', required: true, _count: { _all: 1 } },
    ])
    expect(docs.get('a')).toEqual({ requiredTotal: 5, requiredApproved: 2, received: 1, pendingRequired: 3 })
    expect(docs.get('b')).toBeUndefined()
  })
})

describe('statusDates', () => {
  const now = new Date('2026-11-08T12:00:00Z')
  const before = new Date('2026-11-01T12:00:00Z')

  it('sets receivedAt only the first time', () => {
    expect(statusDates('recebido', { receivedAt: null }, now)).toEqual({ receivedAt: now })
    expect(statusDates('recebido', { receivedAt: before }, now)).toEqual({})
  })

  it('approving fills receivedAt when missing', () => {
    expect(statusDates('aprovado', { receivedAt: null }, now)).toEqual({ approvedAt: now, receivedAt: now })
    expect(statusDates('aprovado', { receivedAt: before }, now)).toEqual({ approvedAt: now })
  })

  it('pending clears both dates; refused and dismissed keep them', () => {
    expect(statusDates('pendente', { receivedAt: before }, now)).toEqual({ receivedAt: null, approvedAt: null })
    expect(statusDates('recusado', { receivedAt: before }, now)).toEqual({})
    expect(statusDates('dispensado', { receivedAt: before }, now)).toEqual({})
  })
})

describe('pendingDocumentsText', () => {
  it('lists required pending or refused items, marking the spouse ones', () => {
    expect(
      pendingDocumentsText([
        { name: 'CPF', holder: 'titular', required: true, status: 'pendente' },
        { name: 'RG', holder: 'conjuge', required: true, status: 'recusado' },
        { name: 'IR', holder: 'titular', required: false, status: 'pendente' },
        { name: 'CTPS', holder: 'titular', required: true, status: 'aprovado' },
      ]),
    ).toBe('• CPF\n• RG (cônjuge)')
  })

  it('is empty when nothing is pending, so the variable goes to missing', () => {
    expect(pendingDocumentsText([])).toBe('')
  })
})
