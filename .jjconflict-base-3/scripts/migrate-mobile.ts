// Script to run mobile migration
import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runMigration() {
  console.log('🚀 Running mobile app migration...\n');

  try {
    console.log('1. Adding username_selected column to users table...');
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username_selected BOOLEAN DEFAULT FALSE`;
    console.log('✅ username_selected column added\n');

    console.log('2. Setting username_selected = TRUE for existing users...');
    await sql`UPDATE users SET username_selected = TRUE WHERE username_selected IS NULL`;
    console.log('✅ Existing users updated\n');

    console.log('3. Updating push_subscriptions table schema...');
    await sql`ALTER TABLE push_subscriptions ALTER COLUMN p256dh DROP NOT NULL`;
    await sql`ALTER TABLE push_subscriptions ALTER COLUMN auth DROP NOT NULL`;
    console.log('✅ Removed NOT NULL constraints\n');

    console.log('4. Adding mobile push notification support columns...');
    await sql`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS expo_token TEXT`;
    await sql`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'web'`;
    console.log('✅ Added expo_token and platform columns\n');

    console.log('5. Updating existing push subscriptions...');
    await sql`UPDATE push_subscriptions SET platform = 'web' WHERE platform IS NULL`;
    console.log('✅ Existing subscriptions marked as web\n');

    console.log('🎉 Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();





