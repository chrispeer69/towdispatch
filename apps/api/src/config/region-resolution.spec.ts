/**
 * Region resolution from env — unit coverage on ConfigService.region and the
 * read-replica getters. Drives the real schema + getter (peer-origin parsing,
 * app_user credential swap on the read URL, replica-distinctness).
 *
 * ConfigService reads process.env at construction, so each case mutates a
 * minimal env and restores it. loadConfig() process.exit(1)s on invalid env,
 * hence the required keys are always set.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from './config.service.js';

const REQUIRED = {
  DATABASE_URL: 'postgres://u:p@db.local:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(40),
  NODE_ENV: 'test',
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = process.env;
  // Fresh env containing only what the schema requires.
  process.env = { ...REQUIRED } as NodeJS.ProcessEnv;
});

afterEach(() => {
  process.env = saved;
});

describe('ConfigService.region', () => {
  it('defaults to a primary US-East single-region deploy', () => {
    const c = new ConfigService();
    expect(c.region.id).toBe('us-east');
    expect(c.region.role).toBe('primary');
    expect(c.region.isPrimary).toBe(true);
    expect(c.region.peerOrigin).toBe('');
    expect(c.region.replicationLagAlertSeconds).toBe(60);
  });

  it('resolves a secondary US-West with a peer origin parsed from the healthcheck URL', () => {
    process.env.REGION_ID = 'us-west';
    process.env.REGION_ROLE = 'secondary';
    process.env.PRIMARY_REGION_HEALTHCHECK_URL = 'https://api.example.com/ready';
    const c = new ConfigService();
    expect(c.region.id).toBe('us-west');
    expect(c.region.role).toBe('secondary');
    expect(c.region.isPrimary).toBe(false);
    expect(c.region.peerOrigin).toBe('https://api.example.com');
    expect(c.region.peerHealthcheckUrl).toBe('https://api.example.com/ready');
  });

  it('honors REPLICATION_LAG_ALERT_SECONDS', () => {
    process.env.REPLICATION_LAG_ALERT_SECONDS = '120';
    expect(new ConfigService().region.replicationLagAlertSeconds).toBe(120);
  });
});

describe('ConfigService read-replica getters', () => {
  it('reads from primary when DATABASE_READ_URL is unset (backwards compatible)', () => {
    const c = new ConfigService();
    expect(c.readReplicaConfigured).toBe(false);
    expect(c.databaseReadUrl).toBe(c.databaseUrl);
  });

  it('treats a read URL identical to primary as NOT a distinct replica', () => {
    process.env.DATABASE_READ_URL = REQUIRED.DATABASE_URL;
    const c = new ConfigService();
    expect(c.readReplicaConfigured).toBe(false);
  });

  it('detects a distinct replica when DATABASE_READ_URL differs', () => {
    process.env.DATABASE_READ_URL = 'postgres://u:p@replica.local:5432/app';
    const c = new ConfigService();
    expect(c.readReplicaConfigured).toBe(true);
    expect(c.databaseReadUrl).toContain('replica.local');
  });

  it('applies the app_user credential swap to the read URL', () => {
    process.env.APP_USER_PASSWORD = 'secret-pw';
    process.env.DATABASE_READ_URL = 'postgres://super:rootpw@replica.local:5432/app';
    const c = new ConfigService();
    expect(c.databaseReadUrl).toContain('app_user:secret-pw@');
    expect(c.readReplicaConfigured).toBe(true);
  });
});
