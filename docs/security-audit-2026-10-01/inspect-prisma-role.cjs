// Read-only metadata audit using the supplied DATABASE_URL. No env files loaded,
// no credentials or patient records printed. Run in Render's app environment to
// establish its ACTUAL Prisma role; a Neon connector role is not equivalent.
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const supplied = process.env.DATABASE_URL;
if (!supplied) throw new Error('DATABASE_URL must be supplied through the environment');
const target = new URL(supplied);
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    !(target.hostname.endsWith('.neon.tech') || target.hostname === '127.0.0.1')) throw new Error('Unexpected database host');
const db = new PrismaClient({ datasourceUrl: supplied, log: [] });
db.$transaction(async tx => {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const role = await tx.$queryRaw`SELECT current_user AS connection_role, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname=current_user`;
  const tables = await tx.$queryRaw`SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`;
  const policies = await tx.$queryRaw`SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public'`;
  console.log(JSON.stringify({ host: target.hostname, database: target.pathname.slice(1), role, tables, policies }, null, 2));
}, { timeout: 30000 }).catch(e => { console.error('Metadata audit failed:', /^P\d{4}$/.test(e.code || '') ? e.code : 'DATABASE_ERROR'); process.exitCode = 1; }).finally(() => db.$disconnect());
