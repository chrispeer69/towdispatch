/**
 * QboProvider — unit coverage on R-11: the Intuit AppCenter / OAuth / data-API
 * bases are taken from constructor opts (threaded from config) rather than
 * hardcoded, and the sandbox data-API base is derived from the prod base by a
 * `sandbox-` host prefix. A recording fetch captures the URLs the provider hits;
 * no network is touched.
 */
import { describe, expect, it } from 'vitest';
import type { AccountingProviderCredentials } from '../../integrations/accounting/accounting-provider.interface.js';
import { QboProvider } from './qbo.provider.js';

/** A fetch stub that records the last URL and returns a canned JSON body. */
function recordingFetch(body: unknown): { fetch: typeof fetch; lastUrl: () => string } {
  let url = '';
  const impl = (async (input: string | URL | Request) => {
    url = typeof input === 'string' ? input : input.toString();
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as typeof fetch;
  return { fetch: impl, lastUrl: () => url };
}

const creds = (sandbox: boolean): AccountingProviderCredentials => ({
  realmId: '12345',
  accessToken: 'access',
  refreshToken: 'refresh',
  accessTokenExpiresAt: 0,
  refreshTokenExpiresAt: 0,
  sandbox,
});

describe('QboProvider endpoint bases (R-11)', () => {
  it('defaults to Intuit production hosts', () => {
    const p = new QboProvider({ clientId: 'id', clientSecret: 'secret' });
    const { url } = p.getAuthorizationUrl({
      state: 's',
      redirectUri: 'https://app.local/cb',
      sandbox: false,
    });
    expect(url.startsWith('https://appcenter.intuit.com/connect/oauth2?')).toBe(true);
  });

  it('builds the authorization URL from a custom appcenterBase', () => {
    const p = new QboProvider({
      clientId: 'id',
      clientSecret: 'secret',
      appcenterBase: 'https://appcenter.example.test',
    });
    const { url } = p.getAuthorizationUrl({
      state: 's',
      redirectUri: 'https://app.local/cb',
      sandbox: false,
    });
    expect(url.startsWith('https://appcenter.example.test/connect/oauth2?')).toBe(true);
  });

  it('hits the configured oauthBase token path on code exchange', async () => {
    const rec = recordingFetch({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 3600,
      x_refresh_token_expires_in: 86_400,
    });
    const p = new QboProvider({
      clientId: 'id',
      clientSecret: 'secret',
      oauthBase: 'https://oauth.example.test',
      fetchImpl: rec.fetch,
    });
    await p.exchangeAuthorizationCode({
      code: 'c',
      realmId: '12345',
      redirectUri: 'https://app.local/cb',
      sandbox: false,
    });
    expect(rec.lastUrl()).toBe('https://oauth.example.test/oauth2/v1/tokens/bearer');
  });

  it('uses the prod data-API company base for non-sandbox creds', async () => {
    const rec = recordingFetch({ Customer: { Id: '1', DisplayName: 'Acme' } });
    const p = new QboProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: rec.fetch });
    await p.syncCustomer(creds(false), {
      internalId: 'i1',
      externalId: '1',
      displayName: 'Acme',
    });
    expect(rec.lastUrl()).toBe('https://quickbooks.api.intuit.com/v3/company/12345/customer');
  });

  it('derives the sandbox data-API base by prefixing the host with sandbox-', async () => {
    const rec = recordingFetch({ Customer: { Id: '1', DisplayName: 'Acme' } });
    const p = new QboProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: rec.fetch });
    await p.syncCustomer(creds(true), {
      internalId: 'i1',
      externalId: '1',
      displayName: 'Acme',
    });
    expect(rec.lastUrl()).toBe(
      'https://sandbox-quickbooks.api.intuit.com/v3/company/12345/customer',
    );
  });

  it('derives sandbox from a custom apiBase too', async () => {
    const rec = recordingFetch({ Customer: { Id: '1', DisplayName: 'Acme' } });
    const p = new QboProvider({
      clientId: 'id',
      clientSecret: 'secret',
      apiBase: 'https://qb.example.test',
      fetchImpl: rec.fetch,
    });
    await p.syncCustomer(creds(true), {
      internalId: 'i1',
      externalId: '1',
      displayName: 'Acme',
    });
    expect(rec.lastUrl()).toBe('https://sandbox-qb.example.test/v3/company/12345/customer');
  });
});
