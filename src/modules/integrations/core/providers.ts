// Catálogo fixo dos provedores de integração. Os "em breve" não têm lógica nenhuma nesta etapa

export const PROVIDERS = ['google_ads', 'ai', 'grupo_olx', 'chaves_na_mao', 'meta'] as const
export type Provider = (typeof PROVIDERS)[number]

export type ProviderGroup = 'portais' | 'anuncios' | 'ia'

export type IntegrationStatus = 'desativada' | 'aguardando' | 'ativa' | 'erro' | 'em_breve'

export type EventStatus = 'ok' | 'ignorado' | 'erro' | 'teste'

export interface ProviderInfo {
  provider: Provider
  group: ProviderGroup
  name: string
  description: string
  comingSoon: boolean
  requirements: string[]
}

export const PROVIDER_CATALOG: ProviderInfo[] = [
  {
    provider: 'grupo_olx',
    group: 'portais',
    name: 'ZAP Imóveis, VivaReal e OLX',
    description: 'Publique os imóveis no Grupo OLX e receba os contatos dos anúncios como leads.',
    comingSoon: true,
    requirements: [
      'Fotos dos imóveis (mínimo 5)',
      'Conta no Canal Pro do Grupo OLX',
      'Imóveis marcados como prontos para os portais',
    ],
  },
  {
    provider: 'chaves_na_mao',
    group: 'portais',
    name: 'Chaves na Mão',
    description: 'Envie os imóveis para o Chaves na Mão pelo feed e receba os contatos.',
    comingSoon: true,
    requirements: ['Fotos dos imóveis', 'Autorização do portal para ler o seu feed'],
  },
  {
    provider: 'meta',
    group: 'anuncios',
    name: 'Facebook e Instagram',
    description: 'Receba os leads dos formulários de anúncios do Facebook e do Instagram.',
    comingSoon: true,
    requirements: ['Aprovação do aplicativo pela Meta', 'Página do Facebook vinculada ao anúncio'],
  },
  {
    provider: 'google_ads',
    group: 'anuncios',
    name: 'Google Ads',
    description: 'Os leads dos formulários do Google Ads entram direto no funil.',
    comingSoon: false,
    requirements: [],
  },
  {
    provider: 'ai',
    group: 'ia',
    name: 'Inteligência artificial',
    description: 'Análise de leads e textos de imóveis com o Gemini.',
    comingSoon: false,
    requirements: [],
  },
]

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}

/**
 * desativada: desligada. aguardando: ligada e sem nenhum evento ainda. erro: o último evento que conta
 * foi erro (lastError só é limpo por um ok/teste depois). ativa: o resto
 */
export function computeStatus(
  info: Pick<ProviderInfo, 'provider' | 'comingSoon'>,
  row: { enabled: boolean; lastEventAt: Date | null; lastError: string | null } | null,
  enabledByDefault = false,
): IntegrationStatus {
  if (info.comingSoon) return 'em_breve'
  const enabled = row ? row.enabled : enabledByDefault
  if (!enabled) return 'desativada'
  if (row?.lastError) return 'erro'
  // A IA não recebe nada de fora: ligada já é ativa
  if (info.provider !== 'ai' && !row?.lastEventAt) return 'aguardando'
  return 'ativa'
}
