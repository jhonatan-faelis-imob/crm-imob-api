export interface DefaultCadenceStep {
  stage: string
  offsetDays: number
  type: 'ligacao' | 'whatsapp'
  title: string
}

// `stage` é o nome normalizado (sem acento, minúsculo); etapa ausente na organização é ignorada
export const DEFAULT_CADENCE_STEPS: DefaultCadenceStep[] = [
  { stage: 'contato', offsetDays: 2, type: 'whatsapp', title: 'Follow-up: retomar conversa com {{primeiro_nome}}' },
  { stage: 'qualificacao', offsetDays: 1, type: 'ligacao', title: 'Confirmar renda e coletar documentos de {{primeiro_nome}}' },
  { stage: 'qualificacao', offsetDays: 3, type: 'whatsapp', title: 'Cobrar documentos pendentes de {{primeiro_nome}}' },
  { stage: 'simulacao', offsetDays: 1, type: 'whatsapp', title: 'Enviar a simulação e tirar dúvidas com {{primeiro_nome}}' },
  { stage: 'simulacao', offsetDays: 3, type: 'ligacao', title: 'Retorno da simulação: {{nome}}' },
  { stage: 'agendamento', offsetDays: 1, type: 'ligacao', title: 'Confirmar o horário da visita com {{primeiro_nome}}' },
  { stage: 'agendamento', offsetDays: 3, type: 'whatsapp', title: 'Pós-visita: ouvir o feedback de {{primeiro_nome}}' },
  { stage: 'negociacao', offsetDays: 1, type: 'ligacao', title: 'Acompanhar a proposta com {{primeiro_nome}}' },
  { stage: 'negociacao', offsetDays: 3, type: 'ligacao', title: 'Fechar pendências com {{primeiro_nome}}' },
  { stage: 'ganho', offsetDays: 30, type: 'whatsapp', title: 'Pós-venda: pedir indicação a {{primeiro_nome}}' },
]
