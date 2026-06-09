# Custom Domain Runbook — White-Label Customer Portal (Session 32)

How a tenant's branded customer portal goes live on a vanity domain
(e.g. `portal.acme-towing.com`). Two layers: the **fallback subdomain**
(always works, zero config) and the **custom domain** (DNS + Railway + a
verification stamp).

---

## 1. Fallback subdomain — always available, nothing to configure

Every tenant automatically has a portal at:

```
<slug>.portal.ustowdispatch.cloud
```

`<slug>` is the tenant's URL slug. This is the `fallbackDomain` shown in
**Settings → White-Label Portal**. It requires a wildcard DNS record and a
wildcard TLS cert on the apex (one-time platform setup, see §4).

The apex is configured via the API env var `PORTAL_BASE_DOMAIN`
(default `portal.ustowdispatch.cloud`).

---

## 2. Custom domain — operator-owned vanity host

### 2.1 Operator action (in the app)
1. Settings → White-Label Portal → **Custom domain** → enter
   `portal.acme-towing.com` → Save.
2. The status pill flips to **Pending verification**. Saving (or changing)
   a domain always resets verification — a new domain never routes until
   re-verified.

### 2.2 DNS (operator's DNS provider)
Point the host at the Railway web service:

```
portal.acme-towing.com.   CNAME   <web-service>.up.railway.app.
```

(Apex domains that can't CNAME should use Railway's provided A/ALIAS
target instead.)

### 2.3 Railway (platform operator — Chris)
1. Railway → **web** service → **Settings → Networking → Custom Domains**.
2. **Add Domain** → `portal.acme-towing.com`. Railway provisions the TLS
   cert once DNS resolves (can take a few minutes).
3. Confirm Railway shows the domain as **Active** with a valid certificate.

> Out of scope for this build: the actual DNS records and the Railway
> domain attachment are performed by Chris. The app stores the domain and
> tracks verification; it does not call the Railway API.

### 2.4 Verification stamp (platform operator)
Resolution only routes a custom domain once
`tenant_branding.custom_domain_verified_at` is set (squat-proof: a reserved
but unverified domain never serves another tenant's portal). After DNS +
Railway are confirmed, stamp it:

```sql
UPDATE tenant_branding
   SET custom_domain_verified_at = now()
 WHERE tenant_id = '<tenant-uuid>'
   AND lower(custom_domain) = lower('portal.acme-towing.com');
```

The status pill then shows **Verified** and the portal serves on the
custom domain. (A self-serve DNS/HTTP verification check is a documented
follow-up — see SESSION_32_DECISIONS.md.)

---

## 3. How a request resolves to a tenant

The portal is multi-tenant by `Host`. The web app forwards the browser's
host to the API in `X-Portal-Host`; the API resolves, in order:

1. **Verified custom domain** — exact match on
   `tenant_branding.custom_domain` with `custom_domain_verified_at` set.
2. **Fallback subdomain** — `<slug>.<PORTAL_BASE_DOMAIN>`.

No match → the portal renders a neutral "not configured" page.

---

## 4. One-time platform setup (apex + wildcard)

- DNS: `*.portal.ustowdispatch.cloud` → Railway web service.
- TLS: wildcard cert for `*.portal.ustowdispatch.cloud` (Railway-managed).
- API env: `PORTAL_BASE_DOMAIN=portal.ustowdispatch.cloud` on the API service.
- Web env: nothing portal-specific required; the web reads the incoming
  `Host` / `X-Forwarded-Host`. For **local dev** without wildcard DNS, set
  `PORTAL_DEV_HOST=<slug>.portal.ustowdispatch.cloud` on the web service to
  force-resolve a tenant.

---

## 5. Env vars summary

| Service | Var | Purpose | Default |
|---|---|---|---|
| api | `PORTAL_BASE_DOMAIN` | apex for fallback subdomains | `portal.ustowdispatch.cloud` |
| api | `JWT_PORTAL_SECRET` | portal-token signing key (override) | derived from `JWT_SECRET` |
| api | `JWT_PORTAL_TTL` | portal session length | `24h` |
| web | `PORTAL_DEV_HOST` | local-dev host override | _(unset)_ |
