import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { RealtimeModule } from './realtime/realtime.bus';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuthModule } from './auth/auth.module';
import { ComplexesModule } from './complexes/complexes.module';
import { BookingsModule } from './bookings/bookings.module';
import { SubstitutesModule } from './substitutes/substitutes.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    DatabaseModule,
    RealtimeModule,
    IntegrationsModule,
    AuthModule,
    ComplexesModule,
    BookingsModule,
    SubstitutesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
