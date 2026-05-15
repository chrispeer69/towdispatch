import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@ustowdispatch/db';
import { BundleService } from '../bundle.service.js';
import {
  mapValue,
  normalizeEmail,
  normalizePhone,
  normalizeString,
  parseTowbookTimestamp,
} from '../normalizers.js';
import type { ImportContext, ImportRecordType } from '../types.js';
import { BaseImporter, type ImportRowOutcome } from './base.importer.js';

@Injectable()
export class CustomerImporter extends BaseImporter {
  protected readonly recordType: ImportRecordType = 'customer';
  protected readonly csvKey = 'customers';

  // Explicit constructor is required so Nest's DI emits constructor
  // metadata for this derived class and injects BundleService. Without it,
  // design:paramtypes is empty and the base's `bundle` is undefined.
  // biome-ignore lint/complexity/noUselessConstructor: required for NestJS DI metadata
  constructor(bundle: BundleService) {
    super(bundle);
  }

  protected async importRow(
    ctx: ImportContext,
    get: (row: string[], field: string) => string | null,
    row: string[],
  ): Promise<ImportRowOutcome> {
    const externalId = normalizeString(get(row, 'external_id'));
    if (!externalId) {
      return { action: 'error', externalId: null, errorMessage: 'missing external_id' };
    }
    const name = normalizeString(get(row, 'name'));
    if (!name) {
      return { action: 'error', externalId, errorMessage: 'missing name' };
    }
    const phone = normalizePhone(get(row, 'phone_primary'));
    const phoneAlt = normalizePhone(get(row, 'phone_secondary'));
    const email = normalizeEmail(get(row, 'email'));
    const street = normalizeString(get(row, 'street_address'));
    const city = normalizeString(get(row, 'city'));
    const state = normalizeString(get(row, 'state'));
    const zip = normalizeString(get(row, 'zip'));
    const type =
      mapValue(ctx.mapping.value_maps, 'account_type', get(row, 'account_type')) ?? 'cash';
    const createdAt = parseTowbookTimestamp(get(row, 'created_date'));

    // Dedup precedence: (tenant_id, external_id) → if exists, UPDATE.
    // Then (tenant_id, phone) live row → if exists and no external_id
    // collision, treat as the same customer and stamp external_id onto it.
    // Then (tenant_id, email) live row → same.
    const existingByExternal = await ctx.client.query<{ id: string }>(
      `SELECT id FROM customers
       WHERE tenant_id = $1 AND external_source = 'towbook' AND external_id = $2
       LIMIT 1`,
      [ctx.tenantId, externalId],
    );
    if (existingByExternal.rowCount && existingByExternal.rowCount > 0) {
      const id = existingByExternal.rows[0]?.id ?? null;
      if (!id) {
        return { action: 'error', externalId, errorMessage: 'dedup row vanished mid-query' };
      }
      await ctx.client.query(
        `UPDATE customers SET
            name = COALESCE(NULLIF($2, ''), name),
            phone = COALESCE(NULLIF($3, ''), phone),
            email = COALESCE(NULLIF($4, ''), email),
            secondary_contact_phone = COALESCE(NULLIF($5, ''), secondary_contact_phone),
            home_address_street = COALESCE(NULLIF($6, ''), home_address_street),
            home_address_city = COALESCE(NULLIF($7, ''), home_address_city),
            home_address_state = COALESCE(NULLIF($8, ''), home_address_state),
            home_address_zip = COALESCE(NULLIF($9, ''), home_address_zip),
            type = COALESCE($10, type),
            updated_at = now()
         WHERE id = $1`,
        [
          id,
          name,
          phone ?? '',
          email ?? '',
          phoneAlt ?? '',
          street ?? '',
          city ?? '',
          state ?? '',
          zip ?? '',
          type,
        ],
      );
      return { action: 'update', externalId, towcommandId: id };
    }

    if (phone) {
      const existingByPhone = await ctx.client.query<{ id: string; external_id: string | null }>(
        `SELECT id, external_id FROM customers
         WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [ctx.tenantId, phone],
      );
      if (existingByPhone.rowCount && existingByPhone.rowCount > 0) {
        const row0 = existingByPhone.rows[0]!;
        if (row0.external_id && row0.external_id !== externalId) {
          return {
            action: 'error',
            externalId,
            errorMessage: `phone ${phone} already linked to external_id ${row0.external_id}`,
          };
        }
        await ctx.client.query(
          `UPDATE customers SET
              external_source = 'towbook',
              external_id = $2,
              name = COALESCE(NULLIF($3, ''), name),
              email = COALESCE(NULLIF($4, ''), email),
              updated_at = now()
           WHERE id = $1`,
          [row0.id, externalId, name, email ?? ''],
        );
        return { action: 'update', externalId, towcommandId: row0.id };
      }
    }

    if (email) {
      const existingByEmail = await ctx.client.query<{ id: string; external_id: string | null }>(
        `SELECT id, external_id FROM customers
         WHERE tenant_id = $1 AND lower(email) = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [ctx.tenantId, email],
      );
      if (existingByEmail.rowCount && existingByEmail.rowCount > 0) {
        const row0 = existingByEmail.rows[0]!;
        await ctx.client.query(
          `UPDATE customers SET
              external_source = 'towbook',
              external_id = $2,
              name = COALESCE(NULLIF($3, ''), name),
              phone = COALESCE(NULLIF($4, ''), phone),
              updated_at = now()
           WHERE id = $1`,
          [row0.id, externalId, name, phone ?? ''],
        );
        return { action: 'update', externalId, towcommandId: row0.id };
      }
    }

    const id = uuidv7();
    await ctx.client.query(
      `INSERT INTO customers (
          id, tenant_id, type, name, email, phone, secondary_contact_phone,
          home_address_street, home_address_city, home_address_state, home_address_zip,
          external_source, external_id, created_via, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'towbook', $12, 'manual', COALESCE($13, now()), now())`,
      [
        id,
        ctx.tenantId,
        type,
        name,
        email,
        phone,
        phoneAlt,
        street,
        city,
        state,
        zip,
        externalId,
        createdAt,
      ],
    );
    return { action: 'create', externalId, towcommandId: id };
  }
}
