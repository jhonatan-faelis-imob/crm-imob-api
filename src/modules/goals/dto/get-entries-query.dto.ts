import { IsDateString, IsOptional, Matches } from 'class-validator'

const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/
const DAY_MESSAGE = 'Use a data no formato YYYY-MM-DD'

export class GetEntriesQueryDto {
  @IsOptional()
  @Matches(DAY_FORMAT, { message: DAY_MESSAGE })
  @IsDateString({ strict: true }, { message: DAY_MESSAGE })
  from?: string

  @IsOptional()
  @Matches(DAY_FORMAT, { message: DAY_MESSAGE })
  @IsDateString({ strict: true }, { message: DAY_MESSAGE })
  to?: string
}
