import { Module } from '@nestjs/common';

import { ROLE_MEMBERSHIP_READER } from '../../core/ports/role-membership.port.js';
import { RoleMembershipProvider } from '../../core/ports/role-membership.provider.js';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsRepository } from './departments.repository.js';
import { DepartmentsService } from './departments.service.js';
import { PositionsController } from './positions.controller.js';
import { PositionsRepository } from './positions.repository.js';
import { PositionsService } from './positions.service.js';
import { ReferenceGuard } from './reference-guard.service.js';
import { RoleAssignmentGuard } from './role-assignment-guard.service.js';
import { RoleMembersService } from './role-members.service.js';
import { RolesController } from './roles.controller.js';
import { RolesRepository } from './roles.repository.js';
import { RolesService } from './roles.service.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

/**
 * Модуль directory (ядро): пользователи, отделы (дерево, оба kind),
 * должности, роли. Провайдеры не экспортируются — другие модули
 * интегрируются событиями `directory.user.*` и `@nodus/contracts` (I3/I6).
 */
@Module({
  controllers: [UsersController, DepartmentsController, PositionsController, RolesController],
  providers: [
    UsersService,
    UsersRepository,
    DepartmentsService,
    DepartmentsRepository,
    PositionsService,
    PositionsRepository,
    RolesService,
    RoleMembersService,
    RoleAssignmentGuard,
    ReferenceGuard,
    RolesRepository,
    // bind-правило #490 считает добавленные роли портом; биндинг токена —
    // в модуле-потребителе (ADR-0012, как в workflows-ports.module).
    { provide: ROLE_MEMBERSHIP_READER, useClass: RoleMembershipProvider },
  ],
})
export class DirectoryModule {}
