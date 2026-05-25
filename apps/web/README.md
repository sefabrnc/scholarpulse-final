# @scholarpulse/web

Standalone web frontend with desk/timeline flow + section backbones.

> **Cloudflare Pages deploy (TR):** [`docs/KURULUM_REHBERI_COLAB_CF.md`](../../docs/KURULUM_REHBERI_COLAB_CF.md)

## Standalone guarantee

- `apps/web` does not import files from the old `scholarpulse` repository.
- All app pages, hooks, and API routes are self-contained under `apps/web`.
- Cross-repo import paths (for example `../../../../scholarpulse/...`) are not used.

## What is implemented

- Existing desk/timeline/split/pdf-overlay flow remains at `/` and `/desk`.
- Standalone section routes:
  - `/feed`
  - `/library`
  - `/notes`
  - `/statistics`
  - `/watch`
  - `/channels`
  - `/channels/[id]`
  - `/profile`
  - `/settings`
- Public/shareable routes (no app nav shell):
  - `/paper/[doi]`
  - `/cite/[id]`
  - `/timeline/[sid]`
  - `/search`
  - `/authors/[name]`
  - `/topics/[name]`
  - `/offline`
- PWA + dark mode:
  - `public/manifest.webmanifest`
  - `public/sw.js`
  - `components/pwa/PwaRegister.tsx`
  - `components/theme/ThemeClient.tsx`
- SEO:
  - `app/sitemap.ts`
  - JSON-LD on public paper page
- Common API client at `lib/api/client.ts`:
  - central `x-user-id` handling
  - standard error compatibility with `{ error: { code, message } }`
- User-scope storage at `lib/userScope.ts` for profile/settings/theme persistence.

## Backend endpoint mapping by section

- Desk
  - `GET /api/cite/timeline` (`id` single seed or `ids` comma-separated multi-seed merge)
  - `GET /api/cite/elements`
- Feed
  - `GET /api/feed`
  - `GET/POST /api/user/interests`
  - `GET /api/recommend`
- Library
  - `GET/POST /api/collections`
  - `POST /api/export/library`
  - `GET /api/resolve`
  - `POST /api/library/import`
  - `POST /api/papers/upload`
  - Multi-seed timeline preview: `components/library/LibraryTimelinePreview.tsx` (library page)
- Notes
  - `GET/POST /api/annotations`
  - `DELETE /api/annotations/:id`
- Statistics
  - aggregates from feed, recommend, collections, annotations, sessions
- Channels / Watch
  - `GET /api/channels`
  - `GET/POST /api/user/interests`
  - channel detail merges feed + recommend preview
- Profile / Settings
  - `GET /api/user/me` (scope probe)
  - `DELETE /api/user/me` (GDPR cascade when upstream configured)
  - local profile/settings persistence + `sp-user-id` cookie for middleware

## CF Pages auth compatibility

`middleware.ts`:

- Resolves user id from Supabase session (when env set), `x-user-id` header, or `sp-user-id` cookie.
- Forwards `x-user-id` on every matched request for API route passthrough.
- Public vs protected route lists live in `lib/auth/routes.ts`.
- Optional gate via `SP_REQUIRE_AUTH=1` redirects protected sections to `/profile?auth=required`.
- OAuth callback at `/auth/callback` exchanges `code` via `@supabase/ssr` when Supabase env is set.

See `apps/web/.env.example` for all auth-related variables.

To enable Supabase auth on Cloudflare Pages:

1. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`).
2. Configure Supabase redirect URL: `https://YOUR_DOMAIN/auth/callback`.
3. Deploy with OpenNext Cloudflare adapter (`@opennextjs/cloudflare`).

Related env vars:

- `SCHOLARPULSE_API_BASE_URL` - upstream Worker passthrough
- `NEXT_PUBLIC_SITE_URL` - sitemap absolute URLs
- `SP_REQUIRE_AUTH` - optional auth gate (`0` default)

## Run

From repository root:

```bash
corepack pnpm install
corepack pnpm --filter @scholarpulse/web dev
```

Optional upstream worker binding:

```bash
SCHOLARPULSE_API_BASE_URL=http://127.0.0.1:8787
```

Validation:

```bash
corepack pnpm --filter @scholarpulse/web typecheck
corepack pnpm --filter @scholarpulse/web build
```

## Known gaps

- PWA manifest references `icon-192.png` and `icon-512.png` (assets still TODO).
- Supabase OAuth token exchange in `/auth/callback` requires production Supabase redirect URL wiring.
- Dedicated `/api/statistics` backend endpoint remains future work; UI derives summary locally.
