import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Generate a random 6-digit code
function generateGroupCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate a unique ID
function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

async function addPublicGroups() {
  console.log('🚀 Adding public/private groups feature...\n');

  try {
    // Step 1: Add is_public column to groups table
    console.log('1. Adding is_public column to groups table...');
    await sql`
      ALTER TABLE groups
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE
    `;
    console.log('✅ is_public column added\n');

    // Step 2: Set all existing groups to private
    console.log('2. Setting all existing groups to private...');
    await sql`
      UPDATE groups
      SET is_public = FALSE
      WHERE is_public IS NULL
    `;
    console.log('✅ All existing groups set to private\n');

    // Step 3: Check if SF group already exists
    console.log('3. Checking if SF public group exists...');
    const existingSF = await sql`
      SELECT * FROM groups WHERE name = 'SF' AND is_public = TRUE
    `;

    let sfGroupId: string;
    let creatorUserId: string;

    if (existingSF.rows.length > 0) {
      console.log('✅ SF public group already exists');
      sfGroupId = existingSF.rows[0].id;
      creatorUserId = existingSF.rows[0].created_by;
    } else {
      // Get the first user to be the creator
      console.log('4. Getting system user for group creation...');
      const users = await sql`SELECT id FROM users LIMIT 1`;
      
      if (users.rows.length === 0) {
        console.error('❌ No users found in database. Please create a user first.');
        process.exit(1);
      }

      creatorUserId = users.rows[0].id;
      sfGroupId = '111111'; // Fixed code for easy joining

      console.log(`✅ Using user ${creatorUserId} as creator\n`);

      // Create SF public group
      console.log('5. Creating SF public group...');
      await sql`
        INSERT INTO groups (id, name, created_by, is_public, created_at)
        VALUES (${sfGroupId}, 'SF', ${creatorUserId}, TRUE, CURRENT_TIMESTAMP)
        ON CONFLICT (id) DO UPDATE SET is_public = TRUE
      `;
      console.log(`✅ SF public group created with code: ${sfGroupId}\n`);
    }

    // Step 4: Create sample SF events
    console.log('6. Creating sample SF events...');
    
    const sfEvents = [
      {
        id: generateId(),
        title: 'Will the Warriors make the playoffs this season?',
        description: 'NBA Western Conference playoff berth for Golden State Warriors',
        side_a: 'Yes, playoffs bound! 🏀',
        side_b: 'No playoffs this year 😢',
        end_time: new Date('2025-04-13').getTime(), // End of NBA regular season
      },
      {
        id: generateId(),
        title: 'Golden Gate Bridge closed for maintenance in 2025?',
        description: 'Will the Golden Gate Bridge need to close for major maintenance this year?',
        side_a: 'Yes, closure ahead 🌉',
        side_b: 'No closure in 2025 ✅',
        end_time: new Date('2025-12-31').getTime(),
      },
      {
        id: generateId(),
        title: 'Tech layoffs will exceed 50k in SF Bay Area by end of 2025',
        description: 'Will the Bay Area tech sector lay off more than 50,000 employees this year?',
        side_a: 'Yes, over 50k layoffs 📉',
        side_b: 'No, under 50k 📈',
        end_time: new Date('2025-12-31').getTime(),
      },
      {
        id: generateId(),
        title: 'SF will have a new food hall open in 2025',
        description: 'Will San Francisco open a new food hall by year end?',
        side_a: 'Yes, new food hall! 🍜',
        side_b: 'No new food hall 🚫',
        end_time: new Date('2025-12-31').getTime(),
      },
      {
        id: generateId(),
        title: 'BART will add a new line or extension in 2025',
        description: 'Will BART announce or open a new line or extension this year?',
        side_a: 'Yes, BART expansion! 🚇',
        side_b: 'No new BART lines 🛑',
        end_time: new Date('2025-12-31').getTime(),
      }
    ];

    // Check which events already exist
    for (const event of sfEvents) {
      const existing = await sql`SELECT id FROM events WHERE title = ${event.title}`;
      
      if (existing.rows.length === 0) {
        await sql`
          INSERT INTO events (id, title, description, side_a, side_b, end_time, status, group_id, created_at)
          VALUES (
            ${event.id},
            ${event.title},
            ${event.description},
            ${event.side_a},
            ${event.side_b},
            ${event.end_time},
            'active',
            ${sfGroupId},
            CURRENT_TIMESTAMP
          )
        `;
        console.log(`   ✅ Created: ${event.title}`);
      } else {
        console.log(`   ⏭️  Skipped (exists): ${event.title}`);
      }
    }

    console.log('');

    // Step 5: Create an index for public groups
    console.log('7. Creating index for public groups...');
    await sql`
      CREATE INDEX IF NOT EXISTS idx_groups_is_public ON groups(is_public)
    `;
    console.log('✅ Index created\n');

    // Step 6: Summary
    console.log('📊 Migration Summary:');
    const publicGroups = await sql`SELECT * FROM groups WHERE is_public = TRUE`;
    const privateGroups = await sql`SELECT COUNT(*) as count FROM groups WHERE is_public = FALSE`;
    
    console.log(`   Public groups: ${publicGroups.rows.length}`);
    publicGroups.rows.forEach(g => {
      console.log(`      - ${g.name} (code: ${g.id})`);
    });
    console.log(`   Private groups: ${privateGroups.rows[0].count}`);
    
    const sfEventsCount = await sql`
      SELECT COUNT(*) as count FROM events WHERE group_id = ${sfGroupId}
    `;
    console.log(`   SF events: ${sfEventsCount.rows[0].count}`);
    console.log('');

    console.log('🎉 Public groups feature added successfully!');
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Update API endpoints to return public groups to all users');
    console.log('   2. Users can join SF group with code: 111111');
    console.log('   3. Public group events are visible to everyone!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addPublicGroups();

