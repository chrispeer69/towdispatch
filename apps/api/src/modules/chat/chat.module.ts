/**
 * ChatModule — driver↔dispatcher messaging (Session 6.2).
 *
 * Mounted at /dispatch/chat. NotificationModule is global so the service
 * resolves it without an explicit import here.
 */
import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
