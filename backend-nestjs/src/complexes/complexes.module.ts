import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { ComplexesController } from './complexes.controller';
import { ComplexesService } from './complexes.service';

@Module({
  controllers: [ComplexesController],
  providers: [ComplexesService, AvailabilityService],
  exports: [ComplexesService, AvailabilityService],
})
export class ComplexesModule {}
