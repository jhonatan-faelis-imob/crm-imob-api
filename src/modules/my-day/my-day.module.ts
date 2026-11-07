import { Module } from '@nestjs/common'
import { MyDayController } from './my-day.controller'
import { MyDayService } from './my-day.service'

@Module({
  providers: [MyDayService],
  controllers: [MyDayController],
})
export class MyDayModule {}
