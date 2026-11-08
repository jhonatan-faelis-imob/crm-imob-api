import { PartialType } from '@nestjs/mapped-types'
import { CreatePropertyDto } from './create-property.dto'

// Antes o PATCH recebia Partial<CreatePropertyDto>, que o ValidationPipe não valida (o tipo some em runtime).
// skipNullProperties: false faz o null passar pelos validadores: campos que aceitam nulo já têm @IsOptional
// no CreatePropertyDto; title, city, publishToPortals etc. recusam null com 400 (antes seria 500 no Prisma).
export class UpdatePropertyDto extends PartialType(CreatePropertyDto, { skipNullProperties: false }) {}
