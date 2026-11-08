import { findPropertyType, HTML_TAG, PORTAL_LIMITS, PROPERTY_FEATURES } from '../properties/portal.config'

// Título e descrição de imóvel de revenda pela IA. Funções puras: montar o prompt e tratar a resposta.

/** Só dados do imóvel: nunca rua, número, CEP nem dados do proprietário */
export interface PropertyDescribeInput {
  propertyType: string
  neighborhood: string
  city: string
  areaM2?: number
  lotAreaM2?: number
  bedrooms?: number
  suites?: number
  bathrooms?: number
  parkingSpots?: number
  unitFloor?: number
  yearBuilt?: number
  features?: string[]
  acceptsFgts?: boolean
  acceptsFinancing?: boolean
}

export interface PropertyDescription {
  title: string
  description: string
}

export class PropertyDescriptionParseError extends Error {}

function line(label: string, value: string | number | undefined | null) {
  return value === undefined || value === null || value === '' ? null : `- ${label}: ${value}`
}

export function buildPropertyDescriptionPrompt(input: PropertyDescribeInput) {
  const type = findPropertyType(input.propertyType)
  const featureLabels = (input.features ?? [])
    .map((value) => PROPERTY_FEATURES.find((feature) => feature.value === value)?.label)
    .filter((label): label is string => label !== undefined)

  const facts = [
    line('Tipo', type?.label ?? input.propertyType),
    line('Bairro', input.neighborhood),
    line('Cidade', input.city),
    line('Área útil (m²)', input.areaM2),
    line('Área total (m²)', input.lotAreaM2),
    line('Quartos', input.bedrooms),
    line('Suítes', input.suites),
    line('Banheiros', input.bathrooms),
    line('Vagas de garagem', input.parkingSpots),
    line('Andar', input.unitFloor),
    line('Ano de construção', input.yearBuilt),
    line('Características', featureLabels.length > 0 ? featureLabels.join(', ') : null),
    input.acceptsFgts === true ? '- Aceita FGTS: sim' : null,
    input.acceptsFinancing === true ? '- Aceita financiamento: sim' : null,
  ].filter((item): item is string => item !== null)

  return `Você escreve anúncios de imóveis à venda para portais imobiliários.

DADOS DO IMÓVEL (use somente estes):
${facts.join('\n')}

REGRAS:
- Português do Brasil.
- Título com 40 a 100 caracteres, sem emojis, sem CAIXA ALTA, sem telefone, e-mail ou link.
- Descrição com 300 a 900 caracteres, em parágrafos separados por uma linha em branco, sem HTML e sem markdown.
- Use somente os dados informados. Não invente nada: não diga "reformado", "vista livre", "andar alto", proximidades ou qualquer item que não esteja na lista.
${input.acceptsFgts === true || input.acceptsFinancing === true ? '- Cite que aceita FGTS e/ou financiamento, conforme informado.\n' : ''}- Linguagem neutra e sem discriminação de qualquer tipo.
- Não mencione endereço, número, CEP nem o proprietário.

Responda SOMENTE com este JSON, sem nada antes ou depois:
{"title": "...", "description": "..."}`
}

/** Corta no limite sem quebrar a última palavra */
export function cutAtWord(value: string, max: number) {
  if (value.length <= max) return value
  const slice = value.slice(0, max + 1)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : value.slice(0, max)).trim()
}

export function parsePropertyDescription(raw: string): PropertyDescription {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new PropertyDescriptionParseError('Resposta da IA não é JSON')
  }

  const record = parsed as { title?: unknown; description?: unknown } | null
  if (!record || typeof record.title !== 'string' || typeof record.description !== 'string') {
    throw new PropertyDescriptionParseError('Resposta da IA sem título ou descrição')
  }

  const title = cutAtWord(record.title.replace(/\s+/g, ' ').trim(), PORTAL_LIMITS.TITLE_MAX)
  const description = record.description
    .replace(new RegExp(HTML_TAG.source, 'g'), '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, PORTAL_LIMITS.DESC_MAX)
    .trim()

  if (!title || !description) throw new PropertyDescriptionParseError('Resposta da IA vazia')
  return { title, description }
}
