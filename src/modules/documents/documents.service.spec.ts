import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { LeadsService } from '../leads/leads.service'
import { DocumentsService } from './documents.service'

const user = { organizationId: 'org', id: 'u1', role: 'corretor', teamId: null }
const lead = { id: 'lead-1', name: 'Maria', ownerId: 'u1', teamId: null, spouseName: null, maritalStatus: 'casado', fgtsValue: null }

function requirement(id: string, holder: string, appliesWhen = 'always') {
  return { id, name: id, description: null, category: 'pessoal', holder, required: true, appliesWhen, orderIndex: 0 }
}

function setup(options: { itemCount?: number; existing?: { requirementId: string; holder: string }[]; item?: object } = {}) {
  const prisma = {
    documentRequirement: {
      count: jest.fn().mockResolvedValue(3),
      findMany: jest
        .fn()
        .mockResolvedValue([requirement('rg', 'titular'), requirement('rg-c', 'conjuge'), requirement('fgts', 'titular', 'has_fgts')]),
    },
    leadChecklistItem: {
      count: jest.fn().mockResolvedValue(options.itemCount ?? 0),
      findMany: jest.fn().mockResolvedValue(options.existing ?? []),
      createMany: jest.fn(({ data }: { data: unknown[]; skipDuplicates?: boolean }) => Promise.resolve({ count: data.length })),
      findFirst: jest.fn().mockResolvedValue(options.item ?? null),
      delete: jest.fn(),
    },
  }
  const leads = { assertLeadAccess: jest.fn().mockResolvedValue(lead), assertCanView: jest.fn() }
  const service = new DocumentsService(prisma as unknown as PrismaService, leads as unknown as LeadsService)
  return { prisma, leads, service }
}

describe('DocumentsService checklist generation', () => {
  it('generates applicable items once, with skipDuplicates', async () => {
    const { prisma, service } = setup()
    await service.getChecklist(user, 'lead-1')

    const call = prisma.leadChecklistItem.createMany.mock.calls[0][0]
    expect(call.skipDuplicates).toBe(true)
    // Casado: entra o do cônjuge; sem FGTS: o extrato fica de fora
    expect(call.data.map((item: { requirementId: string }) => item.requirementId)).toEqual(['rg', 'rg-c'])
  })

  it('does not regenerate when the lead already has items', async () => {
    const { prisma, service } = setup({ itemCount: 5 })
    await service.getChecklist(user, 'lead-1')
    expect(prisma.leadChecklistItem.createMany).not.toHaveBeenCalled()
  })

  it('sync only adds what is missing', async () => {
    const { prisma, service } = setup({ itemCount: 1, existing: [{ requirementId: 'rg', holder: 'titular' }] })
    const result = await service.syncChecklist(user, 'lead-1')
    expect(prisma.leadChecklistItem.createMany.mock.calls[0][0].data).toHaveLength(1)
    expect(result).toEqual({ created: 1 })
  })
})

describe('DocumentsService item rules', () => {
  it('refuses to delete an item from the standard list', async () => {
    const { prisma, service } = setup({ item: { id: 'i1', requirementId: 'rg', lead: { ownerId: 'u1', teamId: null } } })
    await expect(service.removeItem(user, 'i1')).rejects.toThrow('Use ‘Dispensar’ para itens da lista padrão')
    expect(prisma.leadChecklistItem.delete).not.toHaveBeenCalled()
  })

  it('refuses to rename an item from the standard list', async () => {
    const { service } = setup({ item: { id: 'i1', requirementId: 'rg', receivedAt: null, lead: { ownerId: 'u1', teamId: null } } })
    await expect(service.updateItem(user, 'i1', { name: 'Outro' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('checks lead visibility when loading an item', async () => {
    const { leads, service } = setup({ item: { id: 'i1', requirementId: null, lead: { ownerId: 'other', teamId: null } } })
    await service.removeItem(user, 'i1')
    expect(leads.assertCanView).toHaveBeenCalledWith({ ownerId: 'other', teamId: null }, user)
  })
})
