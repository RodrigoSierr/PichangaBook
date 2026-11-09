import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { AuthUser, UserRole } from '../common/types';
import { normalizePhone } from '../common/utils/phone.util';
import { OtpService } from './otp.service';
import { AppConfig } from '../config/app.config';
import { UpdateProfileDto } from './dto/auth.dto';

export interface PublicUser {
  id: string;
  fullName: string;
  role: UserRole;
  phoneMasked: string;
  trustScore: number;
  createdAt: string;
}

const USER_COLUMNS = `id, full_name AS "fullName", role, phone_masked AS "phoneMasked",
                      trust_score AS "trustScore", is_banned AS "isBanned", created_at AS "createdAt"`;

const SEEDED_PHONES_BY_ROLE: Record<'ORGANIZER' | 'OWNER' | 'PLAYER', { phone: string; defaultName: string }> = {
  ORGANIZER: { phone: '+51958222333', defaultName: 'Diego Salas' },
  OWNER: { phone: '+51959111222', defaultName: 'Carlos Huamán' },
  PLAYER: { phone: '+51957333104', defaultName: 'Piero Medina' },
};

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly cfg: AppConfig,
  ) {}

  private phoneOrThrow(raw: string): string {
    const e164 = normalizePhone(raw);
    if (!e164) throw new BadRequestException('Número de celular inválido (ej. 959 111 222)');
    return e164;
  }

  async requestOtp(rawPhone: string) {
    const phone = this.phoneOrThrow(rawPhone);
    const existing = await this.db.one<{ fullName: string; role: string }>(
      `SELECT full_name AS "fullName", role FROM users WHERE phone_e164 = $1`,
      [phone],
    );
    return {
      ...this.otp.request(phone),
      isRegistered: Boolean(existing),
      existingName: existing?.fullName ?? null,
      role: existing?.role ?? null,
    };
  }

  async verifyOtp(rawPhone: string, code: string, fullName?: string, role?: UserRole) {
    const phone = this.phoneOrThrow(rawPhone);
    this.otp.verify(phone, code);
    return this.loginOrRegister(phone, 'DEMO', null, fullName, role);
  }

  async loginWithFirebase(idToken: string, fullName?: string, role?: UserRole) {
    const { uid, phone } = await this.otp.verifyFirebaseIdToken(idToken);
    return this.loginOrRegister(phone, 'FIREBASE', uid, fullName, role);
  }

  /**
   * Emite una sesión JWT firmada para una cuenta semilla verificada únicamente cuando el
   * entorno tiene habilitado explícitamente el modo demo local (`demoMode === true`).
   */
  async issueDemoSession(role: 'ORGANIZER' | 'OWNER' | 'PLAYER') {
    if (!this.cfg.demoMode || this.cfg.isProduction) {
      throw new ForbiddenException('Las sesiones rápidas de demostración están deshabilitadas fuera de modo demo local.');
    }
    const seed = SEEDED_PHONES_BY_ROLE[role];
    return this.loginOrRegister(seed.phone, 'DEMO', null, seed.defaultName, role);
  }

  /** Alta diferenciada por rol o login, y emisión del JWT. */
  private async loginOrRegister(
    phone: string,
    provider: string,
    authUid: string | null,
    fullName?: string,
    role?: UserRole,
  ) {
    let user = await this.db.one<PublicUser & { isBanned: boolean }>(
      `SELECT ${USER_COLUMNS} FROM users WHERE phone_e164 = $1`,
      [phone],
    );
    let isNew = false;
    if (!user) {
      if (!fullName || !role) {
        throw new BadRequestException({
          code: 'REGISTRATION_REQUIRED',
          message: 'Completa tu nombre y elige tu rol (ORGANIZER, PLAYER u OWNER).',
        });
      }
      user = await this.db.one<PublicUser & { isBanned: boolean }>(
        `INSERT INTO users (full_name, role, phone_e164, phone_verified_at, auth_provider, auth_uid)
         VALUES ($1, $2, $3, now(), $4, $5)
         RETURNING ${USER_COLUMNS}`,
        [fullName.trim(), role, phone, provider, authUid],
      );
      isNew = true;
    } else {
      const nextName = fullName?.trim() || user.fullName;
      user = await this.db.one<PublicUser & { isBanned: boolean }>(
        `UPDATE users
            SET full_name = $2,
                phone_verified_at = now(),
                updated_at = now()
          WHERE id = $1
          RETURNING ${USER_COLUMNS}`,
        [user.id, nextName],
      );
    }
    if (!user) throw new NotFoundException();
    if (user.isBanned) throw new ForbiddenException('Cuenta suspendida por reportes de la comunidad.');

    const payload: AuthUser = { sub: user.id, role: user.role, name: user.fullName };
    const accessToken = await this.jwt.signAsync(payload);
    const { isBanned: _ignored, ...publicUser } = user;
    return {
      accessToken,
      user: publicUser,
      isNew,
      authMode: this.cfg.integrationStatus.auth,
    };
  }

  async me(userId: string) {
    const user = await this.db.one<PublicUser & { isBanned: boolean }>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [userId],
    );
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const [stats] = await this.db.query<{
      bookingsCount: number;
      ownedComplexesCount: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM bookings WHERE organizer_id = $1 AND status NOT IN ('CANCELLED', 'EXPIRED')) AS "bookingsCount",
         (SELECT COUNT(*)::int FROM complexes WHERE owner_id = $1) AS "ownedComplexesCount"`,
      [userId],
    );
    const { isBanned: _ignored, ...publicUser } = user;
    return {
      ...publicUser,
      bookingsCount: stats?.bookingsCount ?? 0,
      ownedComplexesCount: stats?.ownedComplexesCount ?? 0,
    };
  }

  /**
   * Actualiza únicamente los datos editables del perfil (`full_name`).
   * Impide cualquier cambio o escalamiento de `role` mediante `/api/auth/me`:
   * ignora cualquier campo `role` entrante y conserva el rol original autorizado en la BD y en el JWT.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const existing = await this.db.one<PublicUser & { isBanned: boolean }>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [userId],
    );
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    const nextName = dto.fullName?.trim() || existing.fullName;

    const updated = await this.db.one<PublicUser & { isBanned: boolean }>(
      `UPDATE users
          SET full_name = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING ${USER_COLUMNS}`,
      [userId, nextName],
    );
    if (!updated) throw new NotFoundException('Usuario no encontrado');

    const payload: AuthUser = { sub: updated.id, role: existing.role, name: updated.fullName };
    const accessToken = await this.jwt.signAsync(payload);
    const { isBanned: _ignored, ...publicUser } = updated;
    return { accessToken, user: { ...publicUser, role: existing.role } };
  }

  get provider() {
    return this.cfg.authProvider;
  }
}
