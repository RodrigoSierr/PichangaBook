import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { AuthUser, UserRole } from '../common/types';
import { normalizePhone } from '../common/utils/phone.util';
import { OtpService } from './otp.service';
import { AppConfig } from '../config/app.config';

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
    return { ...this.otp.request(phone), isRegistered: Boolean(existing), role: existing?.role ?? null };
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
        throw new BadRequestException({ code: 'REGISTRATION_REQUIRED', message: 'Completa tu nombre y elige tu rol.' });
      }
      user = await this.db.one<PublicUser & { isBanned: boolean }>(
        `INSERT INTO users (full_name, role, phone_e164, phone_verified_at, auth_provider, auth_uid)
         VALUES ($1, $2, $3, now(), $4, $5)
         RETURNING ${USER_COLUMNS}`,
        [fullName.trim(), role, phone, provider, authUid],
      );
      isNew = true;
    } else {
      await this.db.query(`UPDATE users SET phone_verified_at = now(), updated_at = now() WHERE id = $1`, [user.id]);
    }
    if (!user) throw new NotFoundException();
    if (user.isBanned) throw new ForbiddenException('Cuenta suspendida por reportes de la comunidad.');

    const payload: AuthUser = { sub: user.id, role: user.role, name: user.fullName };
    const accessToken = await this.jwt.signAsync(payload);
    const { isBanned: _ignored, ...publicUser } = user;
    return { accessToken, user: publicUser, isNew };
  }

  async me(userId: string) {
    const user = await this.db.one(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  get provider() {
    return this.cfg.authProvider;
  }
}
