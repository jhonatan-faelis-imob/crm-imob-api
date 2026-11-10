import { BadGatewayException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'
import { PrismaService } from '../../prisma/prisma.service'
import { AiSettingsService, type AiFeature } from './ai-settings.service'
import {
  buildPropertyDescriptionPrompt,
  parsePropertyDescription,
  type PropertyDescribeInput,
  type PropertyDescription,
} from './property-description'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private prisma: PrismaService,
    private settings: AiSettingsService,
  ) {}

  // Chave (própria da organização ou do sistema) e modelo (GEMINI_MODEL) a cada chamada.
  // Recurso desligado pelo gestor: 403 antes de qualquer chamada
  private async modelFor(organizationId: string, feature: AiFeature, generationConfig?: GenerationConfig) {
    const { apiKey, model } = await this.settings.resolve(organizationId, feature)
    return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model, generationConfig })
  }

  async analyzeLeadScore(organizationId: string, leadId: string) {
    const model = await this.modelFor(organizationId, 'leadScore')
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

  /** Título e descrição de imóvel de revenda. Falha do modelo ou resposta inválida viram 502 */
  async describeProperty(organizationId: string, input: PropertyDescribeInput): Promise<PropertyDescription> {
    const model = await this.modelFor(organizationId, 'propertyCopy', { responseMimeType: 'application/json' })
    try {
      const result = await model.generateContent(buildPropertyDescriptionPrompt(input))
      return parsePropertyDescription(result.response.text())
    } catch (error) {
      this.logger.warn(`Falha ao gerar descrição de imóvel: ${error instanceof Error ? error.message : String(error)}`)
      throw new BadGatewayException('Não foi possível gerar o texto agora. Tente de novo em instantes.')
    }
  }
}
