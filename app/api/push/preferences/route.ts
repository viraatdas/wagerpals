import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { DEFAULT_NOTIFICATION_CATEGORIES, NotificationCategory } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set<string>(Object.keys(DEFAULT_NOTIFICATION_CATEGORIES));

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  try {
    const prefs = await db.notificationPreferences.getOrCreate(userId);
    return NextResponse.json(prefs);
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notification preferences' },
      { status: 500 }
    );
  }
}

async function handleUpdate(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { push_enabled, email_enabled, categories } = body;

  if (push_enabled !== undefined && typeof push_enabled !== 'boolean') {
    return NextResponse.json({ error: 'push_enabled must be a boolean' }, { status: 400 });
  }
  if (email_enabled !== undefined && typeof email_enabled !== 'boolean') {
    return NextResponse.json({ error: 'email_enabled must be a boolean' }, { status: 400 });
  }

  let validatedCategories: Partial<Record<NotificationCategory, boolean>> | undefined;
  if (categories !== undefined) {
    if (categories === null || typeof categories !== 'object' || Array.isArray(categories)) {
      return NextResponse.json({ error: 'categories must be an object' }, { status: 400 });
    }
    for (const [key, value] of Object.entries(categories)) {
      if (!VALID_CATEGORIES.has(key)) {
        return NextResponse.json({ error: `Unknown category: ${key}` }, { status: 400 });
      }
      if (typeof value !== 'boolean') {
        return NextResponse.json(
          { error: `categories.${key} must be a boolean` },
          { status: 400 }
        );
      }
    }
    validatedCategories = categories as Partial<Record<NotificationCategory, boolean>>;
  }

  try {
    const updated = await db.notificationPreferences.upsert(userId, {
      ...(push_enabled !== undefined ? { push_enabled } : {}),
      ...(email_enabled !== undefined ? { email_enabled } : {}),
      ...(validatedCategories !== undefined ? { categories: validatedCategories as any } : {}),
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    return NextResponse.json(
      { error: 'Failed to update notification preferences' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  return handleUpdate(request);
}

export async function PUT(request: NextRequest) {
  return handleUpdate(request);
}
