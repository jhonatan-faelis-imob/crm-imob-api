// Lista única das origens de lead (valor gravado + rótulo). O front espelha esta lista em
// src/features/leads/sources.ts: ao acrescentar uma origem aqui, acrescentar lá também
export const LEAD_SOURCES = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'site', label: 'Site' },
  { value: 'plantao', label: 'Plantão' },
  { value: 'portais', label: 'Portais' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'zap_imoveis', label: 'ZAP Imóveis' },
  { value: 'vivareal', label: 'VivaReal' },
  { value: 'olx', label: 'OLX' },
  { value: 'chaves_na_mao', label: 'Chaves na Mão' },
  { value: 'outro', label: 'Outro' },
] as const

export type LeadSourceValue = (typeof LEAD_SOURCES)[number]['value']

export const LEAD_SOURCE_VALUES: LeadSourceValue[] = LEAD_SOURCES.map((source) => source.value)

export function leadSourceLabel(value: string) {
  return LEAD_SOURCES.find((source) => source.value === value)?.label ?? value
}
