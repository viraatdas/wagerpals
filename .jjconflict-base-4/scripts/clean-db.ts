import { sql } from '@vercel/postgres';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

async function cleanDatabase() {
  try {
    console.log('🧹 Cleaning database...');

    // Step 1: Drop tables in reverse order (to respect foreign keys)
    console.log('Dropping tables...');
    await sql`DROP TABLE IF EXISTS activities CASCADE`;
    await sql`DROP TABLE IF EXISTS bets CASCADE`;
    await sql`DROP TABLE IF EXISTS events CASCADE`;
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    console.log('✅ All tables dropped');

    // Step 2: Recreate users table
    console.log('Creating users table...');
    await sql`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        net_total DECIMAL(10,2) DEFAULT 0,
        streak INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Step 3: Recreate events table
    console.log('Creating events table...');
    await sql`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        side_a TEXT NOT NULL,
        side_b TEXT NOT NULL,
        end_time BIGINT NOT NULL,
        status TEXT DEFAULT 'active',
        winning_side TEXT,
        resolved_at BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Step 4: Recreate bets table
    console.log('Creating bets table...');
    await sql`
      CREATE TABLE bets (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        username TEXT NOT NULL,
        side TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        is_late BOOLEAN DEFAULT FALSE,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Step 5: Recreate activities table with nullable username
    console.log('Creating activities table...');
    await sql`
      CREATE TABLE activities (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_title TEXT NOT NULL,
        username TEXT,
        side TEXT,
        amount DECIMAL(10,2),
        winning_side TEXT,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Step 6: Create indexes
    console.log('Creating indexes...');
    await sql`CREATE INDEX idx_bets_event_id ON bets(event_id)`;
    await sql`CREATE INDEX idx_bets_user_id ON bets(user_id)`;
    await sql`CREATE INDEX idx_activities_timestamp ON activities(timestamp DESC)`;
    await sql`CREATE INDEX idx_events_status ON events(status)`;

    console.log('✅ Database cleaned and recreated successfully!');
    console.log('📊 Tables created: users, events, bets, activities');
    console.log('🎉 Database is now ready for use!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
    process.exit(1);
  }
}

cleanDatabase();

