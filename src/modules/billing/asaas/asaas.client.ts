import { BadGatewayException, BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type {
  AsaasCustomer,
  AsaasCustomerInput,
  AsaasList,
  AsaasPayment,
  AsaasSubscription,
  AsaasSubscriptionInput,
  AsaasSubscriptionUpdate,
} from './asaas.types'

// Cliente HTTP do Asaas (API v3). Chave no cabeçalho access_token, vinda de ASAAS_API_KEY; nunca vai para log
// nem para mensagens de erro. ASAAS_ENV=production usa a API de produção; qualquer outro valor, o sandbox

export const ASAAS_URLS = {
  production: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
} as const

const TIMEOUT_MS = 15_000
const RETRIES = 2
const BACKOFF_MS = [500, 1500]

/** Erro de rede ou 5xx: pode tentar de novo */
class RetryableError extends Error {}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** Mensagem do Asaas ({ errors: [{ code, description }] }) sem nada da requisição */
export function asaasErrorMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const errors = (body as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return null
  const descriptions = errors
    .map((item) => (typeof item === 'object' && item !== null ? (item as { description?: unknown }).description : null))
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
  return descriptions.length > 0 ? descriptions.join(' ') : null
}

@Injectable()
export class AsaasClient {
  private readonly logger = new Logger(AsaasClient.name)
  /** Trocável nos testes */
  fetcher: Fetcher = (url, init) => fetch(url, init)
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  constructor(private config: ConfigService) {}

  baseUrl(): string {
    return this.config.get<string>('ASAAS_ENV') === 'production' ? ASAAS_URLS.production : ASAAS_URLS.sandbox
  }

  private apiKey(): string {
    const key = this.config.get<string>('ASAAS_API_KEY')
    if (!key) throw new ServiceUnavailableException('Pagamento online indisponível: ASAAS_API_KEY não configurada')
    return key
  }

  private async request<T>(method: Method, path: string, body?: object): Promise<T> {
    const key = this.apiKey()
    const url = `${this.baseUrl()}${path}`
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, url, key, body)
      } catch (error) {
        if (!(error instanceof RetryableError) || attempt >= RETRIES) {
          if (error instanceof RetryableError) {
            // Só método, caminho e motivo: nunca a chave nem o corpo
            this.logger.warn(`Asaas indisponível: ${method} ${path} (${error.message})`)
            throw new BadGatewayException('O Asaas não respondeu. Tente de novo em instantes.')
          }
          throw error
        }
        await this.sleep(BACKOFF_MS[attempt] ?? 3000)
      }
    }
  }

  private async once<T>(method: Method, url: string, key: string, body?: object): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let response: Response
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'smart-crm',
          access_token: key,
        },
        // GET com corpo dá 403 no Asaas
        body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
    } catch (error) {
      throw new RetryableError(error instanceof Error && error.name === 'AbortError' ? 'tempo esgotado' : 'erro de rede')
    } finally {
      clearTimeout(timer)
    }

    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }

    if (response.status >= 500) throw new RetryableError(`HTTP ${response.status}`)
    if (!response.ok) {
      // 4xx: nunca repete. A mensagem é a do Asaas
      const message = asaasErrorMessage(parsed) ?? `O Asaas recusou a operação (HTTP ${response.status})`
      if (response.status === 401) {
        this.logger.error('Asaas recusou a chave da API (HTTP 401): conferir ASAAS_API_KEY e ASAAS_ENV')
        throw new ServiceUnavailableException('Pagamento online indisponível no momento')
      }
      throw new BadRequestException(`Asaas: ${message}`)
    }
    return parsed as T
  }

  createCustomer(input: AsaasCustomerInput) {
    return this.request<AsaasCustomer>('POST', '/customers', input)
  }

  updateCustomer(id: string, input: Partial<AsaasCustomerInput>) {
    return this.request<AsaasCustomer>('PUT', `/customers/${encodeURIComponent(id)}`, input)
  }

  createSubscription(input: AsaasSubscriptionInput) {
    return this.request<AsaasSubscription>('POST', '/subscriptions', input)
  }

  getSubscription(id: string) {
    return this.request<AsaasSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`)
  }

  updateSubscription(id: string, input: AsaasSubscriptionUpdate) {
    return this.request<AsaasSubscription>('PUT', `/subscriptions/${encodeURIComponent(id)}`, input)
  }

  deleteSubscription(id: string) {
    return this.request<{ deleted: boolean; id: string }>('DELETE', `/subscriptions/${encodeURIComponent(id)}`)
  }

  listSubscriptionPayments(id: string) {
    return this.request<AsaasList<AsaasPayment>>('GET', `/subscriptions/${encodeURIComponent(id)}/payments`)
  }
}
