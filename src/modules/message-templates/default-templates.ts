export const DEFAULT_TEMPLATES = [
  {
    name: 'Primeiro contato',
    type: 'primeiro_contato',
    content:
      '{{saudacao}}, {{primeiro_nome}}! Aqui é {{corretor}} da {{imobiliaria}}. Vi que você tem interesse em {{empreendimento}}. Posso te passar mais detalhes e valores? 😊',
  },
  {
    name: 'Follow-up',
    type: 'follow_up',
    content:
      '{{saudacao}}, {{primeiro_nome}}! Passando para saber se você conseguiu ver as informações que te enviei. Posso ajudar com alguma dúvida?',
  },
  {
    name: 'Agendamento de visita',
    type: 'agendamento',
    content:
      '{{primeiro_nome}}, vamos agendar a visita ao {{empreendimento}}? Me diz o melhor dia e horário para você que eu organizo tudo.',
  },
  {
    name: 'Pós-visita',
    type: 'pos_visita',
    content:
      '{{saudacao}}, {{primeiro_nome}}! O que você achou da visita ao {{empreendimento}}? Se quiser, já faço uma simulação para você.',
  },
  {
    name: 'Envio de proposta',
    type: 'proposta',
    content:
      '{{primeiro_nome}}, conforme combinado, segue a proposta para o {{empreendimento}}. Qualquer dúvida estou à disposição. Para avançarmos, preciso apenas dos seus documentos.',
  },
  {
    name: 'Cobrança de documentos',
    type: 'follow_up',
    content:
      '{{saudacao}}, {{primeiro_nome}}! Para dar andamento no seu processo, ainda preciso de alguns documentos. Consegue me enviar hoje?',
  },
  {
    name: 'Pós-venda',
    type: 'pos_venda',
    content:
      '{{primeiro_nome}}, parabéns pela conquista! 🎉 Se conhecer alguém que também está buscando um imóvel, ficarei feliz em ajudar.',
  },
]
