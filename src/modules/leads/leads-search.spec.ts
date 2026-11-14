import { PrismaService } from '../../prisma/prisma.service'
import { CadencesService } from '../cadences/cadences.service'
import { LeadsService } from './leads.service'

type Row = {
  id: string
  organizationId: string
  active: boolean
  name: string
  email: string | null
  phone: string
  phone2: string | null
  funnelStageId: string | null
  ownerId: string | null
  teamId: string | null
  status: string
  source: string
  urgency: string | null
}

type Where = Record<string, unknown>

// Avalia o subconjunto de where do Prisma usado pelo findAll: AND, OR, igualdade, contains (mode insensitive) e in
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return (condition as Where[]).every((item) => matches(row, item))
    if (key === 'OR') return (condition as Where[]).some((item) => matches(row, item))
    const value = row[key as keyof Row]
    if (condition !== null && typeof condition === 'object') {
      const filter = condition as { contains?: string; mode?: string; in?: string[] }
      if (filter.in) return filter.in.includes(String(value))
      if (filter.contains !== undefined) {
        if (typeof value !== 'string') return false
        return filter.mode === 'insensitive'
          ? value.toLowerCase().includes(filter.contains.toLowerCase())
          : value.includes(filter.contains)
      }
    }
    return value === condition
  })
}

function lead(overrides: Partial<Row> & Pick<Row, 'id' | 'name' | 'phone'>): Row {
  return {
    organizationId: 'org-1',
    active: true,
    email: null,
    phone2: null,
    funnelStageId: 'stage-novo',
    ownerId: 'broker-1',
    teamId: null,
    status: 'novo',
    source: 'indicacao',
    urgency: null,
    ...overrides,
  }
}

const ROWS: Row[] = [
  lead({ id: 'maria', name: 'Maria da Silva', phone: '(19) 99546-1826', email: 'maria@exemplo.com' }),
  lead({ id: 'joao', name: 'João Souza', phone: '19988887777', phone2: '+55 (11) 3456-7890' }),
  lead({ id: 'ana', name: 'Ana Lima', phone: '(19) 99546-1826', funnelStageId: 'stage-visita' }),
  lead({ id: 'pedro', name: 'Pedro Alves', phone: '(21) 97777-1234', ownerId: 'broker-2' }),
  lead({ id: 'outra-org', name: 'Maria Outra', phone: '(19) 99546-1826', organizationId: 'org-2' }),
]

function setup() {
  const findMany = jest.fn(({ where, take }: { where: Where; take?: number }) =>
    Promise.resolve(ROWS.filter((row) => matches(row, where)).slice(0, take ?? ROWS.length)),
  )
  const prisma = {
    lead: {
      findMany,
      count: jest.fn(({ where }: { where: Where }) => Promise.resolve(ROWS.filter((row) => matches(row, where)).length)),
    },
    leadChecklistItem: { groupBy: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService
  return { service: new LeadsService(prisma, {} as CadencesService), findMany }
}

const manager = { id: 'manager-1', role: 'gerente', teamId: null }
const broker = { id: 'broker-1', role: 'corretor', teamId: null }

async function search(text: string, extra: Record<string, string> = {}, user = manager) {
  const { service } = setup()
  const result = await service.findAll('org-1', { search: text, ...extra }, user)
  return result.data.map((row) => row.id).sort()
}

describe('LeadsService.findAll — busca por telefone ignorando a máscara', () => {
  it.each(['19995461826', '99546-1826', '995461826', '9954', '+55 19 99546-1826', '(19) 99546-1826'])(
    'lead salvo como (19) 99546-1826 aparece buscando "%s"',
    async (text) => {
      expect(await search(text)).toEqual(['ana', 'maria'])
    },
  )

  it('acha telefone salvo só com dígitos e o phone2 com +55 e máscara', async () => {
    expect(await search('(19) 98888-7777')).toEqual(['joao'])
    expect(await search('3456-7890')).toEqual(['joao'])
    expect(await search('1134567890')).toEqual(['joao'])
  })

  it('busca por nome e e-mail continua (contains, sem diferenciar maiúsculas)', async () => {
    expect(await search('maria')).toEqual(['maria'])
    expect(await search('SOUZA')).toEqual(['joao'])
    expect(await search('@exemplo')).toEqual(['maria'])
  })

  it('combina com o filtro de etapa sem quebrar', async () => {
    expect(await search('99546-1826', { funnelStageId: 'stage-visita' })).toEqual(['ana'])
    expect(await search('maria', { funnelStageId: 'stage-visita' })).toEqual([])
  })

  it('texto com menos de 4 dígitos não dispara a busca por telefone', async () => {
    const { service, findMany } = setup()
    const result = await service.findAll('org-1', { search: '995' }, manager)
    expect(result.data).toEqual([])
    // Só a consulta principal: nenhuma de candidatos por telefone
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('texto com letras não vira busca por telefone', async () => {
    const { service, findMany } = setup()
    await service.findAll('org-1', { search: 'Maria 1999' }, manager)
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('o filtro de responsável não fura a visibilidade do corretor', async () => {
    expect(await search('97777-1234', {}, broker)).toEqual([])
    const { service } = setup()
    const result = await service.findAll('org-1', { ownerId: 'broker-2' }, broker)
    expect(result.data).toEqual([])
  })
})
