import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST() {
  try {
    // Get count before deletion
    const before = await sql`SELECT COUNT(*) FROM push_subscriptions`;
    const beforeCount = parseInt(before.rows[0].count);

    // Delete all subscriptions (users will need to re-subscribe)
    await sql`DELETE FROM push_subscriptions`;

    // Get count after deletion
    const after = await sql`SELECT COUNT(*) FROM push_subscriptions`;
    const afterCount = parseInt(after.rows[0].count);

    return NextResponse.json({
      success: true,
      removed: beforeCount - afterCount,
      remaining: afterCount,
      message: `Cleaned up ${beforeCount - afterCount} subscriptions. Users will need to re-subscribe.`,
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
    }, { status: 500 });
  }
}

