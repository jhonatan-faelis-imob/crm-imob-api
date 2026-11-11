import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { AllowWhenBlocked } from '../../common/decorators/allow-when-blocked.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { SuperAdminGuard } from '../billing/super-admin'
import { AsaasBillingService } from '../billing/asaas/asaas-billing.service'
import { AsaasWebhookService } from '../billing/asaas/asaas-webhook.service'
import { AdminService } from './admin.service'
import {
  BlockOrganizationDto,
  CreateAdminOrganizationDto,
  ListAdminOrganizationsQueryDto,
  RegisterPaymentDto,
  UpdateAdminOrganizationDto,
} from './dto/admin-organization.dto'

type AdminUser = { email: string }

/** Painel do superadministrador (SUPER_ADMIN_EMAILS). Fora do SubscriptionGuard */
@Controller('admin')
@UseGuards(SuperAdminGuard)
@AllowWhenBlocked()
export class AdminController {
  constructor(
    private service: AdminService,
    private asaasBilling: AsaasBillingService,
    private webhooks: AsaasWebhookService,
  ) {}

  @Get('summary')
  summary() {
    return this.service.summary()
  }

  @Get('organizations')
  list(@Query() query: ListAdminOrganizationsQueryDto) {
    return this.service.list(query)
  }

  @Get('organizations/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id)
  }

  @Post('organizations')
  create(@CurrentUser() user: AdminUser, @Body() dto: CreateAdminOrganizationDto) {
    return this.service.create(dto, user.email)
  }

  @Patch('organizations/:id')
  update(@CurrentUser() user: AdminUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminOrganizationDto) {
    return this.service.update(id, dto, user.email)
  }

  @Post('organizations/:id/block')
  @HttpCode(200)
  block(@CurrentUser() user: AdminUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockOrganizationDto) {
    return this.service.block(id, dto, user.email)
  }

  @Post('organizations/:id/unblock')
  @HttpCode(200)
  unblock(@CurrentUser() user: AdminUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockOrganizationDto) {
    return this.service.unblock(id, dto, user.email)
  }

  @Post('organizations/:id/register-payment')
  @HttpCode(200)
  registerPayment(@CurrentUser() user: AdminUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RegisterPaymentDto) {
    return this.service.registerPayment(id, dto, user.email)
  }

  /** Relê assinatura e cobranças no Asaas e corrige a situação local */
  @Post('organizations/:id/sync-asaas')
  @HttpCode(200)
  syncAsaas(@CurrentUser() user: AdminUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.asaasBilling.sync(id, user.email)
  }

  /** Últimas 100 entregas de webhook, para depuração */
  @Get('webhooks')
  webhookDeliveries() {
    return this.webhooks.recent(100)
  }

  /** A tarefa diária, sob demanda (o projeto não tem @nestjs/schedule) */
  @Post('recalculate')
  @HttpCode(200)
  recalculate(@CurrentUser() user: AdminUser) {
    return this.service.recalculateSubscriptionStatuses(user.email)
  }
}
