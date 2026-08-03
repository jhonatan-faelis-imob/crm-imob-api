import {
  IsString, IsNotEmpty, IsOptional, IsEmail,
  IsIn, IsNumber, IsBoolean, IsUUID, IsDateString
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsNotEmpty()
  phone: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  phone2?: string

  @IsOptional()
  @IsIn(['interessado', 'proprietario'])
  profile?: string

  @IsIn(['instagram','facebook','indicacao','site','plantao','portais','outro'])
  source: string

  @IsIn(['compra','venda','locacao'])
  intent: string

  @IsOptional()
  @IsIn(['apartamento','casa','casa_condominio','sobrado','terreno','comercial','rural','kitnet','loft','outro'])
  propertyType?: string

  @IsOptional()
  @IsIn(['imediato','um_mes','tres_meses','seis_meses','sem_pressa'])
  urgency?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  interestValue?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  income?: number

  @IsOptional()
  @IsBoolean()
  hasClt3Years?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fgtsValue?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  ownResources?: number

  @IsOptional()
  @IsString()
  spouseName?: string

  @IsOptional()
  @IsString()
  spousePhone?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  spouseIncome?: number

  @IsOptional()
  @IsString()
  spouseCpf?: string

  @IsOptional()
  @IsString()
  cpf?: string

  @IsOptional()
  @IsString()
  rg?: string

  @IsOptional()
  @IsString()
  pis?: string

  @IsOptional()
  @IsDateString()
  birthDate?: string

  @IsOptional()
  @IsIn(['solteiro','casado','divorciado','viuvo','uniao_estavel'])
  maritalStatus?: string

  @IsOptional()
  @IsString()
  occupation?: string

  @IsOptional()
  @IsString()
  fatherName?: string

  @IsOptional()
  @IsString()
  motherName?: string

  @IsOptional()
  @IsString()
  birthplace?: string

  @IsOptional()
  @IsString()
  nationality?: string

  @IsOptional()
  @IsString()
  addressCep?: string

  @IsOptional()
  @IsString()
  addressStreet?: string

  @IsOptional()
  @IsString()
  addressNumber?: string

  @IsOptional()
  @IsString()
  addressComplement?: string

  @IsOptional()
  @IsString()
  addressNeighborhood?: string

  @IsOptional()
  @IsString()
  addressCity?: string

  @IsOptional()
  @IsString()
  addressState?: string

  @IsOptional()
  @IsUUID()
  ownerId?: string

  @IsOptional()
  @IsUUID()
  teamId?: string

  @IsOptional()
  @IsUUID()
  funnelStageId?: string

  @IsOptional()
  @IsString()
  notes?: string
}
