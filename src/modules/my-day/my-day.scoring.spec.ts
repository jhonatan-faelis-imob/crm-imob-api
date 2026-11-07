import { buildMyDayItems, countItems, type OwnedLead, type ScoredTask } from './my-day.scoring'

// 22h em São Paulo: já é o dia seguinte em UTC
const NIGHT = new Date('2026-03-11T01:00:00.000Z')
const NOON = new Date('2026-03-10T15:00:00.000Z')

function lead(overrides: Partial<OwnedLead> = {}): OwnedLead {
  return {
    id: 'l1',
    name: 'Lead',
    phone: '11999999999',
    phone2: null,
    email: null,
    urgency: 'sem_pressa',
    interestValue: null,
    lastContactAt: new Date('2026-03-10T12:00:00.000Z'),
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    funnelStage: { name: 'Contato', color: '#000' },
    tasks: [{ id: 't0', dueDate: new Date('2026-03-10T12:00:00.000Z') }],
    ...overrides,
  }
}

function task(dueDate: string, overrides: Partial<ScoredTask> = {}): ScoredTask {
  return {
    id: 't1',
    leadId: 'l1',
    title: 'Ligar',
    type: 'ligacao',
    priority: 'media',
    dueDate: new Date(dueDate),
    description: null,
    ...overrides,
  }
}

const codes = (item: { reasons: { code: string }[] }) => item.reasons.map((reason) => reason.code)

