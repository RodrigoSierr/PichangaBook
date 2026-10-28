import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthUser, UserRole } from '../types';

export const ROLES_KEY = 'roles';
export const PUBLIC_KEY = 'isPublic';

/** Restringe un endpoint a ciertos roles (p.ej. @Roles('OWNER')). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
/** Marca un endpoint como público (sin JWT). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user,
);

/**
 * Guard global: valida el Bearer JWT y aplica control de acceso por rol.
 * En endpoints @Public() decodifica el token si viene (opcional).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets);
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (token) {
      try {
        req.user = await this.jwt.verifyAsync<AuthUser>(token);
      } catch {
        if (!isPublic) throw new UnauthorizedException('Sesión inválida o expirada');
      }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Inicia sesión con tu código SMS');
    if (roles?.length && !roles.includes(req.user.role) && req.user.role !== 'ADMIN') {
      throw new ForbiddenException(`Acción permitida sólo para: ${roles.join(', ')}`);
    }
    return true;
  }
}
