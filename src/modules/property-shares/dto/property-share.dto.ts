import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator'
import { SHARE_EXPIRATION_DAYS } from '../public-share'

export class CreatePropertyShareDto {
  @IsUUID()
  propertyId: string

  @IsOptional()
  @IsUUID()
  leadId?: string

  @IsOptional()
  @Type(() => Number)
  @IsIn(SHARE_EXPIRATION_DAYS, { message: 'expiresInDays deve ser 7, 30 ou 90' })
  expiresInDays?: (typeof SHARE_EXPIRATION_DAYS)[number]

  @IsOptional()
  @IsBoolean()
  showPrice?: boolean
}

export class ListPropertySharesDto {
  @IsUUID()
  propertyId: string
}

export class MarkShareSentDto {
  @IsIn(['whatsapp', 'link'])
  channel: 'whatsapp' | 'link'

  @IsOptional()
  @IsBoolean()
  linkToLead?: boolean
}
