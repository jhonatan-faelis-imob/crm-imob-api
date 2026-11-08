import { evaluatePortalReadiness, type PortalReadinessInput } from './portal.readiness'

const DESCRIPTION = 'Apartamento com sala ampla, cozinha e área de serviço, bem iluminado e arejado.'

function base(overrides: PortalReadinessInput = {}): PortalReadinessInput {
  return {
    propertyType: 'apartamento',
    title: 'Apartamento de 2 quartos no Centro',
    description: DESCRIPTION,
    price: 350000,
    cep: '01310-100',
    state: 'SP',
    city: 'São Paulo',
    neighborhood: 'Bela Vista',
    areaM2: 60,
    bedrooms: 2,
    bathrooms: 1,
    ...overrides,
  }
}

function item(result: ReturnType<typeof evaluatePortalReadiness>, key: string) {
  return result.items.find((entry) => entry.key === key)
}

describe('evaluatePortalReadiness', () => {
  it('imóvel completo fica pronto (fotos ainda não contam)', () => {
    const result = evaluatePortalReadiness(base(), null)
    expect(result.ready).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('apartamento sem banheiros falta', () => {
    const result = evaluatePortalReadiness(base({ bathrooms: null }), null)
    expect(result.ready).toBe(false)
    expect(item(result, 'bathrooms')?.ok).toBe(false)
    expect(result.missing).toContain('Banheiros')
  })

  it('terreno sem quartos e banheiros está ok (usa a área total)', () => {
    const result = evaluatePortalReadiness(
      base({ propertyType: 'terreno', bedrooms: null, bathrooms: null, areaM2: null, lotAreaM2: 300 }),
      null,
    )
    expect(result.ready).toBe(true)
    expect(item(result, 'bedrooms')).toBeUndefined()
    expect(item(result, 'bathrooms')).toBeUndefined()
    expect(item(result, 'area')?.label).toBe('Área total (m²)')
  })

  it('chácara sem área total falta, mesmo com área útil', () => {
    const result = evaluatePortalReadiness(base({ propertyType: 'chacara', areaM2: 120, lotAreaM2: null }), null)
    expect(item(result, 'area')?.ok).toBe(false)
    expect(result.ready).toBe(false)
  })

  it('kitnet com 0 quartos está ok', () => {
    expect(evaluatePortalReadiness(base({ propertyType: 'kitnet', bedrooms: 0 }), null).ready).toBe(true)
  })

  it('studio com 0 quartos está ok', () => {
    expect(evaluatePortalReadiness(base({ propertyType: 'studio', bedrooms: 0 }), null).ready).toBe(true)
  })

  it('apartamento com 0 quartos falta', () => {
    expect(item(evaluatePortalReadiness(base({ bedrooms: 0 }), null), 'bedrooms')?.ok).toBe(false)
  })

  it('título com 9 caracteres falta e com 10 passa (após trim)', () => {
    expect(item(evaluatePortalReadiness(base({ title: '123456789' }), null), 'title')?.ok).toBe(false)
    expect(item(evaluatePortalReadiness(base({ title: '  1234567890  ' }), null), 'title')?.ok).toBe(true)
  })

  it('descrição: 49 falta, 50 e 3.000 passam, 3.001 falta', () => {
    const check = (length: number) => item(evaluatePortalReadiness(base({ description: 'a'.repeat(length) }), null), 'description')?.ok
    expect(check(49)).toBe(false)
    expect(check(50)).toBe(true)
    expect(check(3000)).toBe(true)
    expect(check(3001)).toBe(false)
  })

  it('descrição com <b> é rejeitada', () => {
    const result = evaluatePortalReadiness(base({ description: `<b>${DESCRIPTION}</b>` }), null)
    expect(item(result, 'description')).toMatchObject({ ok: false, hint: 'Remova o HTML' })
  })

  it('photosCount nulo não bloqueia; 4 fotos bloqueiam; 5 passam', () => {
    const pending = evaluatePortalReadiness(base(), null)
    expect(item(pending, 'photos')).toMatchObject({ ok: null, label: 'Fotos (mínimo 5): disponível na próxima etapa' })
    expect(pending.ready).toBe(true)
    expect(evaluatePortalReadiness(base(), 4).ready).toBe(false)
    expect(evaluatePortalReadiness(base(), 5).ready).toBe(true)
  })

  it('tipo "outro" não é publicável e tipo vazio falta', () => {
    expect(item(evaluatePortalReadiness(base({ propertyType: 'outro' }), null), 'propertyType')?.ok).toBe(false)
    expect(item(evaluatePortalReadiness(base({ propertyType: null }), null), 'propertyType')?.ok).toBe(false)
  })

  it('CEP, UF, cidade, bairro e preço', () => {
    const result = evaluatePortalReadiness(
      base({ cep: '1234', state: 'São Paulo', city: ' ', neighborhood: '', price: 0 }),
      null,
    )
    for (const key of ['cep', 'state', 'city', 'neighborhood', 'price']) expect(item(result, key)?.ok).toBe(false)
    expect(item(evaluatePortalReadiness(base({ cep: '01310100' }), null), 'cep')?.ok).toBe(true)
  })
})
