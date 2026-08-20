import { NextRequest, NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Keep in sync with the sync-guard rule in lib/sync-user.ts, which detects
// "is this avatar_url one of ours" off the same hostname.
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4MB

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

function isOurBlobUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Best-effort delete of a previously-uploaded avatar blob. Never throws —
 * losing track of an old blob is a storage-hygiene issue, not a reason to
 * fail the request that's replacing/clearing it.
 */
async function deleteBlobBestEffort(url: string | null | undefined) {
  if (!isOurBlobUrl(url)) return;
  try {
    await del(url as string);
  } catch (err) {
    console.error('[avatar] failed to delete previous blob (non-fatal):', err);
  }
}

// POST /api/users/avatar — upload a custom profile photo.
//
// Request: multipart/form-data with a single file field named "avatar" (or
// "file" — accepted as a fallback so a plain <input type=file name=file>
// or a naive RN FormData.append('file', ...) also works). No JSON body.
// Response: { avatar_url: string } on success.
//
// Validates content-type (jpeg/png/webp/heic/heif only) and a 4MB cap
// server-side — never trust the client's reported size or extension.
export async function POST(request: NextRequest) {
  const authResult = await requireAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "That didn't look like an image upload. Try again." }, { status: 400 });
  }

  const file = formData.get('avatar') ?? formData.get('file');
  if (!file || typeof file === 'string' || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Pick a photo to upload.' }, { status: 400 });
  }

  const contentType = file.type;
  const ext = ALLOWED_TYPES[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: 'That file type is not supported. Use a JPEG, PNG, WEBP, or HEIC photo.' },
      { status: 400 }
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That image is too big. 4MB max.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That image looks empty. Try a different file." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Content hash (not a random suffix) so the pathname is deterministic per
  // upload but still unique whenever the bytes change — CDN edges never
  // serve a stale cached copy of the previous photo under the same URL.
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const pathname = `avatars/${user.id}-${hash}.${ext}`;

  let blobUrl: string;
  try {
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    });
    blobUrl = blob.url;
  } catch (err) {
    console.error('[avatar] upload to blob store failed:', err);
    return NextResponse.json({ error: "Couldn't upload that photo. Try again." }, { status: 500 });
  }

  // Fetch the current row (not just trust `user` from the auth layer) so the
  // "delete the previous blob" check reads whatever is actually in the
  // database right now.
  const currentUser = await db.users.get(user.id);
  const previousAvatarUrl = currentUser?.avatar_url ?? null;

  const updated = await db.users.setAvatarUrl(user.id, blobUrl);
  if (!updated) {
    // The row disappeared out from under us (shouldn't happen for an
    // authenticated caller, but fail closed rather than orphaning the blob
    // we just wrote with no owner). Clean up what we just uploaded.
    await deleteBlobBestEffort(blobUrl);
    return NextResponse.json({ error: "Couldn't save your photo. Try again." }, { status: 500 });
  }

  // Only delete the old blob once the new one is safely saved — never leave
  // the user with neither.
  if (previousAvatarUrl !== blobUrl) {
    await deleteBlobBestEffort(previousAvatarUrl);
  }

  return NextResponse.json({ avatar_url: blobUrl });
}

// DELETE /api/users/avatar — remove a custom profile photo.
//
// Falls back to Stack's current Google profileImageUrl if there is one,
// otherwise clears to NULL (initials). Never fails if there was nothing
// custom to remove — it just re-confirms the fallback.
export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;

  const currentUser = await db.users.get(user.id);
  const currentAvatarUrl = currentUser?.avatar_url ?? null;

  const fallbackAvatarUrl = user.profileImageUrl?.trim() || null;

  const updated = await db.users.setAvatarUrl(user.id, fallbackAvatarUrl);
  if (!updated) {
    return NextResponse.json({ error: "Couldn't remove that photo. Try again." }, { status: 500 });
  }

  if (isOurBlobUrl(currentAvatarUrl) && currentAvatarUrl !== fallbackAvatarUrl) {
    await deleteBlobBestEffort(currentAvatarUrl);
  }

  return NextResponse.json({ avatar_url: fallbackAvatarUrl });
}
