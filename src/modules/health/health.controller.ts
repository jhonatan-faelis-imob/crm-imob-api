import { AllowWhenBlocked } from '../../common/decorators/allow-when-blocked.decorator'
import { Controller, Get } from '@nestjs/common'
import { Public } from '../../common/decorators/public.decorator'

const STARTED_AT = new Date().toISOString()

// Rota leve para healthcheck (Railway): não consulta o banco. commit e startedAt mostram qual versão está no ar
@Controller('health')
@AllowWhenBlocked()
export class HealthController {
  @Public()
  @Get()
  check() {
    const sha = process.env.RAILWAY_GIT_COMMIT_SHA
    return { status: 'ok', commit: sha ? sha.slice(0, 7) : null, startedAt: STARTED_AT }
  }
}
