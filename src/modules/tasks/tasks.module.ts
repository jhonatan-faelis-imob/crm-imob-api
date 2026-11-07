import { Module } from '@nestjs/common'
import { InteractionsModule } from '../interactions/interactions.module'
import { TasksService } from './tasks.service'
import { TasksController } from './tasks.controller'

@Module({
  imports: [InteractionsModule],
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
