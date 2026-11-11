// CPF e CNPJ pelo dígito verificador

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

function allSame(digits: string) {
  return /^(\d)\1+$/.test(digits)
}

export function isValidCpf(raw: string): boolean {
  const cpf = onlyDigits(raw)
  if (cpf.length !== 11 || allSame(cpf)) return false
  const digit = (length: number) => {
    let sum = 0
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10])
}

export function isValidCnpj(raw: string): boolean {
  const cnpj = onlyDigits(raw)
  if (cnpj.length !== 14 || allSame(cnpj)) return false
  const digit = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, weight, i) => acc + Number(cnpj[i]) * weight, 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13])
}

/** CPF (11 dígitos) ou CNPJ (14), com ou sem máscara */
export function isValidDocument(raw: string): boolean {
  const digits = onlyDigits(raw)
  return digits.length === 11 ? isValidCpf(digits) : digits.length === 14 ? isValidCnpj(digits) : false
}
