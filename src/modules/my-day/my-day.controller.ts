import { Controller, Get, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { MyDayQueryDto, MyDaySummaryQueryDto } from './dto/my-day-query.dto'
import { MyDayService, type MyDayUser } from './my-day.service'

@Controller('my-day')
export class MyDayController {
  constructor(private service: MyDayService) {}

  @Get()
  getMyDay(@CurrentUser() user: MyDayUser, @Query() query: MyDayQueryDto) {
    return this.service.getMyDay(user, query.userId, query.limit)
  }

  @Get('summary')
  getSummary(@CurrentUser() user: MyDayUser, @Query() query: MyDaySummaryQueryDto) {
    return this.service.getSummary(user, query.userId)
  }
}
