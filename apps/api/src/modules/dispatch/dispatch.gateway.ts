import type { AddressInfo } from 'node:net';
/**
 * Live dispatch gateway — Socket.IO with the Redis adapter so multiple API
 * instances can fan out to all connected clients in a tenant.
 *
 * Auth model: client connects to /dispatch with the access token in either
 * the auth payload (preferred — Socket.IO best practice) or the
 * Authorization header. The token is verified the same way the HTTP guard
 * verifies it. Tenant id from the claim becomes the room name.
 *
 * Tenant isolation: every emit goes to `tenant:<uuid>` and every connected
 * socket joins exactly its own tenant room. A client never receives an
 * event for a tenant it isn't authenticated against.
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { accessTokenClaimsSchema } from '@towcommand/shared';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import { ConfigService } from '../../config/config.service.js';
import { JwtService } from '../auth/jwt.service.js';
import { REDIS_CLIENT } from '../redis/redis.tokens.js';
import { DispatchEventsService } from './dispatch-events.service.js';

interface AuthedSocket extends Socket {
  data: {
    tenantId: string;
    userId: string;
    role: string;
  };
}

export interface DispatchGatewayHandle {
  io: Server;
  close(): Promise<void>;
}

@Injectable()
export class DispatchGateway implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DispatchGateway.name);
  private io: Server | null = null;
  private subPub: Redis | null = null;
  private unsubscribeEvents: (() => void) | null = null;

  constructor(
    private readonly events: DispatchEventsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    // Subscribe early so events fired during boot still fan out once a
    // client connects.
    this.unsubscribeEvents = this.events.subscribe((tenantId, event) => {
      const io = this.io;
      if (!io) return;
      io.to(roomForTenant(tenantId)).emit(event.name, event.payload);
    });
  }

  /**
   * Attach the Socket.IO server to the running HTTP listener. Called from
   * main.ts after the Nest app has bound its port.
   */
  async attach(httpServer: import('http').Server): Promise<void> {
    const io = new Server(httpServer, {
      path: '/socket.io',
      cors: {
        origin: this.config.corsOrigins,
        credentials: true,
      },
      // Disable per-message-deflate — overhead beats the wire savings for
      // small JSON payloads, and it interacts badly with some proxies.
      perMessageDeflate: false,
    });

    // Redis adapter so events fan out across API replicas. We duplicate the
    // shared Redis client because the adapter needs a dedicated subscriber
    // connection (ioredis enters subscribe mode and blocks normal commands
    // on that client).
    const pub = this.redis;
    const sub = pub.duplicate();
    this.subPub = sub;
    io.adapter(createAdapter(pub, sub));

    io.use(async (socket, next) => {
      try {
        const token = extractToken(socket);
        if (!token) {
          return next(new Error('missing-token'));
        }
        const decoded = await this.jwt.verifyAccess(token);
        const claims = accessTokenClaimsSchema.parse(decoded);
        if (claims.iss !== this.config.jwt.issuer || claims.aud !== this.config.jwt.audience) {
          return next(new Error('bad-token-issuer'));
        }
        (socket as AuthedSocket).data = {
          tenantId: claims.tid,
          userId: claims.sub,
          role: claims.role,
        };
        return next();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'auth-failed';
        return next(new Error(`auth-failed:${msg}`));
      }
    });

    io.on('connection', (socket) => {
      const data = (socket as AuthedSocket).data;
      const room = roomForTenant(data.tenantId);
      socket.join(room);
      this.log.log(`socket ${socket.id} joined ${room} (user=${data.userId})`);
      socket.on('disconnect', (reason) => {
        this.log.debug(`socket ${socket.id} disconnected: ${reason}`);
      });
    });

    this.io = io;
    const addr = httpServer.address();
    const port = addr && typeof addr === 'object' ? (addr as AddressInfo).port : '?';
    this.log.log(`Dispatch gateway attached on :${port} (path=/socket.io)`);
  }

  /** Expose the underlying io server so other gateways can mount their own
   * namespaces on top (e.g. the public /track namespace). */
  getServer(): Server | null {
    return this.io;
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribeEvents?.();
    if (this.io) {
      await new Promise<void>((resolve) => {
        this.io?.close(() => resolve());
      });
      this.io = null;
    }
    if (this.subPub) {
      try {
        this.subPub.disconnect();
      } catch {
        /* ignore */
      }
      this.subPub = null;
    }
  }
}

function extractToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  if (auth && typeof auth.token === 'string' && auth.token.length > 0) {
    return auth.token;
  }
  const header = socket.handshake.headers.authorization;
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim();
  }
  return null;
}

export function roomForTenant(tenantId: string): string {
  return `tenant:${tenantId}`;
}
