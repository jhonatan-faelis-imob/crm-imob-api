import { randomBytes } from 'crypto'
import { findPropertyType, PROPERTY_FEATURES } from '../properties/portal.config'

// Partes puras do link público: token, status, robôs e a carga montada com lista de campos permitidos.

/** 24 bytes aleatórios em base64url = 32 caracteres, imprevisível */
export function generateShareToken() {
  return randomBytes(24).toString('base64url')
}

export const SHARE_EXPIRATION_DAYS = [7, 30, 90] as const
export const DEFAULT_EXPIRATION_DAYS = 30
/** Dois mark-sent do mesmo link dentro deste intervalo geram uma interação só */
export const MARK_SENT_DEDUP_MS = 2 * 60 * 1000

const BOT_USER_AGENT =
  /bot|crawler|spider|facebookexternalhit|whatsapp|telegram|slackbot|twitterbot|linkedinbot|preview|curl|wget|headless/i

export function isBotUserAgent(userAgent: string | undefined | null) {
  return !userAgent || BOT_USER_AGENT.test(userAgent)
}

export type ShareStatus = 'ativo' | 'expirado' | 'revogado'

export function shareStatus(share: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): ShareStatus {
  if (share.revokedAt) return 'revogado'
  if (share.expiresAt && share.expiresAt.getTime() <= now.getTime()) return 'expirado'
  return 'ativo'
}

export function shareUrl(frontendUrl: string, token: string) {
  return `${frontendUrl.replace(/\/+$/, '')}/i/${token}`
}

// ---------------- Carga pública ----------------

type NumericLike = number | string | { toString(): string } | null | undefined

/** Só os campos que a carga pública pode ler. Qualquer outro campo do banco nunca chega aqui */
export interface PublicShareProperty {
  kind: string
  title: string
  description: string | null
  propertyType: string | null
  propertyStatus: string | null
  sold: boolean
  active: boolean
  price: NumericLike
  startingPrice: NumericLike
  maxPrice: NumericLike
  totalUnits: number | null
  address: string | null
  streetNumber: string | null
  neighborhood: string | null
  city: string
  state: string | null
  portalAddressDisplay: string
  areaM2: NumericLike
  lotAreaM2: NumericLike
  bedrooms: number | null
  suites: number | null
  bathrooms: number | null
  parkingSpots: number | null
  unitFloor: number | null
  buildingFloors: number | null
  yearBuilt: number | null
  condoFee: NumericLike
  iptuValue: NumericLike
  iptuPeriod: string | null
  acceptsFgts: boolean | null
  acceptsFinancing: boolean | null
  features: string[]
}

export interface PublicShareBroker {
  name: string
  creci: string | null
  phone: string | null
  avatarUrl: string | null
}

export type PublicShareStatus = 'disponivel' | 'reservado' | 'vendido' | 'indisponivel'

export interface PublicShare {
  status: PublicShareStatus
  kind: 'revenda' | 'empreendimento'
  title: string
  typeLabel: string | null
  price: number | null
  priceLabel: 'valor' | 'a partir de'
  maxPrice: number | null
  totalUnits: number | null
  constructionStatusLabel: string | null
  location: {
    line: string | null
    neighborhood: string | null
    city: string
    state: string | null
    mapUrl: string
  }
  specs: {
    livingArea: number | null
    lotArea: number | null
    bedrooms: number | null
    suites: number | null
    bathrooms: number | null
    parking: number | null
    unitFloor: number | null
    buildingFloors: number | null
    yearBuilt: number | null
  }
  conditions: {
    condoFee: number | null
    iptu: { value: number; period: 'anual' | 'mensal' | null } | null
    acceptsFgts: boolean | null
    acceptsFinancing: boolean | null
  }
  features: { value: string; label: string }[]
  description: string | null
  photos: string[]
  broker: PublicShareBroker | null
  organization: { name: string }
  expiresAt: string | null
}

/** Imóvel fora do ar: nenhum dado dele, só quem pode ajudar */
export interface UnavailableShare {
  status: 'indisponivel'
  broker: PublicShareBroker | null
  organization: { name: string }
  expiresAt: string | null
}

const CONSTRUCTION_STATUS_LABEL: Record<string, string> = {
  lancamento: 'Lançamento',
  em_obras: 'Em obras',
  pronto_morar: 'Pronto para morar',
  entregue: 'Entregue',
  esgotado: 'Esgotado',
  suspenso: 'Suspenso',
}

