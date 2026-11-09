import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'courtId debe ser un UUID válido',
  })
  courtId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Fecha en formato YYYY-MM-DD' })
  date: string;

  @Type(() => Number)
  @IsInt()
  @Min(6)
  @Max(23)
  hour: number;

  @IsIn(['FULL_DEPOSIT', 'SPLIT'])
  paymentMode: 'FULL_DEPOSIT' | 'SPLIT';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(22)
  totalSlots?: number;

  @IsOptional()
  @IsIn(['CARD', 'YAPE', 'PLIN'])
  method?: 'CARD' | 'YAPE' | 'PLIN';

  @IsString()
  @IsNotEmpty({ message: 'Se requiere el token de pago (sourceId) generado por la pasarela' })
  @MaxLength(80)
  sourceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  payerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;

  /**
   * Sólo para pruebas de compensación en modo demo: simula que la reserva fue invalidada
   * después de haberse ejecutado el cargo en la pasarela para verificar la reversa/reembolso.
   */
  @IsOptional()
  @IsBoolean()
  simulatePostChargeConflict?: boolean;
}

export class ReceptionBlockDto {
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'courtId debe ser un UUID válido',
  })
  courtId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Fecha en formato YYYY-MM-DD' })
  date: string;

  @Type(() => Number)
  @IsInt()
  @Min(6)
  @Max(23)
  hour: number;

  @IsOptional()
  @IsIn(['RECEPTION', 'PHONE', 'WHATSAPP'])
  channel?: 'RECEPTION' | 'PHONE' | 'WHATSAPP';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}

export class PaySplitSlotDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  payerName: string;

  @IsIn(['CARD', 'YAPE', 'PLIN'])
  method: 'CARD' | 'YAPE' | 'PLIN';

  @IsString()
  @IsNotEmpty({ message: 'Se requiere el token de pago (sourceId) generado por la pasarela' })
  @MaxLength(80)
  sourceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}
