import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import {
  createUserSchema,
  listUsersQuerySchema,
  myOrganizationSchema,
  paginatedSchema,
  updateMyProfileSchema,
  updateUserSchema,
  userCardSchema,
  userListItemSchema,
  ErrorCode,
  Permission,
  type AuthUser,
  type CreateUserDto,
  type ListUsersQuery,
  type MyOrganization,
  type Paginated,
  type UpdateMyProfileDto,
  type UpdateUserDto,
  type UserCard,
  type UserListItem,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { UsersService } from './users.service.js';

/**
 * Справочник сотрудников (`/api/v1/directory/users`).
 * Чтение — directory.read, мутации — directory.manage (RBAC на API, I8);
 * саморедактирование профиля — любому аутентифицированному.
 */
@ApiTags('directory')
@ApiBearerAuth()
@Controller('directory/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(Permission.DIRECTORY_READ)
  @ApiOperation({ summary: 'Список сотрудников (курсорная пагинация, поиск)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(userListItemSchema) })
  @ApiErrors(400, 401, 403)
  list(
    @Query({ schema: listUsersQuerySchema, pipes: [new ZodValidationPipe(listUsersQuerySchema)] })
    query: ListUsersQuery,
  ): Promise<Paginated<UserListItem>> {
    return this.usersService.listUsers(query);
  }

  @Get('me/organization')
  @RequirePermissions(Permission.DIRECTORY_READ)
  @ApiOperation({
    summary: 'Кто я: профиль, руководитель, подразделение с путём, подчинённые',
  })
  @ApiOkResponse({ standardSchema: myOrganizationSchema })
  @ApiErrors(401, 403, 404)
  myOrganization(@GetUser() user: AuthUser): Promise<MyOrganization> {
    return this.usersService.myOrganization(user.id);
  }

  @Patch('me')
  @Audit({ action: 'directory.user.update_profile', entity: 'user' })
  @ApiOperation({ summary: 'Саморедактирование своего профиля (контактный блок)' })
  @ApiOkResponse({ standardSchema: userCardSchema })
  @ApiErrors(400, 401)
  updateMyProfile(
    @GetUser() user: AuthUser,
    @Body({ schema: updateMyProfileSchema, pipes: [new ZodValidationPipe(updateMyProfileSchema)] })
    dto: UpdateMyProfileDto,
  ): Promise<UserCard> {
    return this.usersService.updateMyProfile(user.id, dto);
  }

  @Post('me/avatar')
  @HttpCode(200)
  @Audit({ action: 'directory.user.avatar_set', entity: 'user' })
  @ApiOperation({ summary: 'Аватар своего профиля (multipart: size + file)' })
  @ApiOkResponse({ standardSchema: userCardSchema })
  @ApiErrors(400, 401, 404, 413)
  @ApiIdempotencyKey()
  async setMyAvatar(@GetUser() user: AuthUser, @Req() request: FastifyRequest): Promise<UserCard> {
    const read = await this.readMultipart(request);
    const size = Number(read.fields['size']);
    if (!Number.isSafeInteger(size) || size < 0) {
      read.file.file.resume();
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'size field is required');
    }
    try {
      return await this.usersService.setMyAvatar(
        user.id,
        { name: read.file.filename || 'avatar', size },
        read.file.file,
      );
    } catch (error) {
      read.file.file.resume();
      throw error;
    }
  }

  @Delete('me/avatar')
  @HttpCode(200)
  @Audit({ action: 'directory.user.avatar_remove', entity: 'user' })
  @ApiOperation({ summary: 'Убрать аватар своего профиля' })
  @ApiOkResponse({ standardSchema: userCardSchema })
  @ApiErrors(400, 401, 404)
  @ApiIdempotencyKey()
  removeMyAvatar(@GetUser() user: AuthUser): Promise<UserCard> {
    return this.usersService.removeMyAvatar(user.id);
  }

  @Get(':id')
  @RequirePermissions(Permission.DIRECTORY_READ)
  @ApiOperation({ summary: 'Карточка сотрудника' })
  @ApiParam({
    name: 'id',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: userCardSchema })
  @ApiErrors(401, 403, 404)
  getCard(@Param('id') id: string): Promise<UserCard> {
    return this.usersService.getUserCard(id);
  }

  @Post()
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.user.create', entity: 'user' })
  @ApiOperation({ summary: 'Создание сотрудника (администратор)' })
  @ApiCreatedResponse({ standardSchema: userCardSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  create(
    @Body({ schema: createUserSchema, pipes: [new ZodValidationPipe(createUserSchema)] })
    dto: CreateUserDto,
    @GetUser() actor: AuthUser,
  ): Promise<UserCard> {
    return this.usersService.createUser(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.user.update', entity: 'user' })
  @ApiOperation({ summary: 'Обновление карточки сотрудника (администратор)' })
  @ApiParam({
    name: 'id',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: userCardSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  update(
    @Param('id') id: string,
    @Body({ schema: updateUserSchema, pipes: [new ZodValidationPipe(updateUserSchema)] })
    dto: UpdateUserDto,
    @GetUser() actor: AuthUser,
  ): Promise<UserCard> {
    return this.usersService.updateUser(id, dto, actor);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.user.deactivate', entity: 'user' })
  @ApiOperation({ summary: 'Деактивация сотрудника (без удаления, I15)' })
  @ApiParam({
    name: 'id',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: userCardSchema })
  @ApiErrors(401, 403, 404, 409)
  @ApiIdempotencyKey()
  deactivate(@Param('id') id: string, @GetUser() actor: AuthUser): Promise<UserCard> {
    return this.usersService.deactivateUser(id, actor);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.user.activate', entity: 'user' })
  @ApiOperation({ summary: 'Возврат деактивированного сотрудника в работу (AUD-016)' })
  @ApiParam({
    name: 'id',
    description: 'UUID сотрудника',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: userCardSchema })
  @ApiErrors(401, 403, 404, 409)
  @ApiIdempotencyKey()
  activate(@Param('id') id: string, @GetUser() actor: AuthUser): Promise<UserCard> {
    return this.usersService.activateUser(id, actor);
  }

  /** Первая file-часть + текстовые поля ДО неё (канон @fastify/multipart,
   *  репро #57: поля после файловой части недетерминированы на больших телах). */
  private async readMultipart(
    request: FastifyRequest,
  ): Promise<{ file: MultipartFile; fields: Record<string, string> }> {
    const parts = request.parts();
    const fields: Record<string, string> = {};
    for await (const part of parts) {
      if (part.type === 'file') {
        return { file: part, fields };
      }
      if (part.fieldname in fields) continue; // дубль имени — берём первое
      fields[part.fieldname] = String(part.value);
    }
    throw new DomainException(
      ErrorCode.VALIDATION_FAILED,
      'multipart/form-data with a file part is required',
    );
  }
}
