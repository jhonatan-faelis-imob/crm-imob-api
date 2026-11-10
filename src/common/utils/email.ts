/** E-mail sempre em minúsculas e sem espaços nas pontas (cadastro, edição e login) */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Para DTOs: @Transform(trimLowerEmail) antes do @IsEmail */
export function trimLowerEmail({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeEmail(value) : value
}
