import { Controller, Get } from '@nestjs/common'
import { Public } from '../../common/decorators/public.decorator'

// Rota leve para healthcheck (Railway): não consulta o banco.
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' }
  }
}
