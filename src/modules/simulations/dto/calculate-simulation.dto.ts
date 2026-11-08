import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator'
import { SIMULATION_LIMITS } from '../simulation.config'

const money = { maxDecimalPlaces: 2 }

export class CalculateSimulationDto {
  @IsNumber(money, { message: 'Informe a renda' })
  @Min(0.01, { message: 'Informe a renda' })
  @Max(SIMULATION_LIMITS.maxIncome, { message: 'A renda passa do limite da simulação' })
  income: number

  @IsOptional()
  @IsNumber(money)
  @Min(0)
  @Max(SIMULATION_LIMITS.maxIncome)
  spouseIncome?: number

  @IsOptional()
  @IsNumber(money)
  @Min(0)
  fgts?: number

  @IsOptional()
  @IsNumber(money)
  @Min(0)
  ownResources?: number

  @IsOptional()
  @IsNumber(money)
  @Min(0)
  subsidy?: number

  @IsOptional()
  @IsBoolean()
  useFgts?: boolean

  @IsOptional()
  @IsBoolean()
  hasClt3Years?: boolean

  @IsOptional()
  @IsNumber()
  @Min(SIMULATION_LIMITS.commitmentPct.min)
  @Max(SIMULATION_LIMITS.commitmentPct.max)
  commitmentPct?: number

  @IsOptional()
  @IsNumber()
  @Min(SIMULATION_LIMITS.termFactor.min)
  @Max(SIMULATION_LIMITS.termFactor.max)
  termFactor?: number

  @IsOptional()
  @IsNumber()
  @Min(SIMULATION_LIMITS.financingPct.min)
  @Max(SIMULATION_LIMITS.financingPct.max)
  financingPct?: number

  @IsOptional()
  @IsBoolean()
  includeProperties?: boolean
}
