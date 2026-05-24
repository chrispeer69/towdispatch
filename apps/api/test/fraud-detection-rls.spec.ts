/**
 * RLS isolation + cross-tenant FK guards for the Fraud Detection (Session 43)
 * tables.
 *
 *   fraud_risk_signals  — RLS + the job consistency trigger.
 *   fraud_risk_scores   — RLS + the job consistency trigger (job_id PK).
 *   dispute_records     — RLS + the job consistency trigger.
 *   dispute_outcomes    — RLS + the dispute consistency trigger.
 *
 * Self-skips when no database is configured (mirrors lien-processing-rls.spec.ts).
 */
import { uuidv7 } from '@ustowdispatch/db';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;

const skip = !ADMIN_URL || !APP_URL;
const describeIfDb = skip ? describe.skip : describe;

describeIfDb('RLS tenant isolation — fraud detection', () => {
  let admin: Pool;
  let app: Pool;
  let tenantA: string;
  let tenantB: string;
  let jobA: string;
  let jobB: string;
  let signalA: string;
  let disputeA: string;
  let disputeB: string;
  const slugA = `fraud-rls-a-${Date.now()}`;
  const slugB = `fraud-rls-b-${Date.now()}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL as string, max: 2 });
    app = new Pool({ connectionString: APP_URL as string, max: 4 });

    tenantA = uuidv7();
    tenantB = uuidv7();
    jobA = uuidv7();
    jobB = uuidv7();
    signalA = uuidv7();
    disputeA = uuidv7();
    disputeB = uuidv7();

    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO tenants (id, slug, name, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
        [tenantA, slugA, 'FRAUD RLS A', tenantB, slugB, 'FRAUD RLS B'],
      );
      await c.query(
        `INSERT INTO jobs (id, tenant_id, job_number, service_type, pickup_address, authorized_by)
         VALUES ($1, $2, '20260524-0001', 'tow', '1 Main St', 'motor_club'),
                ($3, $4, '20260524-0001', 'tow', '2 Main St', 'motor_club')`,
        [jobA, tenantA, jobB, tenantB],
      );
      await c.query(
        `INSERT INTO fraud_risk_signals (id, tenant_id, job_id, signal_type, severity, confidence_pct)
         VALUES ($1, $2, $3, 'duplicate_invoice', 'high', 90)`,
        [signalA, tenantA, jobA],
      );
      await c.query(
        `INSERT INTO fraud_risk_scores (job_id, tenant_id, score_0_100, risk_band)
         VALUES ($1, $2, 80, 'critical'), ($3, $4, 80, 'critical')`,
        [jobA, tenantA, jobB, tenantB],
      );
      await c.query(
        `INSERT INTO dispute_records (id, tenant_id, job_id, motor_club_name)
         VALUES ($1, $2, $3, 'Agero'), ($4, $5, $6, 'AAA')`,
        [disputeA, tenantA, jobA, disputeB, tenantB, jobB],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  });

  afterAll(async () => {
    if (admin) {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query('DELETE FROM dispute_outcomes WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM dispute_records WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM fraud_risk_scores WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM fraud_risk_signals WHERE tenant_id IN ($1, $2)', [
          tenantA,
          tenantB,
        ]);
        await c.query('DELETE FROM jobs WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('DELETE FROM audit_log WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);
        await c.query('ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants');
        try {
          await c.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
        } finally {
          await c.query('ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants');
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
      await admin.end();
    }
    if (app) await app.end();
  });

  // ------------------------- fraud_risk_signals -------------------------

  it('fraud_risk_signals: tenant A sees only its own signal', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM fraud_risk_signals',
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.tenant_id).toBe(tenantA);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('fraud_risk_signals: without GUC, SELECT returns zero rows (fail-closed)', async () => {
    const c = await app.connect();
    try {
      const r = await c.query('SELECT id FROM fraud_risk_signals');
      expect(r.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it('fraud_risk_signals: INSERT with a foreign tenant_id is rejected by WITH CHECK', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO fraud_risk_signals (id, tenant_id, job_id, signal_type)
           VALUES ($1, $2, $3, 'duplicate_invoice')`,
          [uuidv7(), tenantB, jobB],
        ),
      ).rejects.toThrowError(/row-level security|policy/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('fraud_risk_signals: foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO fraud_risk_signals (id, tenant_id, job_id, signal_type)
           VALUES ($1, $2, $3, 'duplicate_invoice')`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- fraud_risk_scores -------------------------

  it('fraud_risk_scores: UPDATE of B from A affects zero rows', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const upd = await c.query(
        'UPDATE fraud_risk_scores SET score_0_100 = 0 WHERE job_id = $1::uuid',
        [jobB],
      );
      expect(upd.rowCount).toBe(0);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  // ------------------------- dispute_records -------------------------

  it('dispute_records: a B dispute is invisible to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      const r = await c.query<{ tenant_id: string }>(
        'SELECT DISTINCT tenant_id FROM dispute_records',
      );
      expect(r.rows.every((row) => row.tenant_id === tenantA)).toBe(true);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('dispute_records: foreign job_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dispute_records (id, tenant_id, job_id, motor_club_name)
           VALUES ($1, $2, $3, 'Agero')`,
          [uuidv7(), tenantA, jobB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  // ------------------------- dispute_outcomes -------------------------

  it('dispute_outcomes: an outcome on A is visible only to A', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO dispute_outcomes (id, tenant_id, dispute_id, signal_id, was_fraud)
         VALUES ($1, $2, $3, $4, true)`,
        [uuidv7(), tenantA, disputeA, signalA],
      );
      const r = await c.query('SELECT id FROM dispute_outcomes');
      expect(r.rows).toHaveLength(1);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('dispute_outcomes: foreign dispute_id (B) under A is rejected by the consistency trigger', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dispute_outcomes (id, tenant_id, dispute_id, was_fraud)
           VALUES ($1, $2, $3, false)`,
          [uuidv7(), tenantA, disputeB],
        ),
      ).rejects.toThrowError(/does not exist|does not match/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });
});
