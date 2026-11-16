import { ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsUUID } from 'class-validator'

export const TRANSFER_KINDS = ['leads', 'tasks', 'properties'] as const
export type TransferKind = (typeof TRANSFER_KINDS)[number]

export class TransferPortfolioDto {
  @IsUUID()
  toUserId: string

  @IsArray()
  @ArrayNotEmpty({ message: 'Escolha o que transferir' })
  @ArrayUnique()
  @IsIn(TRANSFER_KINDS, { each: true })
  what: TransferKind[]
}
