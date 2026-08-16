import { NextResponse } from 'next/server';

export async function GET() {
  const teamId = (process.env.APPLE_TEAM_ID || '').trim();
  const bundleId = (process.env.IOS_BUNDLE_IDENTIFIER || 'com.wagerpals.app').trim();

  if (!teamId) {
    // Surface a clear error so we don’t serve an invalid association file in prod
    return NextResponse.json(
      {
        error: 'Missing APPLE_TEAM_ID env var. Set your Apple Team ID to enable Universal Links.'
      },
      { status: 500 }
    );
  }

  const payload = {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          paths: ['*'],
        },
      ],
    },
  };

  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Apple recommends not forcing downloads and allowing caching by default
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

