/**
 * AdminReviewService (Session 46) — the manual app-review workflow (v1: no
 * auto-approval). Platform-admin only (PlatformAdminGuard). Operates on any
 * app by id, across developers, via the admin pool.
 *
 * Transitions:
 *   approve  : review → listed
 *   reject   : review → draft   (with review_notes)
 *   suspend  : listed|review|draft → suspended (with review_notes)
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ERROR_CODES,
  type MarketplaceAppDto,
  type ReviewActionPayload,
} from '@ustowdispatch/shared';
import { TransactionRunner } from '../../database/transaction-runner.service.js';
import { type AppRow, toAppDto } from './marketplace.mappers.js';

const APP_COLUMNS = `id, developer_id, slug, name, description, category, logo_url,
  scopes, oauth_redirect_urls, webhook_url, status, review_notes, created_at, updated_at`;

@Injectable()
export class AdminReviewService {
  constructor(private readonly admin: TransactionRunner) {}

  async listForReview(status: string): Promise<MarketplaceAppDto[]> {
    const rows = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM marketplace_apps
          WHERE status = $1 AND deleted_at IS NULL
          ORDER BY created_at ASC`,
        [status],
      );
      return r.rows;
    });
    return rows.map(toAppDto);
  }

  async review(appId: string, action: ReviewActionPayload): Promise<MarketplaceAppDto> {
    const current = await this.loadApp(appId);

    let nextStatus: string;
    if (action.action === 'approve') {
      if (current.status !== 'review') {
        throw this.badState('Only an app in review can be approved');
      }
      nextStatus = 'listed';
    } else if (action.action === 'reject') {
      if (current.status !== 'review') {
        throw this.badState('Only an app in review can be rejected');
      }
      nextStatus = 'draft';
    } else {
      // suspend — allowed from any live state.
      nextStatus = 'suspended';
    }

    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppRow>(
        `UPDATE marketplace_apps
            SET status = $1, review_notes = $2
          WHERE id = $3 AND deleted_at IS NULL
        RETURNING ${APP_COLUMNS}`,
        [nextStatus, action.notes ?? null, appId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw this.notFound();
    return toAppDto(row);
  }

  private async loadApp(appId: string): Promise<AppRow> {
    const row = await this.admin.runAsAdmin({}, async (_db, client) => {
      const r = await client.query<AppRow>(
        `SELECT ${APP_COLUMNS} FROM marketplace_apps WHERE id = $1 AND deleted_at IS NULL`,
        [appId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) throw this.notFound();
    return row;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'App not found' });
  }

  private badState(message: string): ConflictException {
    return new ConflictException({ code: ERROR_CODES.MARKETPLACE_INVALID_APP_STATE, message });
  }
}
