import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

/** O diretor só muda o nome. Slug, plano e assinatura mudam pelo painel /admin */
export class UpdateMyOrganizationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string
}
