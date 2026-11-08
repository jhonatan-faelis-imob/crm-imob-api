import { Module } from '@nestjs/common'
import { CadencesController } from './cadences.controller'
import { CadencesService } from './cadences.service'

@Module({
  providers: [CadencesService],
  controllers: [CadencesController],
  exports: [CadencesService],
})
export class CadencesModule {}
