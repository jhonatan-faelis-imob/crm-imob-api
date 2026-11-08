export interface DefaultRequirement {
  name: string
  category: 'pessoal' | 'renda' | 'fgts'
  holder: 'titular' | 'conjuge'
  required?: boolean
  appliesWhen?: 'always' | 'has_fgts'
}

// orderIndex é a posição nesta lista
export const DEFAULT_REQUIREMENTS: DefaultRequirement[] = [
  { name: 'Documento de identificação (RG ou CNH)', category: 'pessoal', holder: 'titular' },
  { name: 'CPF', category: 'pessoal', holder: 'titular' },
  { name: 'Certidão de estado civil (nascimento, casamento ou averbação)', category: 'pessoal', holder: 'titular' },
  { name: 'Comprovante de residência (últimos 90 dias)', category: 'pessoal', holder: 'titular' },
  {
    name: 'Comprovante de renda (3 últimos holerites, ou extratos e pró-labore se autônomo)',
    category: 'renda',
    holder: 'titular',
  },
  { name: 'Carteira de trabalho (CTPS digital)', category: 'renda', holder: 'titular' },
  { name: 'Declaração de Imposto de Renda (se declarante)', category: 'renda', holder: 'titular', required: false },
  { name: 'Extrato do FGTS', category: 'fgts', holder: 'titular', appliesWhen: 'has_fgts' },
  { name: 'Documento de identificação (RG ou CNH) do cônjuge', category: 'pessoal', holder: 'conjuge' },
  { name: 'CPF do cônjuge', category: 'pessoal', holder: 'conjuge' },
  { name: 'Comprovante de renda do cônjuge', category: 'renda', holder: 'conjuge' },
]
