import { allowedOrigins, isOriginAllowed, normalizeOrigin, primaryFrontendUrl } from './cors'

const SITE = 'https://www.smartcrm.digital'

describe('CORS: comparação de origens', () => {
  it('aceita o endereço com barra no final (na variável ou na origem)', () => {
    expect(isOriginAllowed(SITE, allowedOrigins(`${SITE}/`))).toBe(true)
    expect(isOriginAllowed(`${SITE}/`, allowedOrigins(SITE))).toBe(true)
  })

  it('não diferencia maiúsculas', () => {
    expect(isOriginAllowed(SITE, allowedOrigins('https://WWW.SmartCRM.digital'))).toBe(true)
    expect(isOriginAllowed('HTTPS://www.SMARTCRM.digital', allowedOrigins(SITE))).toBe(true)
  })

  it('aceita espaço depois da vírgula e aspas em volta', () => {
    const allowed = allowedOrigins(`"https://smartcrm.digital, ${SITE} "`)
    expect(isOriginAllowed(SITE, allowed)).toBe(true)
    expect(isOriginAllowed('https://smartcrm.digital', allowed)).toBe(true)
  })

  it('com lista de três endereços, aceita os três e mantém o localhost', () => {
    const allowed = allowedOrigins(`https://smartcrm.digital,${SITE},https://crm-imob-front.vercel.app`)
    expect(allowed).toEqual([
      'http://localhost:3000',
      'https://smartcrm.digital',
      SITE,
      'https://crm-imob-front.vercel.app',
    ])
    for (const origin of allowed) expect(isOriginAllowed(origin, allowed)).toBe(true)
  })

  it('recusa origem fora da lista, inclusive parecida', () => {
    const allowed = allowedOrigins(`${SITE},https://smartcrm.digital`)
    expect(isOriginAllowed('https://evil.com', allowed)).toBe(false)
    expect(isOriginAllowed('https://www.smartcrm.digital.evil.com', allowed)).toBe(false)
    expect(isOriginAllowed('http://www.smartcrm.digital', allowed)).toBe(false)
  })

  it('ignora curingas e itens vazios', () => {
    const allowed = allowedOrigins('*.vercel.app, ,https://*.smartcrm.digital,')
    expect(allowed).toEqual(['http://localhost:3000'])
    expect(isOriginAllowed('https://qualquer.vercel.app', allowed)).toBe(false)
  })

  it('sem FRONTEND_URL, só o localhost', () => {
    expect(allowedOrigins(undefined)).toEqual(['http://localhost:3000'])
    expect(isOriginAllowed('http://localhost:3000/', allowedOrigins(undefined))).toBe(true)
  })

  it('normalizeOrigin e o primeiro endereço para links', () => {
    expect(normalizeOrigin(" 'https://WWW.smartcrm.digital//' ")).toBe(SITE)
    expect(primaryFrontendUrl(`${SITE}/, https://smartcrm.digital`)).toBe(SITE)
    expect(primaryFrontendUrl(undefined)).toBeUndefined()
  })
})
