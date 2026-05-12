import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@towcommand/db';
import {
  normalizeEmail,
  normalizePhone,
  normalizeString,
  parseTowbookTimestamp,
} from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

@Injectable()
export class DriverImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'driver';
  protected readonly csvKey = 'drivers';

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const externalId = normalizeString(get(row, 'external_id'));
    if (!externalId)
      return { action: 'error', externalId: null, errorMessage: 'missing external_id' };

    const name = normalizeString(get(row, 'name'));
    if (!name) return { action: 'error', externalId, errorMessage: 'missing name' };
    const phone = normalizePhone(get(row, 'phone'));
    const email = normalizeEmail(get(row, 'email'));
    const licenseNumber = normalizeString(get(row, 'license_number'));
    const licenseState = normalizeString(get(row, 'license_state'));
    const licenseExp = parseTowbookTimestamp(get(row, 'license_expiration'));
    const medExp = parseTowbookTimestamp(get(row, 'medical_card_expiration'));
    const hireDate = parseTowbookTimestamp(get(row, 'hire_date'));
    const termDate = parseTowbookTimestamp(get(row, 'termination_date'));
    const status = termDate ? 'terminated' : 'active';

    // dedup
    const byExternal = await ctx.client.query<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM drivers
       WHERE tenant_id=$1 AND external_source='towbook' AND external_id=$2 LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    if (byExternal.rowCount && byExternal.rowCount > 0) {
      const id = byExternal.rows[0]?.id ?? null;
      if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
      await ctx.client.query(
        `UPDATE drivers SET
            first_name = COALESCE(NULLIF($2, ''), first_name),
            last_name = COALESCE(NULLIF($3, ''), last_name),
            phone = COALESCE(NULLIF($4, ''), phone),
            email = COALESCE(NULLIF($5, ''), email),
            license_number = COALESCE(NULLIF($6, ''), license_number),
            license_state = COALESCE(NULLIF($7, ''), license_state),
            license_expires_at = COALESCE($8::date, license_expires_at),
            medical_card_expires_at = COALESCE($9::date, medical_card_expires_at),
            hired_at = COALESCE($10::date, hired_at),
            terminated_at = COALESCE($11::date, terminated_at),
            employment_status = $12,
            updated_at = now()
         WHERE id=$1`,
        [
          id,
          splitFirst(name),
          splitLast(name),
          phone ?? '',
          email ?? '',
          licenseNumber ?? '',
          licenseState ?? '',
          licenseExp,
          medExp,
          hireDate,
          termDate,
          status,
        ],
      );
      return { action: 'update', externalId, towcommandId: id };
    }

    if (phone) {
      const byPhone = await ctx.client.query<{ id: string }>(
        'SELECT id FROM drivers WHERE tenant_id=$1 AND phone=$2 AND deleted_at IS NULL LIMIT 1',
        [ctx.tenantId, phone],
      );
      if (byPhone.rowCount && byPhone.rowCount > 0) {
        const id = byPhone.rows[0]?.id ?? null;
        if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
        await ctx.client.query(
          `UPDATE drivers SET external_source='towbook', external_id=$2, updated_at=now() WHERE id=$1`,
          [id, externalId],
        );
        return { action: 'update', externalId, towcommandId: id };
      }
    }
    if (email) {
      const byEmail = await ctx.client.query<{ id: string }>(
        'SELECT id FROM drivers WHERE tenant_id=$1 AND lower(email)=$2 AND deleted_at IS NULL LIMIT 1',
        [ctx.tenantId, email],
      );
      if (byEmail.rowCount && byEmail.rowCount > 0) {
        const id = byEmail.rows[0]?.id ?? null;
        if (!id) return { action: 'error', externalId, errorMessage: 'dedup row vanished' };
        await ctx.client.query(
          `UPDATE drivers SET external_source='towbook', external_id=$2, updated_at=now() WHERE id=$1`,
          [id, externalId],
        );
        return { action: 'update', externalId, towcommandId: id };
      }
    }

    const id = uuidv7();
    await ctx.client.query(
      `INSERT INTO drivers (
          id, tenant_id, first_name, last_name, phone, email,
          license_number, license_state, license_expires_at,
          medical_card_expires_at, hired_at, terminated_at,
          employment_status, active, cdl_class,
          external_source, external_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11::date, $12::date,
                 $13, $14, 'none', 'towbook', $15, now(), now())`,
      [
        id,
        ctx.tenantId,
        splitFirst(name),
        splitLast(name),
        phone,
        email,
        licenseNumber,
        licenseState,
        licenseExp,
        medExp,
        hireDate,
        termDate,
        status,
        status === 'active',
        externalId,
      ],
    );
    return { action: 'create', externalId, towcommandId: id };
  }
}

const splitFirst = (full: string): string => full.trim().split(/\s+/)[0] ?? full;
const splitLast = (full: string): string => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
};
