export type UserRole = 'PLAYER' | 'ORGANIZER' | 'OWNER' | 'ADMIN';

/** Payload firmado dentro del JWT emitido tras validar el OTP. */
export interface AuthUser {
  sub: string;
  role: UserRole;
  name: string;
}
