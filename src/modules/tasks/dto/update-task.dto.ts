import { PartialType } from '@nestjs/mapped-types'
import { CreateTaskDto } from './create-task.dto'

// Classe real (não Partial<CreateTaskDto>, que é só tipo): o ValidationPipe valida e o corpo nunca chega undefined
export class UpdateTaskDto extends PartialType(CreateTaskDto) {}
