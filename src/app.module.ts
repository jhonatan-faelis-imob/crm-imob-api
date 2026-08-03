import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { OrganizationsModule } from './modules/organizations/organizations.module'
import { TeamsModule } from './modules/teams/teams.module'
import { UsersModule } from './modules/users/users.module'
import { FunnelStagesModule } from './modules/funnel-stages/funnel-stages.module'
import { LeadsModule } from './modules/leads/leads.module'
import { InteractionsModule } from './modules/interactions/interactions.module'
import { TasksModule } from './modules/tasks/tasks.module'
import { PropertiesModule } from './modules/properties/properties.module'
import { SalesModule } from './modules/sales/sales.module'
import { GoalsModule } from './modules/goals/goals.module'
import { ReportsModule } from './modules/reports/reports.module'
import { AiModule } from './modules/ai/ai.module'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { RolesGuard } from './common/guards/roles.guard'
import { TenantInterceptor } from './common/interceptors/tenant.interceptor'
import configuration from './config/configuration'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    TeamsModule,
    UsersModule,
    FunnelStagesModule,
    LeadsModule,
    InteractionsModule,
    TasksModule,
    PropertiesModule,
    SalesModule,
    GoalsModule,
    ReportsModule,
    AiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
