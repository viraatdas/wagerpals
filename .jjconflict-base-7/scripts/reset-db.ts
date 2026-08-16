import { sql } from '@vercel/postgres';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

async function resetDatabase() {
  try {
    console.log('🔄 Starting comprehensive database reset...\n');

    // Step 1: Drop all tables (in reverse dependency order)
    console.log('🗑️  Dropping all tables...');
    await sql`DROP TABLE IF EXISTS activities CASCADE`;
    console.log('  ✓ Dropped activities table');
    
    await sql`DROP TABLE IF EXISTS bets CASCADE`;
    console.log('  ✓ Dropped bets table');
    
    await sql`DROP TABLE IF EXISTS events CASCADE`;
    console.log('  ✓ Dropped events table');
    
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    console.log('  ✓ Dropped users table\n');

    // Step 2: Create users table
    console.log('📦 Creating users table...');
    await sql`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        net_total DECIMAL(10,2) DEFAULT 0,
        total_bet DECIMAL(10,2) DEFAULT 0,
        streak INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('  ✓ Users table created\n');

    // Step 3: Create events table
    console.log('📦 Creating events table...');
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
    console.log('  ✓ Events table created\n');

    // Step 4: Create bets table
    console.log('📦 Creating bets table...');
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
    console.log('  ✓ Bets table created\n');

    // Step 5: Create activities table
    console.log('📦 Creating activities table...');
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
    console.log('  ✓ Activities table created\n');

    // Step 6: Create indexes for performance
    console.log('🔍 Creating indexes...');
    await sql`CREATE INDEX idx_bets_event_id ON bets(event_id)`;
    console.log('  ✓ Created index on bets.event_id');
    
    await sql`CREATE INDEX idx_bets_user_id ON bets(user_id)`;
    console.log('  ✓ Created index on bets.user_id');
    
    await sql`CREATE INDEX idx_activities_timestamp ON activities(timestamp DESC)`;
    console.log('  ✓ Created index on activities.timestamp');
    
    await sql`CREATE INDEX idx_events_status ON events(status)`;
    console.log('  ✓ Created index on events.status\n');

    // Step 7: Verify tables exist
    console.log('✅ Verifying database state...');
    const tableCheck = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    console.log('  Tables in database:', tableCheck.rows.map(r => r.table_name).join(', '));

    // Step 8: Verify all tables are empty
    const userCount = await sql`SELECT COUNT(*) as count FROM users`;
    const eventCount = await sql`SELECT COUNT(*) as count FROM events`;
    const betCount = await sql`SELECT COUNT(*) as count FROM bets`;
    const activityCount = await sql`SELECT COUNT(*) as count FROM activities`;
    
    console.log('\n📊 Record counts:');
    console.log(`  Users: ${userCount.rows[0].count}`);
    console.log(`  Events: ${eventCount.rows[0].count}`);
    console.log(`  Bets: ${betCount.rows[0].count}`);
    console.log(`  Activities: ${activityCount.rows[0].count}`);

    console.log('\n✨ Database reset complete!');
    console.log('🎉 All tables created fresh and ready to use!\n');
    
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Error resetting database:', error);
    console.error('Error details:', error.message);
    if (error.detail) {
      console.error('Detail:', error.detail);
    }
    process.exit(1);
  }
}

resetDatabase();

