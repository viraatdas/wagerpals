import { NextResponse } from 'next/server';

export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY || '';
  
  return NextResponse.json({
    publicKeySet: !!publicKey,
    privateKeySet: !!privateKey,
    publicKeyLength: publicKey.length,
    privateKeyLength: privateKey.length,
    publicKeyFirst10: publicKey.substring(0, 10),
    publicKeyLast10: publicKey.substring(publicKey.length - 10),
    fullPublicKey: publicKey, // Show the full key for debugging
    hasEquals: publicKey.includes('='),
    hasPadding: publicKey.endsWith('='),
    hasPlus: publicKey.includes('+'),
    hasSlash: publicKey.includes('/'),
    hasUnderscore: publicKey.includes('_'),
    hasDash: publicKey.includes('-'),
  });
}

