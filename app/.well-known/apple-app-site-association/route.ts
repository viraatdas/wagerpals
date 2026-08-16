import { NextResponse } from 'next/server';

// Known-good Apple Team ID for the WagerPals developer account. Used as a
// fallback so a missing env var can never take down universal links
// site-wide (this endpoint must never 500 — a broken/missing AASA breaks
// "Open in WagerPals" for every user, on every platform, everywhere).
const FALLBACK_TEAM_ID = '3C4383262W';
const APP_BUNDLE_ID = 'com.wagerpals.app';
// The native iMessage extension is a distinct target with its own bundle id
// and needs its own entry in the association file to open universal links
// (e.g. tapping a bubble it rendered, or a Handoff from Messages).
const MESSAGES_EXTENSION_BUNDLE_ID = 'com.wagerpals.app.messages';

export async function GET() {
  const envTeamId = (process.env.APPLE_TEAM_ID || '').trim();
  const teamId = envTeamId || FALLBACK_TEAM_ID;
  const bundleId = (process.env.IOS_BUNDLE_IDENTIFIER || APP_BUNDLE_ID).trim();

  if (!envTeamId) {
    console.warn(
      `[apple-app-site-association] APPLE_TEAM_ID env var is not set; falling back to ` +
      `known team id "${FALLBACK_TEAM_ID}". Set APPLE_TEAM_ID to override.`
    );
  }

  const appID = `${teamId}.${bundleId}`;
  const messagesAppID = `${teamId}.${MESSAGES_EXTENSION_BUNDLE_ID}`;
  const appIDs = [appID, messagesAppID];

  // Paths that must NEVER be claimed by universal links, regardless of app:
  // API routes, the Stack Auth handler, and this well-known directory itself
  // all need to keep working as normal HTTPS requests (incl. from the app's
  // own fetch calls, webhooks, etc.) rather than being intercepted on-device.
  const excludedComponents = [
    { '/': '/api/*', exclude: true, comment: 'Never intercept API routes' },
    { '/': '/handler/*', exclude: true, comment: 'Never intercept the auth handler' },
    { '/': '/.well-known/*', exclude: true, comment: 'Never intercept well-known files' },
  ];
  const allowedComponents = [
    { '/': '/invite', comment: 'iMessage / share invite landing page' },
    { '/': '/invite/*' },
    { '/': '/events/*', comment: 'Direct links to a wager' },
    { '/': '/groups/*', comment: 'Direct links to a group' },
  ];

  const payload = {
    applinks: {
      // Legacy top-level key, unused today but harmless to keep for very old
      // parsers that expect it to be present.
      apps: [],
      details: [
        {
          // Singular `appID` is the pre-iOS 13 key; `appIDs` (plural) is the
          // modern key that lets one entry cover multiple apps (the main app
          // and the Messages extension) sharing the same allowed paths.
          appID,
          appIDs,
          // Modern iOS 13+ matching: evaluated top-to-bottom, first match
          // wins, so exclusions must come before the broad allow rules.
          components: [...excludedComponents, ...allowedComponents],
          // Legacy iOS <13 fallback: exclusions are expressed as a leading
          // "NOT <pattern>" string rather than a component dictionary.
          paths: [
            'NOT /api/*',
            'NOT /handler/*',
            'NOT /.well-known/*',
            '/invite',
            '/invite/*',
            '/events/*',
            '/groups/*',
          ],
        },
      ],
    },
    // Enables password/passkey autofill for the same app + extension; shares
    // the identical appID list since there's no reason for it to diverge.
    webcredentials: {
      apps: appIDs,
    },
  };

  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: {
      // Must be application/json with no `.json` extension on the path and
      // no redirect — Apple fetches this over HTTPS and refuses to follow
      // redirects or accept any other content type.
      'Content-Type': 'application/json',
      // Apple caches this aggressively on-device already; keep the HTTP
      // cache modest so a fixed misconfiguration can still propagate.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
