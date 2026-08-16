import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function clearAllData() {
  try {
    console.log('🗑️  Clearing all data from database...\n');

    // Delete in order to respect foreign key constraints
    console.log('Deleting activities...');
    await sql`DELETE FROM activities`;
    
    console.log('Deleting bets...');
    await sql`DELETE FROM bets`;
    
    console.log('Deleting events...');
    await sql`DELETE FROM events`;
    
    console.log('Deleting users...');
    await sql`DELETE FROM users`;
    
    console.log('\n✅ All data cleared successfully!');
    console.log('Database is now empty and ready for production.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing data:', error);
    process.exit(1);
  }
}

clearAllData();

