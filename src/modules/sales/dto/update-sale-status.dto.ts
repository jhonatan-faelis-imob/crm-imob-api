import { IsIn, IsOptional, IsString } from 'class-validator'

export class UpdateSaleStatusDto {
  @IsIn(['pendente','aprovado','contrato_assinado','concluido','cancelado'])
  status: string

  @IsOptional()
  @IsString()
  reason?: string
}
