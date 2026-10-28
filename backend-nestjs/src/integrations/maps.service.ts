import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app.config';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Google Maps Platform (Geocoding + Distance Matrix).
 * - Con GOOGLE_MAPS_API_KEY: llama a la API oficial.
 * - Sin clave (demo): fallback con centroide del distrito y distancia Haversine.
 */
@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  static readonly AREQUIPA_CENTER: GeoPoint = { lat: -16.3989, lng: -71.535 };

  constructor(private readonly cfg: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.cfg.googleMapsApiKey);
  }

  /** Distancia en línea recta (km) - fórmula de Haversine. */
  static haversineKm(a: GeoPoint, b: GeoPoint): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100;
  }

  /** Geocoding: dirección → coordenadas (sesgado a Arequipa, Perú). */
  async geocode(address: string, fallback?: GeoPoint): Promise<GeoPoint & { source: string; formatted?: string }> {
    if (this.enabled) {
      try {
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        url.searchParams.set('address', `${address}, Arequipa, Perú`);
        url.searchParams.set('region', 'pe');
        url.searchParams.set('components', 'country:PE|administrative_area:Arequipa');
        url.searchParams.set('key', this.cfg.googleMapsApiKey);
        const res = await fetch(url);
        const json = (await res.json()) as {
          status: string;
          results: { formatted_address: string; geometry: { location: GeoPoint } }[];
        };
        if (json.status === 'OK' && json.results[0]) {
          const r = json.results[0];
          return { ...r.geometry.location, source: 'google', formatted: r.formatted_address };
        }
        this.logger.warn(`Geocoding sin resultados (${json.status}) para "${address}"`);
      } catch (e) {
        this.logger.error(`Error Geocoding API: ${(e as Error).message}`);
      }
    }
    return { ...(fallback ?? MapsService.AREQUIPA_CENTER), source: 'district-centroid' };
  }

  /** Distancia por ruta (Distance Matrix) o Haversine en modo demo. */
  async distance(from: GeoPoint, to: GeoPoint): Promise<{ km: number; minutes: number | null; source: string }> {
    if (this.enabled) {
      try {
        const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
        url.searchParams.set('origins', `${from.lat},${from.lng}`);
        url.searchParams.set('destinations', `${to.lat},${to.lng}`);
        url.searchParams.set('key', this.cfg.googleMapsApiKey);
        const json = (await (await fetch(url)).json()) as any;
        const el = json?.rows?.[0]?.elements?.[0];
        if (el?.status === 'OK') {
          return { km: el.distance.value / 1000, minutes: Math.round(el.duration.value / 60), source: 'google' };
        }
      } catch (e) {
        this.logger.error(`Error Distance Matrix: ${(e as Error).message}`);
      }
    }
    const km = MapsService.haversineKm(from, to);
    return { km, minutes: Math.round((km / 22) * 60), source: 'haversine' }; // ~22 km/h tráfico urbano
  }
}
