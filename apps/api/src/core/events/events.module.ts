import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { EventBus } from './event-bus.js';
import { EventDispatcher } from './event-dispatcher.js';
import { RedisStreamPublisher } from './redis-stream-publisher.js';

/**
 * События (I9): EventBus (outbox-запись в той же транзакции) + EventDispatcher
 * (доставка подписчикам) + RedisStreamPublisher (фанут chat.* в Redis Stream
 * для WS-gateway, #104). Глобально: EventBus доступен всем модулям.
 * DiscoveryModule — скан провайдеров со `static readonly eventType`
 * (или `static readonly eventTypes` — несколько типов одним обработчиком,
 * #952) при bootstrap.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [EventBus, EventDispatcher, RedisStreamPublisher],
  exports: [EventBus],
})
export class EventsModule {}
