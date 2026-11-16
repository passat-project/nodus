import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { FeatureFlagsModule } from '../../core/feature-flags/feature-flags.module.js';
import { ROLE_MEMBERSHIP_READER } from '../../core/ports/role-membership.port.js';
import { RoleMembershipProvider } from '../../core/ports/role-membership.provider.js';
import { AUTH_PROVIDER } from './auth-provider.js';
import { getAuthConfig } from './auth.config.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { RoleAccessChangedHandler } from './events/role-access-changed.handler.js';
import { UserDeactivatedHandler } from './events/user-deactivated.handler.js';
import { UserRolesChangedHandler } from './events/user-roles-changed.handler.js';
import { IdentityLoader } from './identity.loader.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { LocalAuthProvider } from './local-auth.provider.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { RevokedUsersStore } from './revoked-users.store.js';
import { TokenService } from './token.service.js';

/**
 * Модуль auth (ядро): логин, JWT/refresh с ротацией, сессии.
 * AuthProvider — точка расширения (I13): сейчас LocalAuthProvider,
 * Keycloak/LDAP в V2 за тем же токеном. JwtAuthGuard экспортируется —
 * глобальная регистрация (APP_GUARD, первым) в AppModule.
 * Права сотрудника собирает `IdentityLoader` через порт
 * `ROLE_MEMBERSHIP_READER` (ADR-0012, ADR-0034 п. 4).
 */
@Module({
  imports: [
    // Включённые модули в карточке `/auth/me` (Р14 #52).
    FeatureFlagsModule,
    JwtModule.register({
      secret: getAuthConfig().jwtSecret,
      signOptions: { expiresIn: getAuthConfig().accessTtlSeconds },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    IdentityLoader,
    TokenService,
    JwtAuthGuard,
    UserDeactivatedHandler,
    UserRolesChangedHandler,
    RoleAccessChangedHandler,
    LoginThrottleService,
    RevokedUsersStore,
    { provide: AUTH_PROVIDER, useClass: LocalAuthProvider },
    { provide: ROLE_MEMBERSHIP_READER, useClass: RoleMembershipProvider },
  ],
  exports: [JwtAuthGuard, TokenService, JwtModule],
})
export class AuthModule {}
