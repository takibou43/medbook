# Doctor subscription administration

The RTL administration page at `/admin/subscriptions` lists individual doctors,
subscription/trial status, remaining time, expiry warnings and an audit history.
Search and global filters separate owned-clinic subscriptions from individual billing.

## Calendar pricing

- 5,000 DZD buys one actual calendar month. 60,000 DZD buys twelve months, including leap days.
- Partial payments buy the corresponding fraction of the actual next billing period. For example, 8,000 DZD buys one month plus 60% of the following period; its day count depends on the start date.
- Monthly anniversaries preserve the original day in Algeria. A January 31 anchor goes to February 28/29 and returns to March 31.
- Consecutive payments preserve the original anchor and cumulative amount. Splitting a payment does not lose partial-day credit. After an expired gap or a manually changed expiry, a new schedule starts.
- Early renewal starts at the existing expiry; expired subscriptions start at activation. No existing expiry is rewritten by deployment.
- Newly granted first-approval trials use one calendar month once. Existing trials and other reward/clinic policies are unchanged.

## Mutation and audit guarantees

The new subscription endpoint accepts a manual receipt (integer DZD amount, paid date,
method and transfer reference when relevant), the expected doctor version and expiry.
Duration is computed on the server. Client-provided durations, month counts, prices,
card data or payment-success flags are rejected. Supported manual methods are cash,
CCP transfer and bank transfer. The amount ceiling is 600,000 DZD per operation.

The doctor row is locked before reading the prior state and latest subscription ledger.
The expiry and audit event are committed in the same transaction. Each event records
actual added milliseconds, pricing basis, amount, actor, previous/new expiry and the
calendar anchor/cumulative entitlement. It reuses the existing AuditLog JSON field;
no Prisma schema or migration change is required. A stale request returns 409 and a
ledger write failure rolls back the subscription change.

Stop requires a reason and preserves the expiry while time continues to pass. Resume
requires remaining time and adds no paid duration. Both preserve the billing anchor.
Legacy admin month-count renewals also use calendar months, with their legacy lack of
a payment receipt explicitly visible in history.

## Payment integration and deployment

EDAHABIA payment simulation remains separate from production. No card collection,
provider account, automatic debit or live payment processing is enabled here.
Vercel/Render/Neon plans and deployment commands are unchanged.

Tests cover short months, leap years, end-of-month anchors, split payments, invalid
amounts, admin-only routes, stale and concurrent requests, ledger rollback, and the
existing booking/admission workload in isolated PostgreSQL CI.
