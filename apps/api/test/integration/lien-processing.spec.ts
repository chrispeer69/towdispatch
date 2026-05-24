/**
 * Integration tests for Lien Processing (Session 23) — drives the real HTTP
 * surface against the docker stack (Postgres + Redis). Covers:
 *   - openCase against an impound record,
 *   - the advance / recordNotice loop through to ready-for-sale on CA, TX,
 *     and FL (different publication + waiting rules),
 *   - the gate that blocks advancing past a required notice,
 *   - the OBSERVATION-ONLY cron (recomputes due dates, never advances).
 *
 * Cases are aged by backdating opened_at via the admin pool so the statutory
 * waiting period has elapsed in test time. DB-gated via skipIfNoDb; cleans up
 * its own lien + impound rows before tearDown (tenant ON DELETE RESTRICT).
 */
import type { LienState } from '@ustowdispatch/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LienAdvanceCron } from '../../src/modules/lien-processing/lien-advance.cron.js';
import { LIEN_STATE_RULES } from '../../src/modules/lien-processing/state-rules.config.js';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from './helpers.js';

const describeIfDb = skipIfNoDb ? describe.skip : describe;
const DAY_MS = 86_400_000;

describeIfDb('integration — lien processing', () => {
  let ctx: TestContext;
  let owner: AuthedResp;
  let tenantId: string;
  let token: string;
  let yardId: string;
  const tenantIds: string[] = [];

  function inject(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return ctx.app.inject({
      method,
      url,
      headers: { ...auth(token), 'content-type': 'application/json' },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  async function backdateOpenedAt(caseId: string, days: number): Promise<void> {
    const c = await ctx.admin.connect();
    try {
      await c.query(
        `UPDATE lien_cases SET opened_at = now() - interval '${days} days' WHERE id = $1::uuid`,
        [caseId],
      );
    } finally {
      c.release();
    }
  }

  async function makeRecord(): Promise<string> {
    const res = await inject('POST', '/impound/records', { yardId, dailyFeeCents: 4000 });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }

  beforeAll(async () => {
    ctx = await makeContext();
    owner = await signup(ctx, makeSignupBody('lien', ctx));
    tenantId = owner.tenant.id;
    token = owner.accessToken;
    tenantIds.push(tenantId);
    const yardRes = await inject('POST', '/impound/yards', { name: 'Lien Lot', code: 'LIEN' });
    yardId = (yardRes.json() as { id: string }).id;
  });

  afterAll(async () => {
    if (ctx?.admin && tenantIds.length) {
      const c = await ctx.admin.connect();
      try {
        await c.query('BEGIN');
        for (const table of [
          'lien_timeline_events',
          'lien_notices',
          'lien_cases',
          'impound_releases',
          'impound_fees',
          'impound_holds',
          'impound_records',
          'impound_yards',
        ]) {
          await c.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
        }
        await c.query('COMMIT');
      } catch {
        await c.query('ROLLBACK').catch(() => {});
      } finally {
        c.release();
      }
    }
    await tearDown(ctx);
  });

  it('seeds the state-rule reference for all 50 states + DC', async () => {
    const res = await inject('GET', '/lien-cases/state-rules');
    expect(res.statusCode, res.body).toBe(200);
    const states = (res.json() as Array<{ state: string }>).map((r) => r.state);
    // Session 23 shipped 10; Session 35 added the remaining 40 + DC = 51.
    expect(states).toHaveLength(51);
    // The Session 23 top 10 plus a sample of the Session 35 additions.
    for (const s of [
      'CA',
      'TX',
      'FL',
      'NY',
      'GA',
      'NC',
      'OH',
      'IL',
      'PA',
      'MI',
      'DC',
      'WA',
      'HI',
      'MA',
      'MO',
    ]) {
      expect(states).toContain(s);
    }
  });

  it('opens a case and refuses a duplicate for the same impound record', async () => {
    const recordId = await makeRecord();
    const open = await inject('POST', '/lien-cases', {
      impoundRecordId: recordId,
      state: 'CA',
      ownerFound: true,
    });
    expect(open.statusCode, open.body).toBe(201);
    const dup = await inject('POST', '/lien-cases', { impoundRecordId: recordId, state: 'CA' });
    expect(dup.statusCode).toBe(409);
  });

  // Drives a case from opened → ready_for_sale, then records the sale, for
  // ANY state. Publication / lienholder branches and the backdating window
  // are derived from that state's actual rule config, so the same helper
  // exercises a short no-publication timeline (WA) and a long, strict
  // publication + lienholder timeline (HI, MA) identically.
  async function driveToSale(
    state: LienState,
    opts: { lienholderFound?: boolean } = {},
  ): Promise<void> {
    const rules = LIEN_STATE_RULES[state];
    const requiresPublication = rules.publicationRequired;
    const lienholderFound = opts.lienholderFound ?? false;
    // Age the case past the longest statutory window so the hold has elapsed.
    const holdDays = rules.minDaysToSale + 40;
    const noticeDaysAgo =
      Math.max(
        rules.ownerNoticeWaitDays,
        rules.lienholderNoticeWaitDays,
        rules.publicationWaitDays,
      ) + 20;

    const recordId = await makeRecord();
    const opened = (
      await inject('POST', '/lien-cases', {
        impoundRecordId: recordId,
        state,
        ownerFound: true,
        lienholderFound,
        estimatedValueCents: 700_000,
      })
    ).json() as { case: { id: string; status: string } };
    const caseId = opened.case.id;
    expect(opened.case.status).toBe('open');

    await backdateOpenedAt(caseId, holdDays);

    // opened → dmv_lookup_requested → dmv_lookup_complete
    expect((await inject('POST', `/lien-cases/${caseId}/advance`, {})).statusCode).toBe(201);
    expect(
      (await inject('POST', `/lien-cases/${caseId}/advance`, { ownerFound: true, lienholderFound }))
        .statusCode,
    ).toBe(201);

    // Cannot advance past the required owner notice.
    expect((await inject('POST', `/lien-cases/${caseId}/advance`, {})).statusCode).toBe(409);

    const sentLongAgo = new Date(Date.now() - noticeDaysAgo * DAY_MS).toISOString();
    expect(
      (
        await inject('POST', `/lien-cases/${caseId}/notices`, {
          noticeType: 'owner_notice',
          recipientRole: 'owner',
          deliveryMethod: 'certified_mail',
          sentAt: sentLongAgo,
        })
      ).statusCode,
    ).toBe(201);

    if (lienholderFound) {
      // A found lienholder must be served before publishing / waiting.
      expect((await inject('POST', `/lien-cases/${caseId}/advance`, {})).statusCode).toBe(409);
      expect(
        (
          await inject('POST', `/lien-cases/${caseId}/notices`, {
            noticeType: 'lienholder_notice',
            recipientRole: 'lienholder',
            deliveryMethod: 'certified_mail',
            sentAt: sentLongAgo,
          })
        ).statusCode,
      ).toBe(201);
    }

    if (requiresPublication) {
      // Must publish before the waiting period for publication states.
      expect((await inject('POST', `/lien-cases/${caseId}/advance`, {})).statusCode).toBe(409);
      expect(
        (
          await inject('POST', `/lien-cases/${caseId}/notices`, {
            noticeType: 'publication_notice',
            recipientRole: 'public',
            deliveryMethod: 'publication',
            sentAt: sentLongAgo,
          })
        ).statusCode,
      ).toBe(201);
    }

    // → waiting_period → ready_for_sale
    expect((await inject('POST', `/lien-cases/${caseId}/advance`, {})).statusCode).toBe(201);
    const ready = await inject('POST', `/lien-cases/${caseId}/advance`, {});
    expect(ready.statusCode, ready.body).toBe(201);
    const readyJson = ready.json() as { case: { status: string }; nextAction: { action: string } };
    expect(readyJson.case.status).toBe('ready_for_sale');
    expect(readyJson.nextAction.action).toBe('conduct_sale');

    // A sale can only be recorded once ready — now it succeeds.
    const sold = await inject('POST', `/lien-cases/${caseId}/close`, {
      disposition: 'sold',
      salePriceCents: 500_000,
    });
    expect(sold.statusCode, sold.body).toBe(201);
    expect((sold.json() as { case: { status: string } }).case.status).toBe('sold');
  }

  // Session 23 states (publication-required CA/FL, no-publication TX).
  it('drives a CA case (publication required) to sale', async () => {
    await driveToSale('CA');
  });

  it('drives a TX case (no publication) to sale', async () => {
    await driveToSale('TX');
  });

  it('drives a FL case (publication required) to sale', async () => {
    await driveToSale('FL');
  });

  // Session 35 — 5 representatives chosen from the rule properties:
  //   WA = min(minDaysToSale)=30 + no publication  → short timeline
  //   HI = max(minDaysToSale)=60 + publication      → long timeline
  //   MD = publicationRequired:true                 → publication path
  //   MO = publicationRequired:false                → no-publication path
  //   MA = max(lienholderNoticeWaitDays)=45 + pub   → strict lienholder
  it('drives a WA case (shortest timeline, no publication) to sale', async () => {
    await driveToSale('WA');
  });

  it('drives a HI case (longest timeline, publication) to sale', async () => {
    await driveToSale('HI');
  });

  it('drives a MD case (publication required) to sale', async () => {
    await driveToSale('MD');
  });

  it('drives a MO case (no publication) to sale', async () => {
    await driveToSale('MO');
  });

  it('drives a MA case (strict lienholder + publication) to sale with a lienholder served', async () => {
    await driveToSale('MA', { lienholderFound: true });
  });

  it('blocks a sale before the case is ready', async () => {
    const recordId = await makeRecord();
    const opened = (
      await inject('POST', '/lien-cases', { impoundRecordId: recordId, state: 'OH' })
    ).json() as { case: { id: string } };
    const res = await inject('POST', `/lien-cases/${opened.case.id}/close`, {
      disposition: 'sold',
    });
    expect(res.statusCode).toBe(409);
  });

  it('runs the advance cron as OBSERVATION-ONLY (recomputes, never advances)', async () => {
    const recordId = await makeRecord();
    const opened = (
      await inject('POST', '/lien-cases', { impoundRecordId: recordId, state: 'GA' })
    ).json() as { case: { id: string; status: string; currentStep: string } };

    const cron = ctx.app.get(LienAdvanceCron);
    const tick = await cron.tick(new Date());
    expect(tick.casesScanned).toBeGreaterThanOrEqual(1);

    // The case must NOT have advanced or changed status from the sweep.
    const after = (await inject('GET', `/lien-cases/${opened.case.id}`)).json() as {
      case: { status: string; currentStep: string };
    };
    expect(after.case.status).toBe('open');
    expect(after.case.currentStep).toBe('opened');
  });
});
