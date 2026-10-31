# Cloudflare Pages deployment

The complete application runs as a static Vue SPA plus same-origin Pages Functions at `/api/*`, backed by Cloudflare D1. No external Node server, container, CORS configuration, SQLite file path, or public API URL is required. Docker development remains available with the original local SQLite API.

## 1. Account and databases

Use a **Workers Paid** subscription for this application. Pages Functions use Workers CPU limits; the free plan's 10 ms CPU allowance is insufficient for the existing scrypt password hashing. The paid plan's default CPU budget is sufficient for this workload. Do not reduce password-hashing parameters to fit the free tier. Local workerd tests verify compatibility but do not enforce production billing/CPU limits.

Authenticate locally and create separate databases:

```sh
npm ci
npx wrangler login
npx wrangler d1 create rol-familiar
npx wrangler d1 create rol-familiar-preview
```

Edit `wrangler.jsonc`:

| Parameter | Value |
| --- | --- |
| `name` | Your Pages project name, initially `rol-familiar` |
| `pages_build_output_dir` | `./dist` |
| `compatibility_date` | `2026-10-30` |
| `compatibility_flags` | `["nodejs_compat"]` |
| `d1_databases[0].binding` | `DB` (required exact name) |
| `d1_databases[0].database_name` | `rol-familiar`, or the production database name you created |
| `d1_databases[0].database_id` | Replace `00000000-0000-0000-0000-000000000000` with the production D1 UUID |
| `d1_databases[0].migrations_dir` | `migrations` |
| `env.preview.d1_databases[0].binding` | `DB` |
| `env.preview.d1_databases[0].database_name` | `rol-familiar-preview`, or your preview database name |
| `env.preview.d1_databases[0].database_id` | Replace `00000000-0000-0000-0000-000000000001` with the preview D1 UUID |
| `env.preview.d1_databases[0].migrations_dir` | `migrations` |

The UUIDs are configuration identifiers, not secrets. Keep them in the committed Wrangler configuration. Production and preview must not point to the same database. Wrangler is the source of truth for compatibility and bindings; edit the file rather than conflicting dashboard values.

Apply migrations **before first use**, and before deploying future code that requires a new migration:

```sh
npm run cf:migrate:production
npm run cf:migrate:preview
```

The initial migration creates users, sessions, roles, notes, append-only note entries, members, indexes, revision guards and persisted authentication-attempt counters. Applying migrations does not create an account or copy the Docker database automatically.

## 2. Initialize data: choose one path

### New installation

Generate SQL for the initial account. The file contains only the password hash, while the generated temporary password is printed once:

```sh
npm run cf:admin -- --file /tmp/rol-familiar-admin.private.sql
npx wrangler d1 execute DB --remote --file /tmp/rol-familiar-admin.private.sql
```

Run separately with a different generated file and `--env preview` for preview. The initial account has username `admin`, nombre `Superadmin` and rol_usuario `superadmin`. Sign in with the generated password and complete the mandatory password-change dialog. Admin initialization refuses duplicate IDs/usernames; it never resets an existing password. Do not add these private SQL files to Git.

The superadmin account manages the application but does not participate in weekly assignments. Create at least **two active usuario/admin accounts** through the application to generate a week without consecutive assignments to the same person. Newly created accounts use the existing temporary-password policy and require a password change on first login.

### Move existing Docker/SQLite data

Use this path instead of generating a new admin account. Stop application writes while taking the export and importing it into an **empty, migrated** D1 database. The export preserves IDs, usernames, hashes, user roles, assignment history, notes, note entries and completion status. Sessions are omitted so users sign in again. It does not alter the source database.

With Docker running:

```sh
docker compose exec -T app npm run cf:export -- --file /app/data/cloudflare-export.private.sql
docker compose cp app:/app/data/cloudflare-export.private.sql /tmp/rol-familiar-export.private.sql
npx wrangler d1 execute DB --remote --file /tmp/rol-familiar-export.private.sql
```

For a local SQLite file:

```sh
SQLITE_PATH=/absolute/path/rol-familiar.sqlite npm run cf:export -- --file /tmp/rol-familiar-export.private.sql
npx wrangler d1 execute DB --remote --file /tmp/rol-familiar-export.private.sql
```

