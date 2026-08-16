import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function migrateToLegacy() {
  console.log('🚀 Starting migration to The Legacy group...\n');

  try {
    // First, verify The Legacy group exists
    console.log('1. Verifying The Legacy group exists...');
    const legacyGroup = await sql`
      SELECT * FROM groups WHERE id = '000000'
    `;
    
    if (legacyGroup.rows.length === 0) {
      console.error('❌ The Legacy group (ID: 000000) does not exist!');
      console.error('Please create the group first before running this migration.');
      process.exit(1);
    }
    
    console.log('✅ The Legacy group found:', legacyGroup.rows[0].name);
    console.log('   Created by:', legacyGroup.rows[0].created_by);
    console.log('');

    // Count events before migration
    console.log('2. Counting events before migration...');
    const beforeCount = await sql`
      SELECT 
        group_id,
        COUNT(*) as count
      FROM events
      GROUP BY group_id
      ORDER BY count DESC
    `;
    
    console.log('Events by group before migration:');
    beforeCount.rows.forEach(row => {
      console.log(`   Group ${row.group_id}: ${row.count} events`);
    });
    console.log('');

    // Get total count
    const totalEvents = await sql`SELECT COUNT(*) as count FROM events`;
    const total = parseInt(totalEvents.rows[0].count);
    console.log(`📊 Total events to migrate: ${total}`);
    console.log('');

    // Perform the migration
    console.log('3. Migrating all events to The Legacy group...');
    const result = await sql`
      UPDATE events
      SET group_id = '000000'
      WHERE group_id != '000000'
    `;
    
    console.log(`✅ Updated ${result.rowCount} events`);
    console.log('');

    // Verify migration
    console.log('4. Verifying migration...');
    const afterCount = await sql`
      SELECT 
        group_id,
        COUNT(*) as count
      FROM events
      GROUP BY group_id
      ORDER BY count DESC
    `;
    
    console.log('Events by group after migration:');
    afterCount.rows.forEach(row => {
      console.log(`   Group ${row.group_id}: ${row.count} events`);
    });
    console.log('');

    // Show sample of migrated events
    console.log('5. Sample of events now in The Legacy group:');
    const sampleEvents = await sql`
      SELECT id, title, group_id, created_at
      FROM events
      WHERE group_id = '000000'
      ORDER BY created_at DESC
      LIMIT 5
    `;
    
    sampleEvents.rows.forEach(event => {
      console.log(`   - ${event.title} (${event.id})`);
    });
    console.log('');

    console.log('🎉 Migration completed successfully!');
    console.log('📝 Next steps:');
    console.log('   1. Open The Legacy group in your app');
    console.log('   2. Review all events');
    console.log('   3. Manually remove any events that don\'t belong');
    console.log('');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateToLegacy();

