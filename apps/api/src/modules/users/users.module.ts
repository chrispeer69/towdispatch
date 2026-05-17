import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UserInvitesController } from './user-invites.controller.js';
import { UserInvitesService } from './user-invites.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, UserInvitesController],
  providers: [UsersService, UserInvitesService],
  exports: [UsersService, UserInvitesService],
})
export class UsersModule {}
