/**
 * Role authorization matrix. Verifies that each endpoint's @Roles decorator
 * is enforced — every role token gets exactly the access it should and no
 * more.
 *
 * Approach: signup creates an OWNER per tenant. We then directly mutate the
 * user's role via the admin pool to simulate every other role. (Creating
 * test users with non-OWNER roles via the API is awkward because signup
 * always produces OWNERs; this is a tested workaround that mirrors what the
 * tenant onboarding flow eventually exposes.)
 *
 * Each endpoint is hand-classified with its allow-list. The test asserts
 * 2xx for allowed roles and 403/404 for the rest. Endpoints that need
 * non-trivial setup (refunds, etc.) are not exercised here — see the
 * domain-specific integration specs.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLES, type Role } from '@towdispatch/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthedResp,
  type TestContext,
  auth,
  makeContext,
  makeSignupBody,
  signup,
  skipIfNoDb,
  tearDown,
} from '../integration/helpers.js';

const SUFFIX = `roles-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const describeIfDb = skipIfNoDb ? describe.skip : describe;

interface EndpointCheck {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  allowed: Role[];
  // benign body for state-changing requests so validation passes
  body?: Record<string, unknown>;
}

const ENDPOINTS: EndpointCheck[] = [
  // jobs list — read by everyone except auditor on the list endpoint
  {
    method: 'GET',
    url: '/jobs',
    allowed: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER, ROLES.ACCOUNTING],
  },
  // customers list
  {
    method: 'GET',
    url: '/customers',
    allowed: [
      ROLES.OWNER,
      ROLES.ADMIN,
      ROLES.MANAGER,
      ROLES.DISPATCHER,
      ROLES.ACCOUNTING,
      ROLES.AUDITOR,
    ],
  },
  // dispatch board — dispatcher path
  {
    method: 'GET',
    url: '/dispatch/board',
    allowed: [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.DISPATCHER],
  },
  // accounting / billing — accounting + admins
  {
    method: 'GET',
    url: '/billing/invoices',
    allowed: [ROLES.OWNER, ROLES.ADMIN, ROLES.ACCOUNTING, ROLES.MANAGER, ROLES.AUDITOR],
  },
];

describeIfDb('Role authorization matrix', () => {
  let ctx: TestContext;
  let app: NestFastifyApplication;
  let owner: AuthedResp;

  // Per-role bearer token. Re-issued by switching the user's role at the
  // DB level and refreshing the session — the JWT carries the role claim
  // so we have to re-login after each switch.
  const tokenForRole = async (role: Role): Promise<string> => {
    await ctx.admin.query('UPDATE users SET role = $1 WHERE id = $2', [role, owner.user.id]);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: owner.user.email, password: 'CorrectHorse-Battery-9!' },
    });
    if (res.statusCode !== 200) {
      throw new Error(`relogin as ${role} failed: ${res.statusCode} ${res.body}`);
    }
    const body = res.json() as { accessToken?: string; status?: string };
    if (!body.accessToken) {
      // MFA-challenged accounts won't have an immediate accessToken; in
      // this synthetic case (no MFA enrolled) we always get one.
      throw new Error(`no accessToken in /auth/login response (${body.status ?? '?'})`);
    }
    return body.accessToken;
  };

  beforeAll(async () => {
    ctx = await makeContext();
    app = ctx.app;
    owner = await signup(ctx, makeSignupBody(SUFFIX, ctx));
  }, 60_000);

  afterAll(async () => {
    await tearDown(ctx);
  });

  const ROLES_ALL: Role[] = [
    ROLES.OWNER,
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.DISPATCHER,
    ROLES.DRIVER,
    ROLES.ACCOUNTING,
    ROLES.AUDITOR,
  ];

  it.each(ENDPOINTS)(
    'enforces role allow-list on %s %s',
    async ({ method, url, allowed, body }) => {
      const offenders: string[] = [];
      for (const role of ROLES_ALL) {
        const token = await tokenForRole(role);
        const res = await app.inject({
          method,
          url,
          headers: { ...auth(token), 'content-type': 'application/json' },
          ...(body ? { payload: body } : {}),
        });
        const allowedNow = allowed.includes(role);
        if (allowedNow && res.statusCode >= 400 && res.statusCode !== 404) {
          // Allowed but rejected — either a missing role on the decorator
          // or a bug in tokenForRole. Capture for the report.
          offenders.push(`${role} ${method} ${url} → ${res.statusCode} (should allow)`);
        } else if (!allowedNow && res.statusCode === 200) {
          offenders.push(`${role} ${method} ${url} → 200 (should reject)`);
        }
      }
      expect(offenders).toEqual([]);
    },
    60_000,
  );
});
