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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, Public, Roles } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { isValidDate, limaToday } from '../common/utils/time.util';
import { isValidRuc } from '../common/utils/ruc.util';
import { MAX_VERIFICATION_DOC_BYTES } from '../integrations/media.service';
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

  /**
   * Subida de ficha RUC o licencia de funcionamiento municipal.
   * Multer aplica `limits: { fileSize: 5 MB }` ANTES de cargar el archivo completo en memoria.
   * Conserva ownership: sólo el OWNER dueño del complejo o un ADMIN puede subir el documento.
   */
  @Roles('OWNER', 'ADMIN')
  @Post('complexes/:id/verification-document')
  @UseInterceptors(
    FileInterceptor('document', {
      limits: {
        fileSize: MAX_VERIFICATION_DOC_BYTES,
        files: 1,
      },
    }),
  )
  uploadDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: any,
  ) {
    return this.complexes.uploadVerificationDocument(id, user, file);
  }

  /**
   * Consulta autorizada del documento de verificación (conserva ownership para OWNER dueño del complejo o ADMIN).
   * Genera una URL temporal firmada con expiración corta.
   */
  @Roles('OWNER', 'ADMIN')
  @Get('complexes/:id/verification-document')
  getDocAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.complexes.getVerificationDocumentAccess(id, user);
  }

  /**
   * Descarga protegida desde almacenamiento privado mediante URL temporal firmada o JWT de OWNER/ADMIN.
   */
  @Public()
  @Get('complexes/:id/verification-document/download')
  async downloadDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('file') file: string | undefined,
    @Query('expires') expires: string | undefined,
    @Query('sig') sig: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
    @Res() res: Response,
  ) {
    const doc = await this.complexes.downloadVerificationDocument(id, { file, expires, sig }, user);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
    res.status(200).send(doc.buffer);
  }

  /**
   * Aprobación/rechazo documental: restringido EXCLUSIVAMENTE a un administrador (`@Roles('ADMIN')`).
   * Un propietario (`OWNER`) no puede asignarse `VERIFIED` a sí mismo.
   */
  @Roles('ADMIN')
  @Patch('complexes/:id/verification')
  async setVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: VerificationDto,
  ) {
    return this.complexes.setVerification(id, dto, user);
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
