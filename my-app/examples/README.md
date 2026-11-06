# Code examples

Every code sample on the site's Backend Technologies pages comes from this folder.
`npm run snippets` copies the `#region` blocks into the site, so what readers see is
the code these tests run.

## Run them yourself

```bash
cd examples
npm install
docker compose up -d --wait redis postgres rustfs
npm run typecheck
npm test
```

The tests use real services: Redis 8, Postgres 17, RustFS 1.0.4 and nginx. Postgres uses
port 5433 and nginx uses 8088, so they do not clash with services already on your machine.

The Redis tests call `FLUSHDB`, and some tests drop tables. Only point them at these
local containers.