function toNumber(value: NumericLike): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(typeof value === 'object' ? value.toString() : value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: string | null | undefined) {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

function publicStatus(property: PublicShareProperty): PublicShareStatus {
  if (property.sold) return 'vendido'
  if (property.kind === 'empreendimento') {
    if (property.propertyStatus === 'esgotado') return 'vendido'
    if (property.propertyStatus === 'suspenso') return 'indisponivel'
    return 'disponivel'
  }
  if (property.propertyStatus === 'vendido') return 'vendido'
  if (property.propertyStatus === 'reservado') return 'reservado'
  return 'disponivel'
}

/** full: rua e número · street: só a rua · neighborhood: só bairro e cidade */
export function publicLocation(property: Pick<
  PublicShareProperty,
  'address' | 'streetNumber' | 'neighborhood' | 'city' | 'state' | 'portalAddressDisplay'
>) {
  const street = text(property.address)
  const number = text(property.streetNumber)
  let line: string | null = null
  if (property.portalAddressDisplay === 'full') line = street ? [street, number].filter(Boolean).join(', ') : null
  else if (property.portalAddressDisplay !== 'neighborhood') line = street

  const neighborhood = text(property.neighborhood)
  const state = text(property.state)
  const query = [line, neighborhood, property.city, state].filter(Boolean).join(', ')
  return {
    line,
    neighborhood,
    city: property.city,
    state,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
  }
}

export function buildPublicShare(input: {
  property: PublicShareProperty
  showPrice: boolean
  broker: PublicShareBroker | null
  organizationName: string
  expiresAt: Date | null
}): PublicShare | UnavailableShare {
  const { property, showPrice, broker, organizationName, expiresAt } = input
  const organization = { name: organizationName }
  const expires = expiresAt ? expiresAt.toISOString() : null

  // Vendido continua mostrando o imóvel com o selo; fora do ar (sem ser venda) não mostra nada dele
  if (!property.active && !property.sold) {
    return { status: 'indisponivel', broker, organization, expiresAt: expires }
  }

  const isDevelopment = property.kind === 'empreendimento'
  const iptuValue = toNumber(property.iptuValue)

  return {
    status: publicStatus(property),
    kind: isDevelopment ? 'empreendimento' : 'revenda',
    title: property.title,
    typeLabel: isDevelopment ? 'Empreendimento' : (findPropertyType(property.propertyType)?.label ?? null),
    price: showPrice ? toNumber(isDevelopment ? property.startingPrice : property.price) : null,
    priceLabel: isDevelopment ? 'a partir de' : 'valor',
    maxPrice: showPrice && isDevelopment ? toNumber(property.maxPrice) : null,
    totalUnits: isDevelopment ? property.totalUnits : null,
    constructionStatusLabel: isDevelopment ? (CONSTRUCTION_STATUS_LABEL[property.propertyStatus ?? ''] ?? null) : null,
    location: publicLocation(property),
    specs: {
      livingArea: toNumber(property.areaM2),
      lotArea: toNumber(property.lotAreaM2),
      bedrooms: property.bedrooms,
      suites: property.suites,
      bathrooms: property.bathrooms,
      parking: property.parkingSpots,
      unitFloor: property.unitFloor,
      buildingFloors: property.buildingFloors,
      yearBuilt: property.yearBuilt,
    },
    conditions: {
      condoFee: toNumber(property.condoFee),
      iptu:
        iptuValue === null
          ? null
          : { value: iptuValue, period: property.iptuPeriod === 'anual' || property.iptuPeriod === 'mensal' ? property.iptuPeriod : null },
      acceptsFgts: property.acceptsFgts,
      acceptsFinancing: property.acceptsFinancing,
    },
    features: property.features
      .map((value) => PROPERTY_FEATURES.find((feature) => feature.value === value))
      .filter((feature): feature is { value: string; label: string } => feature !== undefined)
      .map((feature) => ({ value: feature.value, label: feature.label })),
    description: text(property.description),
    // Upload de fotos é a próxima etapa
    photos: [],
    broker,
    organization,
    expiresAt: expires,
  }
}

/** Colunas lidas do banco para a carga pública (select explícito, sem complemento, CEP etc.) */
export const PUBLIC_PROPERTY_SELECT = {
  kind: true,
  title: true,
  description: true,
  propertyType: true,
  propertyStatus: true,
  sold: true,
  active: true,
  price: true,
  startingPrice: true,
  maxPrice: true,
  totalUnits: true,
  address: true,
  streetNumber: true,
  neighborhood: true,
  city: true,
  state: true,
  portalAddressDisplay: true,
  areaM2: true,
  lotAreaM2: true,
  bedrooms: true,
  suites: true,
  bathrooms: true,
  parkingSpots: true,
  unitFloor: true,
  buildingFloors: true,
  yearBuilt: true,
  condoFee: true,
  iptuValue: true,
  iptuPeriod: true,
  acceptsFgts: true,
  acceptsFinancing: true,
  features: true,
} as const satisfies Record<keyof PublicShareProperty, true>
