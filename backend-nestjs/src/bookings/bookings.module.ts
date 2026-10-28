import { Module } from '@nestjs/common';
import { ComplexesModule } from '../complexes/complexes.module';
import { BookingsController } from './bookings.controller';
import { BookingsGateway } from './bookings.gateway';
import { BookingsService } from './bookings.service';

@Module({
  imports: [ComplexesModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsGateway],
  exports: [BookingsService],
})
export class BookingsModule {}
