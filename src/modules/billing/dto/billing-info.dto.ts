import { Transform } from 'class-transformer'
import { IsEmail, IsOptional, IsString, MaxLength, Validate, ValidateIf, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator'
import { trimLowerEmail } from '../../../common/utils/email'
import { isValidDocument } from '../document'

@ValidatorConstraint({ name: 'cpfCnpj' })
export class CpfCnpjConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidDocument(value)
  }
  defaultMessage() {
    return 'CPF ou CNPJ inválido'
  }
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)
const filled = (_: object, value: unknown) => typeof value === 'string' && value !== ''

/** Dados de cobrança. Vazio limpa o campo */
export class BillingInfoDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  billingName?: string

  /** CPF ou CNPJ, com ou sem máscara; gravado só com dígitos */
  @IsOptional()
  @Transform(trim)
  @ValidateIf(filled)
  @Validate(CpfCnpjConstraint)
  billingDocument?: string

  @IsOptional()
  @Transform(trimLowerEmail)
  @ValidateIf(filled)
  @IsEmail({}, { message: 'E-mail de cobrança inválido' })
  billingEmail?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  billingPhone?: string
}
