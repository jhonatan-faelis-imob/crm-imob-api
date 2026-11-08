import { Transform } from 'class-transformer'
import { ValidateBy, ValidateIf, type ValidationArguments, type ValidationOptions } from 'class-validator'
import { HTML_TAG } from '../portal.config'

/** Remove espaços das pontas de strings */
export function Trim() {
  return Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
}

/** Para colunas que não aceitam null: opcional, mas se vier precisa ser válido (null recusa) */
export function OptionalNotNull() {
  return ValidateIf((_object: object, value: unknown) => value !== undefined)
}

function isEmpreendimento(args: ValidationArguments) {
  return (args.object as { kind?: unknown }).kind === 'empreendimento'
}

/** Limite de caracteres só para revenda: empreendimentos não mudam */
export function ResaleMaxLength(max: number, options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'resaleMaxLength',
      constraints: [max],
      validator: {
        validate: (value: unknown, args?: ValidationArguments) =>
          (args !== undefined && isEmpreendimento(args)) || typeof value !== 'string' || value.length <= max,
        defaultMessage: (args?: ValidationArguments) => `${args?.property ?? 'Campo'} aceita no máximo ${max} caracteres`,
      },
    },
    options,
  )
}

/** Recusa qualquer tag HTML (só revenda) */
export function ResaleNoHtml(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'resaleNoHtml',
      validator: {
        validate: (value: unknown, args?: ValidationArguments) =>
          (args !== undefined && isEmpreendimento(args)) || typeof value !== 'string' || !HTML_TAG.test(value),
        defaultMessage: () => 'A descrição não pode conter HTML',
      },
    },
    options,
  )
}
