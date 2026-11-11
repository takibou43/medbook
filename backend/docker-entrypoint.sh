#!/bin/sh
set -eu

# Compose supplies the local DB password separately: encode reserved URL characters.
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL
  DATABASE_URL=$(node -e '
    const password = process.env.POSTGRES_PASSWORD;
    if (!password) throw new Error("POSTGRES_PASSWORD is required for the Docker database");
    process.stdout.write(`postgresql://medbook:${encodeURIComponent(password)}@postgres:5432/medbook?schema=public`);
  ')
fi

# Startup never synchronizes the schema or replays SQL. Provisioning/migrations
# are explicit operations; restarting must not alter existing medical records.
if [ "$#" -eq 0 ]; then set -- node dist/index.js; fi
exec "$@"