describe('buildMyDayItems', () => {
  it('tarefa vencida pontua pelo atraso, limitado a 10 dias', () => {
    const recent = lead()
    const [item] = buildMyDayItems([task('2026-03-08T12:00:00.000Z')], [recent], [], NOON)
    expect(item.score).toBe(104)
    expect(item.band).toBe('agora')
    expect(item.reasons[0].label).toBe('Tarefa vencida há 2 dias')
    expect(item.tasks[0].overdueDays).toBe(2)

    const [old] = buildMyDayItems([task('2026-01-01T12:00:00.000Z')], [recent], [], NOON)
    expect(old.score).toBe(120)
  })

  it('às 22h uma tarefa de hoje continua sendo de hoje', () => {
    const [item] = buildMyDayItems([task('2026-03-11T01:30:00.000Z')], [lead()], [], NIGHT)
    expect(codes(item)).toEqual(['tarefa_hoje'])
    expect(item.score).toBe(70)
    expect(item.reasons[0].label).toBe('Tarefa hoje às 22:30')
  })

  it('às 22h uma tarefa de amanhã ainda é futura', () => {
    const tomorrow = '2026-03-11T12:00:00.000Z'
    const scheduled = lead({ tasks: [{ id: 't1', dueDate: new Date(tomorrow) }] })
    expect(buildMyDayItems([task(tomorrow)], [scheduled], [], NIGHT)).toHaveLength(0)
  })

  it('tarefa de hoje com horário passado soma 10', () => {
    const [item] = buildMyDayItems([task('2026-03-10T13:00:00.000Z')], [lead()], [], NOON)
    expect(item.score).toBe(80)
    expect(item.band).toBe('hoje')
  })

  it('primeiro contato respeita a carência de 60 minutos', () => {
    const fresh = lead({ lastContactAt: null, createdAt: new Date('2026-03-10T14:30:00.000Z') })
    const old = lead({ lastContactAt: null, createdAt: new Date('2026-03-10T13:30:00.000Z') })
    expect(buildMyDayItems([], [fresh], [], NOON)).toHaveLength(0)
    expect(codes(buildMyDayItems([], [old], [], NOON)[0])).toEqual(['primeiro_contato'])
  })

  it('urgência imediata com 1 dia sem contato soma o bônus e vai para agora', () => {
    const urgent = lead({ urgency: 'imediato', lastContactAt: new Date('2026-03-09T15:00:00.000Z') })
    const [item] = buildMyDayItems([], [urgent], [], NOON)
    expect(codes(item)).toEqual(['urgencia_imediata'])
    expect(item.score).toBe(105)
    expect(item.band).toBe('agora')
  })

  it('o limite de dias sem contato depende da etapa', () => {
    const contact = new Date('2026-03-08T15:00:00.000Z')
    const early = lead({ lastContactAt: contact })
    const advanced = lead({ lastContactAt: contact, funnelStage: { name: 'Negociação', color: '#000' } })
    expect(buildMyDayItems([], [early], [], NOON)).toHaveLength(0)

    const [item] = buildMyDayItems([], [advanced], [], NOON)
    expect(codes(item)).toEqual(['sem_contato'])
    expect(item.score).toBe(62)
    expect(item.band).toBe('hoje')
  })

  it('dias sem contato contam a virada do dia em São Paulo', () => {
    const lastNight = lead({ lastContactAt: new Date('2026-03-10T01:30:00.000Z') })
    const [item] = buildMyDayItems([task('2026-03-10T14:00:00.000Z')], [lastNight], [], NOON)
    expect(item.daysWithoutContact).toBe(1)
  })

  it('lead sem nenhuma tarefa aparece em atenção', () => {
    const [item] = buildMyDayItems([], [lead({ tasks: [] })], [], NOON)
    expect(codes(item)).toEqual(['sem_proxima_tarefa'])
    expect(item.score).toBe(45)
    expect(item.band).toBe('atencao')
  })

  it('tarefa futura silencia sem contato e sem próxima tarefa, mas não a urgência', () => {
    const future = [{ id: 'f', dueDate: new Date('2026-03-13T12:00:00.000Z') }]
    const stale = new Date('2026-02-01T12:00:00.000Z')
    expect(buildMyDayItems([], [lead({ lastContactAt: stale, tasks: future })], [], NOON)).toHaveLength(0)

    const urgent = lead({ lastContactAt: stale, tasks: future, urgency: 'imediato' })
    expect(codes(buildMyDayItems([], [urgent], [], NOON)[0])).toEqual(['urgencia_imediata'])
  })

  it('tarefa de outro responsável conta como próxima tarefa, mas não vira motivo', () => {
    const others = [{ id: 'x', dueDate: new Date('2026-03-01T12:00:00.000Z') }]
    expect(buildMyDayItems([], [lead({ tasks: others })], [], NOON)).toHaveLength(0)
  })

  it('lead de outro corretor entra só pela tarefa do usuário', () => {
    const foreign = lead({ lastContactAt: null, tasks: [] })
    const [item] = buildMyDayItems([task('2026-03-09T12:00:00.000Z')], [], [foreign], NOON)
    expect(codes(item)).toEqual(['tarefa_vencida'])
  })

  it('agrupa por lead, com a maior pontuação mais os bônus', () => {
    const tasks = [task('2026-03-09T12:00:00.000Z'), task('2026-03-10T13:00:00.000Z', { id: 't2' })]
    const owned = lead({ urgency: 'um_mes', tasks: [{ id: 't1', dueDate: tasks[0].dueDate }] })
    const items = buildMyDayItems(tasks, [owned], [owned], NOON)
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe('lead:l1')
    expect(items[0].tasks).toHaveLength(2)
    expect(items[0].score).toBe(112)
    expect(codes(items[0])).toEqual(['tarefa_vencida', 'tarefa_hoje'])
  })

  it('tarefa sem lead vira item próprio e a futura não aparece', () => {
    const loose = task('2026-03-10T13:00:00.000Z', { leadId: null })
    const future = task('2026-03-20T13:00:00.000Z', { id: 't2', leadId: null })
    const items = buildMyDayItems([loose, future], [], [], NOON)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: 'task:t1', kind: 'task', lead: null, daysWithoutContact: null })
  })

  it('empate na pontuação ordena pelo valor de interesse', () => {
    const value = (amount: number) => ({ toNumber: () => amount })
    const items = buildMyDayItems(
      [],
      [
        lead({ id: 'a', tasks: [], interestValue: value(100) }),
        lead({ id: 'b', tasks: [], interestValue: value(900) }),
        lead({ id: 'c', tasks: [] }),
      ],
      [],
      NOON,
    )
    expect(items.map((item) => item.key)).toEqual(['lead:b', 'lead:a', 'lead:c'])
  })

  it('o resumo conta faixas e motivos', () => {
    const items = buildMyDayItems(
      [task('2026-03-09T12:00:00.000Z')],
      [lead({ tasks: [] }), lead({ id: 'l2', tasks: [] })],
      [],
      NOON,
    )
    expect(countItems(items)).toMatchObject({ agora: 1, atencao: 1, total: 2, tarefaVencida: 1, semProximaTarefa: 2 })
  })
})
