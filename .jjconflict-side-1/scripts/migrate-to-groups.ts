import { sql } from '@vercel/postgres';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

async function migrate() {
  try {
    console.log('🚀 Starting migration to add groups...');

    // Create groups table
    console.log('Creating groups table...');
    await sql`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create group_members table
    console.log('Creating group_members table...');
    await sql`
      CREATE TABLE IF NOT EXISTS group_members (
        id SERIAL PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'pending',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, user_id)
      )
    `;

    // Create comments table
    console.log('Creating comments table...');
    await sql`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Check if group_id column exists in events table
    console.log('Checking if group_id column exists in events table...');
    const columnCheck = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'events' AND column_name = 'group_id'
    `;

    if (columnCheck.rows.length === 0) {
      console.log('Adding group_id column to events table...');
      
      // Check if there are any existing events
      const existingEvents = await sql`SELECT COUNT(*) as count FROM events`;
      const eventCount = parseInt(existingEvents.rows[0].count);
      
      if (eventCount > 0) {
        console.log(`⚠️  Warning: Found ${eventCount} existing events.`);
        console.log('⚠️  These events will need to be manually assigned to groups.');
        console.log('⚠️  Skipping migration to avoid data loss.');
        console.log('⚠️  Please manually add group_id column and assign events to groups.');
        process.exit(1);
      }

      // Only proceed if no existing events
      console.log('No existing events found. Adding group_id column...');
      
      // Add group_id column (nullable first)
      await sql.query(`
        ALTER TABLE events
        ADD COLUMN group_id TEXT
      `);
      
      // Add foreign key constraint
      await sql.query(`
        ALTER TABLE events
        ADD CONSTRAINT events_group_id_fkey 
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
      `);
      
      // Make it NOT NULL (safe since no events exist)
      await sql.query(`
        ALTER TABLE events
        ALTER COLUMN group_id SET NOT NULL
      `);
    } else {
      console.log('group_id column already exists in events table');
    }

    // Add total_bet column to users if it doesn't exist
    console.log('Checking if total_bet column exists in users table...');
    const totalBetCheck = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'total_bet'
    `;

    if (totalBetCheck.rows.length === 0) {
      console.log('Adding total_bet column to users table...');
      await sql.query(`
        ALTER TABLE users
        ADD COLUMN total_bet DECIMAL(10,2) DEFAULT 0
      `);
    }

    // Create indexes
    console.log('Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_comments_event_id ON comments(event_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_events_group_id ON events(group_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id)`;

    console.log('✅ Migration completed successfully!');
    console.log('📊 New tables created: groups, group_members, comments');
    console.log('📊 Events table updated with group_id column');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  }
}

migrate();

