import { phoneCandidateWhere, phoneContainsDigits, phoneSearchDigits } from './phone'

describe('phone: comparação ignorando a máscara', () => {
  it('phoneSearchDigits só aceita texto com cara de telefone e 4+ dígitos', () => {
    expect(phoneSearchDigits('+55 19 99546-1826')).toBe('19995461826')
    expect(phoneSearchDigits('(19) 99546-1826')).toBe('19995461826')
    expect(phoneSearchDigits(' 9954 ')).toBe('9954')
    expect(phoneSearchDigits('995')).toBeNull()
    expect(phoneSearchDigits('Maria 1999')).toBeNull()
    expect(phoneSearchDigits('')).toBeNull()
  })

  it('phoneContainsDigits ignora máscara e +55 do telefone salvo', () => {
    expect(phoneContainsDigits('+55 (19) 99546-1826', '19995461826')).toBe(true)
    expect(phoneContainsDigits('(19) 99546-1826', '995461826')).toBe(true)
    expect(phoneContainsDigits('(19) 99546-1826', '18261')).toBe(false)
    expect(phoneContainsDigits(null, '9954')).toBe(false)
  })

  it('phoneCandidateWhere usa os últimos 8 dígitos, puros e com o separador da máscara', () => {
    const fragments = (phoneCandidateWhere('19995461826').OR ?? []).map((item) => JSON.stringify(item))
    expect(fragments).toContain(JSON.stringify({ phone: { contains: '95461826' } }))
    expect(fragments).toContain(JSON.stringify({ phone: { contains: '9546-1826' } }))
    expect(fragments).toContain(JSON.stringify({ phone2: { contains: '9546 1826' } }))
    expect(fragments.some((item) => item.includes('19995461826'))).toBe(false)
  })
})
