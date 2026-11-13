// Origens do CORS a partir de FRONTEND_URL (um ou vários endereços separados por vírgula)

export const LOCAL_ORIGIN = 'http://localhost:3000'

/** trim, sem aspas, sem barra no final e em minúsculas: "https://www.SmartCRM.digital/ " vira "https://www.smartcrm.digital" */
export function normalizeOrigin(value: string) {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** Endereços de FRONTEND_URL normalizados, sem vazios, sem curingas e sem repetição (na ordem em que vieram) */
export function frontendOrigins(frontendUrl: string | undefined) {
  const origins = (frontendUrl ?? '')
    .split(',')
    .map(normalizeOrigin)
    .filter((origin) => origin.length > 0 && !origin.includes('*'))
  return [...new Set(origins)]
}

/** Lista permitida: localhost:3000 sempre, mais os endereços de FRONTEND_URL */
export function allowedOrigins(frontendUrl: string | undefined) {
  return [...new Set([LOCAL_ORIGIN, ...frontendOrigins(frontendUrl)])]
}

/** Comparação exata depois de normalizar os dois lados; curinga nunca vale */
export function isOriginAllowed(origin: string, allowed: string[]) {
  return allowed.includes(normalizeOrigin(origin))
}

/** Primeiro endereço de FRONTEND_URL, para montar links (ex.: compartilhamento de imóvel) */
export function primaryFrontendUrl(frontendUrl: string | undefined) {
  return frontendOrigins(frontendUrl)[0]
}
