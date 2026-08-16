import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET() {
  try {
    // Try to connect to the database
    const result = await sql`SELECT 1 as health_check`;
    
    // Check if tables exist
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'events', 'bets', 'activities')
      ORDER BY table_name
    `;
    
    return NextResponse.json({
      status: 'healthy',
      database: 'connected',
      tables: tables.rows.map(r => r.table_name),
      message: tables.rows.length === 4 
        ? 'All tables present' 
        : `Missing tables. Run: npm run db:init`,
    });
  } catch (error: any) {
    return NextResponse.json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      message: 'Database not configured. See SETUP_INSTRUCTIONS.md',
    }, { status: 503 });
  }
}

