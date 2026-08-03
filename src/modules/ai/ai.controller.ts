import { Controller, Post, Param } from '@nestjs/common'
import { AiService } from './ai.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('ai')
export class AiController {
  constructor(private service: AiService) {}

  @Post('leads/:id/analyze')
  analyzeLeadScore(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.analyzeLeadScore(user.organizationId, id)
  }
}
