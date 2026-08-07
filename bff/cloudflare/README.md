# Hadirly same-origin BFF

This directory contains the server-side foundation for moving browser authentication away from `localStorage.auth_token` to an HttpOnly host cookie.

## Production status

`bff/runtime-status.json` is the source-of-truth activation flag. It must remain `productionEnabled: false` until `https://hadirly.org/api/auth/session` is served by this runtime and a real login/refresh/logout smoke test succeeds. The current frontend must continue its legacy token path until then to avoid downtime.

## Intended route

The Worker is scoped to `hadirly.org/api/*`. Static frontend hosting can remain separate; only `/api/*` needs the server-side runtime. Activating the route requires control of the production DNS/Cloudflare zone and must not be inferred from a merged repository change.

## Cookie contract

- Name: `__Host-hadirly_session`
- `HttpOnly`
- `Secure`
- `SameSite=Strict`
- `Path=/`
- no `Domain` attribute
- `Max-Age` capped at 28,800 seconds (8 hours)

The raw session bearer is accepted only in request memory, in the HttpOnly cookie, or once by `/api/auth/exchange` during the migration bridge. Responses recursively remove exact `token` / `auth_token` fields.

## CSRF and origin policy

Every mutation requires all of the following:

- same-origin `Origin` or same-origin `Referer` fallback;
- no `Sec-Fetch-Site: cross-site`;
- `X-Hadirly-CSRF: 1`;
- `SameSite=Strict` session cookie.

The BFF does not enable CORS. Session/auth/API responses are `Cache-Control: no-store`.

## Activation sequence

1. Deploy the Worker route and verify `/api/*` on `hadirly.org` without changing frontend auth.
2. Smoke-test login/session/logout directly against the BFF.
3. Add the frontend migration bridge: send the existing localStorage bearer once to `/api/auth/exchange`, then immediately delete it after success.
4. Switch new login and API calls to same-origin `/api/*` with browser credentials.
5. Stop writing `auth_token` to localStorage.
6. After the compatibility window, remove every remaining read of `auth_token` and set `productionEnabled: true` in the same cutover PR.
7. Disable `ALLOW_LEGACY_EXCHANGE` after migrated sessions have expired.

The regression test intentionally fails if `productionEnabled` becomes true while any frontend `auth_token` consumer remains.
