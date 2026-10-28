import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Public, Roles } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { isValidDate, limaToday } from '../common/utils/time.util';
import { isValidRuc } from '../common/utils/ruc.util';
import { AvailabilityService } from './availability.service';
import { ComplexesService } from './complexes.service';
import { CreateComplexDto, DateQuery, ListComplexesQuery, ReviewDto, VerificationDto } from './dto/complexes.dto';

@Controller()
export class ComplexesController {
  constructor(
    private readonly complexes: ComplexesService,
    private readonly availability: AvailabilityService,
  ) {}

  @Public()
  @Get('districts')
  districts() {
    return this.complexes.districts();
  }

  @Public()
  @Get('complexes')
  list(@Query() query: ListComplexesQuery) {
    return this.complexes.list(query);
  }

  @Public()
  @Get('complexes/:id')
  detail(@Param('id') id: string) {
    return this.complexes.detail(id);
  }

  @Public()
  @Get('courts/:id/availability')
  courtAvailability(@Param('id') id: string, @Query() q: DateQuery) {
    const date = q.date ?? limaToday();
    if (!isValidDate(date)) throw new BadRequestException('Fecha inválida');
    return this.availability.courtGrid(id, date);
  }

  @Post('complexes/:id/reviews')
  addReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewDto,
  ) {
    return this.complexes.addReview(id, user, dto);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('complexes')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateComplexDto) {
    return this.complexes.create(user, dto);
  }

  /** Subida de ficha RUC o licencia de funcionamiento municipal (validación documental). */
  @Roles('OWNER', 'ADMIN')
  @Post('complexes/:id/verification-document')
  @UseInterceptors(FileInterceptor('document'))
  uploadDoc(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: any,
  ) {
    return this.complexes.uploadVerificationDocument(id, user, file);
  }

  @Roles('ADMIN', 'OWNER')
  @Patch('complexes/:id/verification')
  setVerification(@Param('id') id: string, @Body() dto: VerificationDto) {
    return this.complexes.setVerification(id, dto);
  }

  @Public()
  @Get('ruc/:ruc/validate')
  validateRuc(@Param('ruc') ruc: string) {
    return {
      ruc,
      valid: isValidRuc(ruc),
      type: ruc.startsWith('20') ? 'PERSONA_JURIDICA' : ruc.startsWith('10') ? 'PERSONA_NATURAL' : 'OTRO',
    };
  }
}
