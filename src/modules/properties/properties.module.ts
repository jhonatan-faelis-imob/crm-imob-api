import { Module } from '@nestjs/common'
import { PropertiesService } from './properties.service'
import { PropertiesController } from './properties.controller'
import { AiModule } from '../ai/ai.module'
import { AiDescribeRateLimiter } from './ai-describe-rate-limiter'

@Module({
  imports: [AiModule],
  providers: [PropertiesService, AiDescribeRateLimiter],
  controllers: [PropertiesController],
  exports: [PropertiesService],
})
export class PropertiesModule {}
