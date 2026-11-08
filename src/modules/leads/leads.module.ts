import { Module } from '@nestjs/common'
import { CadencesModule } from '../cadences/cadences.module'
import { LeadsService } from './leads.service'
import { LeadsController } from './leads.controller'

@Module({
  imports: [CadencesModule],
  providers: [LeadsService],
  controllers: [LeadsController],
  exports: [LeadsService],
})
export class LeadsModule {}
