import { IsOptional, IsString, IsBoolean, IsIn, IsDateString } from 'class-validator'

export class CompleteTaskDto {
  @IsOptional()
  @IsString()
  completionNotes?: string

  @IsOptional()
  @IsBoolean()
  createNextTask?: boolean

  @IsOptional()
  @IsIn(['ligacao','whatsapp','email','visita','reuniao','outro'])
  nextTaskType?: string

  @IsOptional()
  @IsString()
  nextTaskTitle?: string

  @IsOptional()
  @IsDateString()
  nextTaskDueDate?: string
}
