// Reads (and, with --apply, sets) Stack Auth's OAuth account merge strategy
// for this project. Setting it to 'link_method' is what makes "one human,
// one account" possible at the Stack Auth layer: email/password sign-up and
// Google sign-in for the same *verified* email land on one Stack Auth
// account instead of two, so the local `users` row keyed on that Stack Auth
// id is automatically unified too.
//
// Usage:
//   npx tsx scripts/set-stack-account-linking.ts            # read + print current setting
//   npx tsx scripts/set-stack-account-linking.ts --apply     # set it to link_method
//   npx tsx scripts/set-stack-account-linking.ts --help
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env.local') });

import { StackAdminApp } from '@stackframe/stack';

const HELP_TEXT = `
Read or set Stack Auth's OAuth account merge strategy (oauthAccountMergeStrategy).

Usage:
  npx tsx scripts/set-stack-account-linking.ts            Print the current setting
  npx tsx scripts/set-stack-account-linking.ts --apply     Set it to 'link_method'
  npx tsx scripts/set-stack-account-linking.ts --help      Show this help

Requires in the environment (.env.local):
  NEXT_PUBLIC_STACK_PROJECT_ID
  NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY
  STACK_SECRET_SERVER_KEY
  STACK_SUPER_SECRET_ADMIN_KEY   (Stack Auth dashboard → project → API keys → "Super secret admin key")

If STACK_SUPER_SECRET_ADMIN_KEY is not set, this prints manual instructions
for flipping the setting by hand in the Stack Auth dashboard and exits 0 —
plenty of deployments will only ever do this manually, so that is not an
error.
`;

const MANUAL_INSTRUCTIONS = `
Manual steps (Stack Auth dashboard):
  1. Go to https://app.stack-auth.com and open this project.
  2. Navigate to the Auth methods / sign-in configuration section.
  3. Find "OAuth account merge strategy" and set it to "Link method".
     - link_method (recommended): an OAuth sign-in (e.g. Google) links onto
       an existing account when its *verified* email matches — this is what
       makes "one human, one account" work.
     - raise_error: OAuth sign-in is rejected outright if the email matches
       an existing account.
     - allow_duplicates: a *new*, separate account is created even when the
       email matches an existing one — this is what produces two accounts
       for one human, and is the setting this whole task exists to fix.
  4. Confirm Google is configured to return verified emails, and that this
     project's email-verification requirement is enabled — an unverified
     email must never be able to claim an existing account.

See docs/IDENTITY.md for the full write-up. Once STACK_SUPER_SECRET_ADMIN_KEY
is available, this can be set programmatically with:
  npm run stack:link-accounts -- --apply
`;

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_STACK_PROJECT_ID',
  'NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY',
  'STACK_SECRET_SERVER_KEY',
] as const;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function main() {
  const { apply, help } = parseArgs();

  if (help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (!process.env.STACK_SUPER_SECRET_ADMIN_KEY) {
    console.log('ℹ️  STACK_SUPER_SECRET_ADMIN_KEY is not set — this setting can only be changed by hand.');
    console.log(MANUAL_INSTRUCTIONS);
    process.exit(0);
  }

  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    for (const name of missing) {
      console.error(`   - ${name}`);
    }
    console.error('\nSet these in .env.local before running this script.');
    process.exit(1);
  }

  const stackAdmin = new StackAdminApp({
    tokenStore: null,
    projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID!,
    publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY!,
    secretServerKey: process.env.STACK_SECRET_SERVER_KEY!,
    superSecretAdminKey: process.env.STACK_SUPER_SECRET_ADMIN_KEY!,
  });

  const project = await stackAdmin.getProject();
  const current = project.config.oauthAccountMergeStrategy;

  console.log(`Current oauthAccountMergeStrategy: ${current}`);
  if (current === 'allow_duplicates') {
    console.log('⚠️  ⚠️  ⚠️   WARNING: allow_duplicates is set. This is what actively creates the');
    console.log('             duplicate accounts (one for password sign-up, one for Google) that');
    console.log('             this task is cleaning up. Re-run with --apply to fix it.');
  }

  if (!apply) {
    if (current !== 'link_method') {
      console.log('\nRun again with --apply to set it to link_method.');
    }
    process.exit(0);
  }

  if (current === 'link_method') {
    console.log('✅ Already link_method — nothing to do.');
    process.exit(0);
  }

  await project.update({ config: { oauthAccountMergeStrategy: 'link_method' } });
  console.log('✅ oauthAccountMergeStrategy set to link_method.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed to read/update Stack Auth account linking setting:', err?.message ?? err);
  process.exit(1);
});
