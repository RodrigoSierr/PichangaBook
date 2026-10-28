import { Global, Module } from '@nestjs/common';
import { CulqiService } from './culqi.service';
import { MapsService } from './maps.service';
import { MediaService } from './media.service';

/** Adaptadores de servicios externos (Google Maps, Cloudinary/S3, Culqi). */
@Global()
@Module({
  providers: [MapsService, MediaService, CulqiService],
  exports: [MapsService, MediaService, CulqiService],
})
export class IntegrationsModule {}