Do not import production user data into preview unless you explicitly intend to do so. SQL exports contain private user data and password hashes: store them privately and remove temporary copies after a successful import. Export uses a consistent read transaction; completed notes are restored after entries to respect immutability triggers. Duplicate IDs or usernames fail rather than overwrite data. For a failed import, inspect the target before retrying; do not repeatedly run a partially imported file.

## 3. Cloudflare Pages dashboard settings

Connect the GitHub repository `lobomacz/rol-familiar` under **Workers & Pages → Create → Pages → Connect to Git**. Use:

| Pages setting | Production | Preview |
| --- | --- | --- |
| Framework preset | Vue | Vue |
| Production branch | `main` (or your selected production branch) | Other allowed branches |
| Root directory | Repository root (leave blank) | Same |
| Build command | `npm run build` | Same |
| Build output directory | `dist` | Same |
| Build environment variable `NODE_VERSION` | `24` | `24` |
| D1 binding name | `DB`, production database | `DB`, preview database |
| Compatibility date | `2026-10-30`, from Wrangler | Inherited from Wrangler |
| Compatibility flag | `nodejs_compat`, from Wrangler | Inherited from Wrangler |
| Application runtime secrets | None | None |

The checked-in `.node-version` also pins Node's major version. Do not set `NODE_ENV=production` before dependency installation: the build needs Vite and Wrangler from devDependencies. Do not set `NPM_FLAGS=--omit=dev`.

**Complete environment-variable inventory:** `NODE_VERSION=24` is the only dashboard environment variable needed. There are no required `VITE_*`, `DATABASE_URL`, `SESSION_SECRET`, `SQLITE_PATH`, `API_PORT`, `COOKIE_SECURE`, `USER_PASSWORD`, or bootstrap-password variables in the Pages application. `DB` is a D1 binding, not an environment-variable string. Secure cookies are automatic on HTTPS. The API uses relative same-origin `/api` URLs for production, preview and custom domains.

The build only builds assets; it never runs migrations, seeds users or uploads the local database. Functions in `functions/api/[[path]].js` are compiled automatically by Pages' Git integration. `public/_routes.json` invokes Functions only for API requests, allowing static assets and SPA routes to use the static service. The Pages SPA fallback handles `/login`, `/roles`, `/usuarios/nuevo`, and other client paths without a broad `_redirects` rule that might capture API requests.

For manual CLI deployment after creating a Pages project:

```sh
npm run cf:deploy
```

A Git-integrated deployment does not require an API token in Pages settings. For your own external CI instead of interactive `wrangler login`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` may be needed in that CI's secret store. Grant only the Pages/D1 permissions the CI commands actually use; these values are not app runtime bindings or frontend variables.

## 4. Test the actual Cloudflare runtime locally

```sh
npm run cf:migrate:local
npm run cf:admin -- --file /tmp/rol-familiar-local-admin.private.sql
npx wrangler d1 execute DB --local --file /tmp/rol-familiar-local-admin.private.sql
npm run cf:dev
```

Open `http://localhost:8788`. Local D1 state is isolated under ignored `.wrangler/`, separate from Docker's SQLite volume. The all-zero database UUID works for local development only; production needs your real UUIDs. `npm run cf:dev` builds and serves the production assets together with Functions, so changes require a rebuild/restart of this preview. `npm run dev` retains the existing fast Vite/Docker workflow on port 5174.

Validation commands:

```sh
npm test
npm run test:cloudflare
```

The Cloudflare test uses workerd and real local D1, covering scrypt credentials, cookies, first-login password changes, permissions, concurrent weekly initialization, reciprocal swaps, notes, role changes, activation, password resets, and logout. D1 multi-statement writes use atomic batches with revision checks to reject stale concurrent writes instead of partially applying them. The current-week initializer retries conflicts safely; other stale writes return HTTP 409 so clients can refresh/retry. Authentication throttles persist in D1 across isolates. All API responses disable caching. No in-memory session state is used.

Sources: [Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/), [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers CPU limits and pricing](https://developers.cloudflare.com/workers/platform/pricing/).
