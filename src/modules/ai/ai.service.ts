import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class AiService {
  private genAI: GoogleGenerativeAI

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.genAI = new GoogleGenerativeAI(this.config.get<string>('gemini.apiKey') ?? '')
  }

  async analyzeLeadScore(organizationId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId },
      include: {
        interactions: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
        },
        tasks: {
          where: { status: 'concluida' },
          orderBy: { completedAt: 'desc' },
          take: 10,
        },
      },
    })

    if (!lead) throw new InternalServerErrorException('Lead não encontrado')

    const prompt = `
Você é um especialista em vendas imobiliárias. Analise o perfil do cliente abaixo e retorne APENAS um JSON válido, sem markdown, sem explicação.

PERFIL DO CLIENTE:
- Nome: ${lead.name}
- Interesse: ${lead.intent} de ${lead.propertyType ?? 'imóvel'}
- Renda: ${lead.income ? `R$ ${lead.income}` : 'Não informada'}
- FGTS: ${lead.fgtsValue ? `R$ ${lead.fgtsValue}` : 'Não informado'}
- Recursos próprios: ${lead.ownResources ? `R$ ${lead.ownResources}` : 'Não informado'}
- Urgência: ${lead.urgency}
- Status atual: ${lead.status}
- Dias desde cadastro: ${Math.floor((Date.now() - lead.createdAt.getTime()) / 86400000)}
- Total de interações: ${lead.interactions.length}

HISTÓRICO DE INTERAÇÕES (últimas 10):
${lead.interactions.slice(0, 10).map(i => `- ${i.type.toUpperCase()} em ${i.occurredAt.toLocaleDateString('pt-BR')}: ${i.notes.slice(0, 100)}`).join('\n')}

Retorne SOMENTE este JSON:
{
  "score": <número de 0 a 100>,
  "summary": "<análise resumida em 2-3 frases>",
  "nextSteps": ["<passo 1>", "<passo 2>", "<passo 3>"],
  "hotLevel": "<frio|morno|quente|muito_quente>"
}
`

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      const result = await model.generateContent(prompt)
      const text = result.response.text().trim()
      const parsed = JSON.parse(text)

      // Salvar resultado no lead
      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          aiScore: parsed.score,
          aiSummary: parsed.summary,
          aiNextSteps: parsed.nextSteps.join('\n'),
          aiUpdatedAt: new Date(),
        },
      })

      return parsed
    } catch (error) {
      throw new InternalServerErrorException('Erro ao analisar lead com IA')
    }
  }
}
