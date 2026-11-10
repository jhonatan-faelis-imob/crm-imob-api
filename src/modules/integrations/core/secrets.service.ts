import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// Cofre de segredos das integrações: AES-256-GCM com INTEGRATIONS_ENC_KEY (32 bytes em base64).
// Formato guardado: v1:<iv>:<tag>:<texto cifrado>, cada parte em base64.
// A chave só é lida na hora de cifrar/decifrar: sem ela o resto do sistema continua de pé.
// Nunca registrar em log o texto aberto nem a chave.

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

export class SecretsKeyError extends InternalServerErrorException {}
export class SecretsDecryptError extends InternalServerErrorException {}

/** ••••a1b2: só os 4 últimos caracteres */
export function maskSecret(value: string) {
  return `••••${value.slice(-4)}`
}

@Injectable()
export class SecretsService {
  constructor(private config: ConfigService) {}

  private key() {
    const raw = this.config.get<string>('INTEGRATIONS_ENC_KEY')
    if (!raw) throw new SecretsKeyError('INTEGRATIONS_ENC_KEY não configurada')
    const key = Buffer.from(raw, 'base64')
    if (key.length !== 32) throw new SecretsKeyError('INTEGRATIONS_ENC_KEY inválida: precisa ter 32 bytes em base64')
    return key
  }

  encrypt(plain: string) {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.key(), iv)
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':')
  }

  decrypt(stored: string) {
    const key = this.key()
    const parts = stored.split(':')
    if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretsDecryptError('Segredo guardado em formato desconhecido')
    const [, iv, tag, encrypted] = parts
    try {
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      throw new SecretsDecryptError('Não foi possível ler o segredo guardado (a INTEGRATIONS_ENC_KEY mudou?)')
    }
  }

  /** Os segredos de uma integração ficam num único JSON cifrado */
  encryptJson(values: Record<string, string>) {
    return this.encrypt(JSON.stringify(values))
  }

  decryptJson(stored: string | null): Record<string, string> {
    if (!stored) return {}
    const parsed: unknown = JSON.parse(this.decrypt(stored))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [name, value] of Object.entries(parsed)) if (typeof value === 'string') result[name] = value
    return result
  }
}
