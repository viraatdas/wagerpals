# AGENTS.md — keeping wagerpals.io and the iOS app in sync

The product ships on two surfaces from one repo: the **web app** (repo root, Next.js,
deployed to Vercel on every push to `main`) and the **iOS app** (`mobile/`, Expo/React
Native, shipped through EAS Build → App Store Connect). They share one backend (the web
app's `/api/*` routes), one database, and one design system. This guide is the playbook
for changing anything without letting the two drift. It complements CLAUDE.md — read that
first for the per-file rules and §8 invariants; this file is about the *seams between the
surfaces*.

## 1. The cardinal asymmetry: web deploys in minutes, iOS ships in days

Every sync decision follows from this:

- A push to `main` is live on wagerpals.io in ~2 minutes (Vercel auto-deploys the repo;
  the project is `wagerpals-v2` — `wagerpals` is a dead older project, don't trust
  `vercel ls` without naming the right one).
- An iOS change needs: `cd mobile && npm run prebuild` → EAS build (~15 min) → `eas
  submit` → Apple processing (~10 min) → TestFlight beta review (hours) and/or App Review
  (days). Users then still have to update.

**Consequences:**
- **Fix on the server when you can.** A bug reproducible in the shipped app is often a
  server bug wearing an app costume. Example from the field: "Continue with Google opens
  a weird second webpage" was `/api/auth/mobile-oauth` falling into a web fallback —
  fixed server-side, healed for every installed build on the next deploy, no binary.
- **The API contract is append-only.** Builds live in the wild for weeks. Never rename,
  remove, or change the meaning of a field a shipped app reads. New payload fields are
  optional; mobile reads them defensively (`?? fallback`). If a list payload grows a
  field (`bettor_preview`, `latest_comment`, `cash_enabled`, `wp_balance`,
  `payment_type` on activity items…), both UIs must degrade gracefully when it's absent.
- **Server-side gates, client-side UX.** Permissions (creator-only resolve, group
  cash_enabled, hidden-subject visibility) are enforced in `app/api/**`; the clients only
  *hide* controls. A stale app that still shows a button must get a product-voice 4xx it
  can display verbatim.

## 2. Design-system lockstep

One system, two implementations. When a token or primitive changes, change BOTH in the
same commit — this is the CLAUDE.md §5 lockstep rule, extended to the component level.

| Concept | Web | iOS |
|---|---|---|
| Tokens (palette, radii, type scale) | `app/globals.css` `:root` → `tailwind.config.ts` keys | `mobile/src/theme.ts` (`tokens.*`, `font.*`) |
| The confidence bar (signature element) | `components/ConfidenceBar.tsx` | `SplitBar` in `mobile/src/components/ProgressBar.tsx` |
| The W currency mark | `components/WMark.tsx` (`WMark`, `WAmount`) | `mobile/src/components/WMark.tsx` |
| Avatars (people = amber, single-letter initials) | `components/AvatarStack.tsx` | `mobile/src/components/Avatar.tsx` |
| Empty state (blank betting slip) | `components/EmptySlip.tsx` | `EmptyState` in `mobile/src/components/ScreenState.tsx` |
| Status pill (live/settled) | `components/StatusPill.tsx` | `Pill` in `mobile/src/components/Pill.tsx` |
| Mention autocomplete | `components/useMentionAutocomplete.tsx` | `mobile/src/utils/useMentionAutocomplete.ts` + `mentions.ts` (mirrors the web regex/ranking — keep in lockstep) |
| Plain-text money forms | `formatW`/`formatMoney` in `lib/odds.ts` | `formatW`/`formatMoney` in `mobile/src/utils/format.ts` |

Shared rules that must hold on both surfaces, verbatim:
- **Colour rule:** a number is emerald or crimson; a person is amber; amber never touches
  a money value; gold means won-money only.
- **W vs $:** `payment_type: 'none'` amounts render the W mark; `'cash'` renders `$`.
  The W mark is a SMALL inline prefix (0.68× the digit size), never letter-sized.
- **Type roles:** Archivo Black for screen titles/wordmark only; IBM Plex Mono
  (never above weight 500 — heavier isn't loaded and fakes a bold) for every number;
  Plus Jakarta Sans for voice.
- **Shapes:** controls/cards 8–10px radius; fully-round is reserved for people and
  status pills — never buttons.
- **Motion budget:** confidence-bar fill (~400ms, first mount only), count-up on money,
  2px card hover (web). Nothing else. Both respect reduce-motion.
- **Copy voice:** one verb per flow (Place Bet → Placing bet… → Bet placed), errors say
  cause + action, no "successfully", no "Oops", sentence case.
- The iMessage extension's Swift (`mobile/plugins/imessage-extension/swift/`) can't read
  tokens — it hardcodes the hex with a comment naming the CSS variable. When the palette
  changes, grep the Swift for `wagerPaper`/`wagerEmerald`/etc. and update.

## 3. Adding a feature: the parity order

1. **Backend first** (`lib/db.ts` for SQL, `lib/payments.ts` for money, `app/api/**`
   routes, `lib/types.ts`) — additive fields, server-side gate, migration via the
   `scripts/migrate-comeback.ts` step pattern + `verify-comeback.ts` check.
2. **Mirror the types**: `lib/types.ts` ↔ `mobile/src/types/index.ts` are hand-kept
   twins. A field added to one gets added (optional) to the other in the same PR.
3. **Web UI** — deploys immediately; this is where the feature gets its first real use.
4. **Mobile UI** — same feature, same copy, same tokens. It rides whenever the next
   build cuts; note in the PR/commit which build train it's waiting on.
5. **Verify both**: `npx tsc --noEmit` at the root AND `cd mobile && npx tsc --noEmit`.
   Run the suite (§5). `verify:escrow-chips` statically checks BOTH
   `components/Ledger.tsx` and `mobile/src/screens/EventDetailScreen.tsx` — the escrow
   invariant is a two-surface invariant.

A feature is "done" when both surfaces have it or the commit message says explicitly
which build number the mobile half ships in.

## 4. The iOS release train (hard-won specifics)

- **Prebuild is generative**: `mobile/ios/` is not checked in. `npm run prebuild` (in
  `mobile/`) regenerates it, including the iMessage extension target injected by
  `mobile/plugins/imessage-extension/withIMessageExtension.js`. EAS uploads the project
  snapshot at build start — code changed after the build starts rides the NEXT build.
- **Build**: `cd mobile && node --max-old-space-size=512 $(readlink -f $(which eas))
  build --platform ios --profile production --non-interactive --no-wait` (the memory cap
  matters on this machine). Build numbers auto-increment (`appVersionSource: remote`).
- **Submit**: same wrapper with `eas submit --id <build-id> --non-interactive`. The ASC
  API key for submits lives on EAS servers (assigned to the project); the first submit
  was interactive to select it, later ones aren't.
- **App Store Connect API** (for everything eas can't do): team key
  `~/.appstoreconnect/private_keys/AuthKey_7BM5WGWC32.p8`, issuer ID in
  `~/code/manas/ios/fastlane/.asc.env` (same Apple team). A ready-made client with
  retry-on-network-blip lives at the session scratchpad's `asc.py` pattern — ES256 JWT
  with `iss`, 20-min expiry. This drives: attaching builds to versions, screenshots
  upload, review submissions (`reviewSubmissions` → `reviewSubmissionItems` → PATCH
  `submitted: true`), release type (`AFTER_APPROVAL` = auto-release), TestFlight groups
  and testers, beta review submissions.
- **Trap — duplicate/stale build records**: filter ASC builds by `expired: false` AND
  today's `uploadedDate`, never by version number alone. A December leftover "build 10"
  once hijacked a review submission because the poller matched version only.
- **Trap — builds can't swap mid-review**: to change the build on a submitted version,
  PATCH the reviewSubmission `canceled: true` first (shows as DEVELOPER_REJECTED —
  that's normal), re-attach, refile.
- **Screenshot matrix ASC actually enforces** (this app: iPhone + iPad + iMessage):
  `APP_IPHONE_67` (1290×2796), `APP_IPAD_PRO_3GEN_129` (2048×2732),
  `IMESSAGE_APP_IPHONE_65` (1242×2688), `IMESSAGE_APP_IPAD_PRO_3GEN_129` (2048×2732).
  Screenshots must reflect the submitted build's actual UI — the render-from-design-
  system pipeline lives in the scratchpad (`appshot.html` pattern: exact-token HTML at
  device dimensions via Playwright deviceScaleFactor).
- **TestFlight**: external group "Friends" (`5ca50117-…`), public link
  https://testflight.apple.com/join/SS2XwXNF. Each new build gets: added to the group +
  a `betaAppReviewSubmissions` POST (only one build per version-train can be in beta
  review at a time — queue the next when the previous clears). Beta metadata
  (description, feedbackEmail, whatsNew, review contact) must exist or the submission
  422s.

## 5. The verification gate (run before any deploy or build)

```bash
npx tsc --noEmit && (cd mobile && npx tsc --noEmit)   # both surfaces compile
npm run lint                                           # no NEW warnings
npm run build                                          # web build green
npm run verify:payments      # money invariants, both currencies (live DB)
npm run verify:escrow-chips  # the two-surface escrow invariant (live DB)
npm run verify:imessage && npm run verify:notifications
npm run verify:groups-auth && npm run verify:users-auth
npm run verify:comments && npm run identity:check
npm run db:verify            # schema matches the migration (live DB)
```

Swift can't compile locally without prebuild — `swiftc -parse` each file in
`mobile/plugins/imessage-extension/swift/` for syntax; the EAS build is the type gate.
SourceKit single-file diagnostics about missing `Wager*` types are false alarms (the
types live in sibling files).

## 6. Intentional divergences (don't "fix" these)

- The web header's wallet chip shows `$ | W`; mobile shows balances on the Wallet screen
  only — mobile chrome is tighter.
- Web nav: Board · Live · History · Wallet · Friends · Profile. Mobile tabs: Board ·
  History · Explore · Profile (Wallet and Friends live behind Profile/GroupDetail).
- The web can hit `/api/*` same-origin; mobile goes through
  `EXPO_PUBLIC_API_URL = https://www.wagerpals.io` (the **www** host — the apex 307s and
  redirects don't reliably carry auth headers).
- Stack Auth: web uses cookie sessions; mobile exchanges through
  `/api/auth/mobile-*` and stores tokens in SecureStore/shared Keychain (which the
  iMessage extension also reads). **Never set `baseUrl` on `StackServerApp`** — it's
  Stack's API server URL, not ours; setting it to our domain silently 401s every
  authenticated API (this took down the signed-in web app once).

## 7. The release train is part of the work (agent protocol, not CI)

There is no CI pipeline by choice. Shipping is something the AGENT DOES as part of
finishing mobile work, every time, in the session where the work happened:

**Definition of done for any change under `mobile/**`:**
1. Gate: `npx tsc --noEmit` (root AND `-p mobile`), lint, the no-DB verify scripts, and
   `swiftc -parse` on any touched Swift.
2. Commit + push to `main`.
3. **Cut the build immediately** (do not wait to be asked):
   `cd mobile && node --max-old-space-size=512 $(readlink -f $(which eas)) build --platform ios --profile production --non-interactive --no-wait`
4. When it finishes, submit it:
   `... eas submit --platform ios --profile production --id <build-id> --non-interactive`
5. Confirm via the ASC API that the build reached VALID (filter `expired=false` AND
   today's `uploadedDate` — never trust version number alone, see §4's stale-record trap).
   Then, EVERY build, no exceptions: add it to the "Friends" external TestFlight group
   (`POST /v1/betaGroups/5ca50117-b65d-4871-a09a-5212f005908a/relationships/builds`) and
   attempt a beta review submission (`POST /v1/betaAppReviewSubmissions`); a 422
   ANOTHER_BUILD_IN_REVIEW is fine — it means the train is queued, and the newest build
   flows to external testers + the public link
   (https://testflight.apple.com/join/SS2XwXNF) as reviews clear. Internal (owner)
   distribution is automatic.
6. **The delivery proof** (imported from manas' release playbook, learned there the hard
   way): after the chain, query ASC and report the actual end-state facts — build
   processing=VALID, attached to the Friends external group, and the beta review state.
   A build can be VALID, live to internal testers, and still sit unreachable by every
   external tester with nothing anywhere reporting a problem — external groups are created
   `hasAccessToAllBuilds: false`, so unlike the internal group they NEVER inherit new
   builds; each one must be attached and beta-submitted explicitly.
7. Report the build number to the owner in the same breath as the change itself. A mobile
   change that hasn't produced a TestFlight build is NOT done.

**Never pipe a release command into `tail`/`grep` bare.** `eas submit … | tail -1` returns
tail's exit status, so a failed submit reports success and everything after it runs on a
lie (manas shipped a release with no appcast this way). Capture status explicitly
(`st=$(eas build:view … | grep Status)`) or check PIPESTATUS.

App Store releases stay deliberate: attaching a build to a store version and filing App
Review is its own decision with the owner, never a side effect of the train.

Web needs no train: pushing `main` deploys wagerpals.io automatically via Vercel.

## 8. Versioning: one product version, two surfaces

The web app and the iOS app share their MAJOR.MINOR version; the patch position is each
surface's own (owner's rule, 2026-08-20). Web patches roll continuously with deploys; iOS
patches ride build trains — they WILL deviate, and that's fine. What may never deviate is
the major.minor pair: a user on wagerpals.io 1.1.x and the iPhone app 1.1.x is on the same
product.

Where each lives:
- iOS: `mobile/app.json` → `expo.version` (the App Store marketing version). Build numbers
  auto-increment separately on EAS (`appVersionSource: remote`) and are NOT part of this
  scheme.
- Web: root `package.json` → `version`.

Protocol: whenever `mobile/app.json`'s version bumps its major or minor (a new store
release train), bump root `package.json` to the same major.minor in the same commit, and
vice versa. Patch bumps never require cross-surface sync.

When the two are out of step, RAISE the trailing one to match — never lower the leading
one: App Store Connect refuses any upload whose marketing version is not higher than the
last approved version, so the iOS version can only ever go up (manas closed exactly this
gap by jumping the trailing platform straight to the leading one's version).

## 9. Google OAuth is on our own client

Sign-in uses the project's own Google OAuth client (GCP project `wagerpals-oauth` on the
exla account), so the consent screen says "to continue to Wager Pals". Configured in the
Stack Auth dashboard (Auth Methods → Google → own credentials). GOTCHA: Stack Auth's
infrastructure is rebranded "hexclave" — the authorized redirect URI on the Google client
must be `https://api.hexclave.com/api/v1/auth/oauth/callback/google` (the documented
api.stack-auth.com callback 400s with redirect_uri_mismatch). Verified headlessly with a
WebKit run through the production chain (scratchpad oauthcheck.mjs pattern): assert Google
receives our client_id and no redirect error renders.
