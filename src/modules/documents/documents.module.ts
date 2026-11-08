import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { DocumentsController } from './documents.controller'
import { DocumentsService } from './documents.service'

@Module({
  imports: [LeadsModule],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
