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

# Historical migrations have no initial baseline. Match the native startup's
# non-destructive schema sync, then install the same idempotent guards used in CI.
# Never use --accept-data-loss or seed real/example patient accounts here.
npx prisma db push --schema ../prisma/schema.prisma --skip-generate
psql_url=$(node -e '
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("schema");
  process.stdout.write(url.toString());
')
for guard in \
  20260923140000_release_cancelled_slots \
  20260924170000_add_review_guards \
  20260930120000_family_treatment_referrals_stats \
  20261001193000_clinic_referral_discount \
  20261003180000_clinic_doctor_terms \
  20261011200000_follow_up_shared_minute
do
  psql "$psql_url" -v ON_ERROR_STOP=1 -q -f "../prisma/migrations/$guard/migration.sql"
done

exec node dist/index.js
