import { findPropertyType, HTML_TAG, PORTAL_LIMITS, type FieldRule } from './portal.config'

// Função pura (sem Nest nem Prisma): avalia se um imóvel de revenda tem o mínimo exigido pelos portais.

type NumericLike = number | string | { toString(): string } | null | undefined

export interface PortalReadinessInput {
  propertyType?: string | null
  title?: string | null
  description?: string | null
  price?: NumericLike
  cep?: string | null
  state?: string | null
  city?: string | null
  neighborhood?: string | null
  areaM2?: NumericLike
  lotAreaM2?: NumericLike
  bedrooms?: number | null
  bathrooms?: number | null
}

export type PortalReadinessKey =
  | 'propertyType'
  | 'title'
  | 'description'
  | 'price'
  | 'cep'
  | 'state'
  | 'city'
  | 'neighborhood'
  | 'area'
  | 'bedrooms'
  | 'bathrooms'
  | 'photos'

export interface PortalReadinessItem {
  key: PortalReadinessKey
  label: string
  /** null = ainda não avaliável (não conta para ready) */
  ok: boolean | null
  hint: string | null
}

export interface PortalReadiness {
  ready: boolean
  items: PortalReadinessItem[]
  missing: string[]
}

function toNumber(value: NumericLike): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(typeof value === 'object' ? value.toString() : value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: string | null | undefined) {
  return (value ?? '').trim()
}

function roomsItem(
  key: 'bedrooms' | 'bathrooms',
  label: string,
  rule: FieldRule,
  value: number | null | undefined,
  min: number,
): PortalReadinessItem | null {
  if (rule !== 'required') return null
  const ok = value !== null && value !== undefined && value >= min
  return { key, label, ok, hint: ok ? null : min === 0 ? 'Informe a quantidade (0 vale)' : 'Informe a quantidade' }
}

export function evaluatePortalReadiness(
  property: PortalReadinessInput,
  photosCount: number | null,
): PortalReadiness {
  const { TITLE_MIN, TITLE_MAX, DESC_MIN, DESC_MAX, PHOTOS_MIN } = PORTAL_LIMITS
  const items: PortalReadinessItem[] = []
  const type = findPropertyType(property.propertyType)

  const typeOk = type !== undefined && type.vrsync !== null
  items.push({
    key: 'propertyType',
    label: 'Tipo do imóvel',
    ok: typeOk,
    hint: typeOk ? null : type ? 'Este tipo não é aceito pelos portais' : 'Escolha o tipo',
  })

  const title = text(property.title)
  const titleOk = title.length >= TITLE_MIN && title.length <= TITLE_MAX
  items.push({
    key: 'title',
    label: `Título (${TITLE_MIN} a ${TITLE_MAX} caracteres)`,
    ok: titleOk,
    hint: titleOk ? null : `Tem ${title.length} caracteres`,
  })

  const description = text(property.description)
  const hasHtml = HTML_TAG.test(description)
  const descriptionOk = !hasHtml && description.length >= DESC_MIN && description.length <= DESC_MAX
  items.push({
    key: 'description',
    label: `Descrição (${DESC_MIN} a ${DESC_MAX.toLocaleString('pt-BR')} caracteres)`,
    ok: descriptionOk,
    hint: descriptionOk ? null : hasHtml ? 'Remova o HTML' : `Tem ${description.length} caracteres`,
  })

  const price = toNumber(property.price)
  items.push({ key: 'price', label: 'Valor', ok: price !== null && price > 0, hint: price && price > 0 ? null : 'Informe o valor' })

  // 8 dígitos, com ou sem hífen
  const cepOk = /^\d{5}-?\d{3}$/.test(text(property.cep))
  items.push({ key: 'cep', label: 'CEP', ok: cepOk, hint: cepOk ? null : 'Informe o CEP com 8 dígitos' })

  const stateOk = /^[A-Za-z]{2}$/.test(text(property.state))
  items.push({ key: 'state', label: 'Estado (UF)', ok: stateOk, hint: stateOk ? null : 'Informe a UF com 2 letras' })

  const cityOk = text(property.city).length > 0
  items.push({ key: 'city', label: 'Cidade', ok: cityOk, hint: cityOk ? null : 'Informe a cidade' })

  const neighborhoodOk = text(property.neighborhood).length > 0
  items.push({ key: 'neighborhood', label: 'Bairro', ok: neighborhoodOk, hint: neighborhoodOk ? null : 'Informe o bairro' })

  const isLot = type?.area === 'lot'
  const area = toNumber(isLot ? property.lotAreaM2 : property.areaM2)
  const areaOk = area !== null && area > 0
  items.push({
    key: 'area',
    label: isLot ? 'Área total (m²)' : 'Área útil (m²)',
    ok: areaOk,
    hint: areaOk ? null : 'Informe a área',
  })

  if (type) {
    const bedrooms = roomsItem('bedrooms', 'Quartos', type.bedrooms, property.bedrooms, type.bedroomsMin)
    if (bedrooms) items.push(bedrooms)
    const bathrooms = roomsItem('bathrooms', 'Banheiros', type.bathrooms, property.bathrooms, 1)
    if (bathrooms) items.push(bathrooms)
  }

  if (photosCount === null) {
    items.push({
      key: 'photos',
      label: `Fotos (mínimo ${PHOTOS_MIN}): disponível na próxima etapa`,
      ok: null,
      hint: null,
    })
  } else {
    const photosOk = photosCount >= PHOTOS_MIN
    items.push({
      key: 'photos',
      label: `Fotos (mínimo ${PHOTOS_MIN})`,
      ok: photosOk,
      hint: photosOk ? null : `Tem ${photosCount}`,
    })
  }

  const failed = items.filter((item) => item.ok === false)
  return { ready: failed.length === 0, items, missing: failed.map((item) => item.label) }
}
