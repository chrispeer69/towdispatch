/**
 * DirectoryService (Session 46) — the PUBLIC app directory. Only `listed`,
 * non-deleted apps are visible, and only their public fields (no redirect URLs,
 * no webhook config, no secrets). Reads run on the app_user pool with NO tenant
 * context (runAnonymous): marketplace_apps is a global table with no RLS, so
 * app_user's default SELECT grant is sufficient and least-privileged — no need
 * for the admin pool on an unauthenticated path.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type DirectoryPage,
  type DirectoryQuery,
  ERROR_CODES,
  type MarketplaceAppPublicDto,
} from '@ustowdispatch/shared';
import { TenantAwareDb } from '../../database/tenant-aware-db.service.js';
import { type AppPublicRow, toAppPublicDto } from './marketplace.mappers.js';

const PUBLIC_COLUMNS = `a.slug, a.name, a.description, a.category, a.logo_url, a.scopes,
  d.company_name AS developer_name, a.created_at`;

@Injectable()
export class DirectoryService {
  constructor(private readonly db: TenantAwareDb) {}

  async list(query: DirectoryQuery): Promise<DirectoryPage> {
    return this.db.runAnonymous(async (_db, client) => {
      const where: string[] = [`a.status = 'listed'`, 'a.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (query.category) {
        params.push(query.category);
        where.push(`a.category = $${params.length}`);
      }
      if (query.q) {
        params.push(`%${query.q}%`);
        where.push(`(a.name ILIKE $${params.length} OR a.description ILIKE $${params.length})`);
      }
      const whereSql = where.join(' AND ');

      const totalRes = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM marketplace_apps a WHERE ${whereSql}`,
        params,
      );
      const total = Number(totalRes.rows[0]?.n ?? 0);

      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const rows = await client.query<AppPublicRow>(
        `SELECT ${PUBLIC_COLUMNS}
           FROM marketplace_apps a
           JOIN developer_accounts d ON d.id = a.developer_id
          WHERE ${whereSql}
          ORDER BY a.created_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...params, query.limit, query.offset],
      );

      return {
        apps: rows.rows.map(toAppPublicDto),
        total,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  async getBySlug(slug: string): Promise<MarketplaceAppPublicDto> {
    const row = await this.db.runAnonymous(async (_db, client) => {
      const r = await client.query<AppPublicRow>(
        `SELECT ${PUBLIC_COLUMNS}
           FROM marketplace_apps a
           JOIN developer_accounts d ON d.id = a.developer_id
          WHERE lower(a.slug) = lower($1) AND a.status = 'listed' AND a.deleted_at IS NULL`,
        [slug],
      );
      return r.rows[0] ?? null;
    });
    if (!row) {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'App not found' });
    }
    return toAppPublicDto(row);
  }
}
