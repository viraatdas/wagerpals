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

## 10. Building without EAS cloud credits (local builds)

The Expo account is on the Free plan (30 cloud iOS builds/month). When that's exhausted
(or to avoid burning it), build LOCALLY — local builds do NOT consume the cloud quota:

```bash
./mobile/scripts/local-build.sh 22   # <build-number>: prebuild -> stamp -> archive -> .ipa
cd mobile && eas submit --platform ios --profile production \
  --path ~/wagerpals-ship22/export/WagerPals.ipa --non-interactive
```

Then run the §7 delivery chain (attach to the Friends external group + beta review + the
delivery proof) exactly as for a cloud build.

`local-build.sh` drives `xcodebuild archive` + `-exportArchive` directly rather than
`eas build --local`. Both of the reasons are documented below and were hit for real on
2026-08-25: the pipe deadlock, and the two-distribution-certs signing trap that kills
`eas build --local` on this machine specifically. Build 22 is the first local build that
has ever succeeded here.

Gotchas learned here:
- Local builds take ~20-30 min (build 22: ~11 min archive + ~40 s export, warm pods).
  This box sleeps and a peer session sometimes `pkill`s xcodebuild, killing detached
  builds mid-run. If a backgrounded agent run keeps dying, hand it to the operator's own
  foreground terminal (`! ./mobile/scripts/local-build.sh 22`).
- It needs the full Xcode toolchain and CocoaPods (present here: Xcode 26.6).
- The iMessage extension target builds fine locally (the config plugin injects it during
  prebuild, same as cloud) and comes out distribution-signed inside the .ipa.
- Nothing local increments the build number — `appVersionSource` is `remote`, so EAS owns
  it for cloud builds and you must pass the next one explicitly here. Check the current
  high-water mark on ASC first; never reuse a number.

### The local-build hang: a 512-byte pipe, and the shim that beats it (fixed 2026-08-25)

A local build that prints its fastlane banner and then does NOTHING — no compile
workers, derived data frozen at ~2.4 MB, no error, forever — is the undrained-pipe
deadlock described below. It is FIXED, and the fix needs no reboot, no sudo, and no
free memory:

```bash
./mobile/scripts/local-build.sh 22       # prebuild -> stamp -> archive -> store-signed .ipa
```

That script installs the shim itself. It also does NOT use `eas build --local`, for a
second reason that has nothing to do with pipes — see "the local signing trap" below.

**The mechanism.** Xcode's `CreateBuildDescription` runs a toolchain probe,
`clang -v -E -dM -arch arm64 -isysroot <sdk> -x objective-c -c /dev/null`, through
`ExecuteExternalTool` and does not read its pipes until the process exits. The probe
emits ~20.7 KB (16,082 B on stdout, ~4.7 KB on stderr). A healthy macOS pipe holds
16,384 B, so it just fits. This machine hands out **512-byte** pipes, so clang blocks in
`write()` after 511 bytes, SWBBuildService sits in `mach_msg` waiting for a task that will
never finish, and xcodebuild waits on the build service. Three processes, all "alive",
zero progress. `timeout` cannot kill it either — xcodebuild ignores SIGTERM in that
state, so always use `timeout -k` around it.

**The fix decouples the tool's EXIT from its output being flushed**, instead of trying to
get a bigger pipe. `mobile/scripts/pipefix-toolchain.sh` installs
`~/Library/Developer/Toolchains/PipeFix.xctoolchain`, in which every file is a symlink to
the real XcodeDefault toolchain except `usr/bin/clang`. That shim `exec`s the real clang
directly for every ordinary compile (so the build pays nothing), and only for the `-dM`
probe runs it buffered and then forks **one detached writer per stream** before exiting.
xcodebuild's wait returns in ~0.2 s, it starts reading, and the writers push all 20.7 KB
through the same 512-byte pipe, 511 bytes at a time.

Two details that are easy to get wrong — both were hit and fixed here:
- Each detached writer must `close()` the OTHER stream's fd. Otherwise the stderr writer
  keeps a handle on the stdout pipe, a reader that drains stdout to EOF first never sees
  EOF, and you have rebuilt the same deadlock one level down. Xcode does read the two
  streams one at a time, so this is not theoretical — it hung exactly this way.
- `TOOLCHAINS` is the only lever that actually routes the probe. `xcrun --toolchain <id>`
  and `TOOLCHAINS=<id> xcrun -f clang` silently resolve back to XcodeDefault (a
  deliberately bogus id resolves identically, with no error). Pointing `DEVELOPER_DIR` at
  a shadow `Xcode.app` built from symlinks is accepted by xcodebuild, but SWBBuildService
  resolves the toolchain from the REAL Xcode it is loaded out of, so the probe still runs
  the unshimmed clang. Both verified 2026-08-25; don't spend the afternoon on them again.

`npm run preflight:local` still measures pipe capacity (>= 16384 is healthy). Treat it as
information now, not a gate: with the pipefix toolchain a 512-byte pipe builds fine.

**Why "just reboot" is not the answer.** A reboot does clear it, and it does not hold:
this box was rebooted at 01:21 on 2026-08-25 and capacity was back to 512 bytes by 16:53
the same day — ~15.5 h later, under multi-agent load (load average 30). Memory pressure
was NOT the trigger on that measurement: swap was 627 MB of 1024 MB and 677 MB of pages
were free while capacity sat at 512.

Things that look like the cause and are NOT — each ruled out with evidence, do not
re-litigate them:
- disk space (38 GB free), process limits, fd limits
- a stale clang module cache, DerivedData, or Xcode caches (all cleared, still hung)
- running the build detached with `os.setsid()` (retried attached; still hung — but note
  setsid IS worth avoiding anyway, it drops the login session's bootstrap namespace)
- the launchd session type (the agent shell is already `Aqua`)
- `CC_PRINT_OPTIONS` (explicitly set to NO; still hung)
- EAS's `| tee` pipeline with xcpretty disabled (raw `xcodebuild -quiet` hangs identically)
- the legacy `XCBBuildService` via `XCBBUILDSERVICE_PATH` — it exists in Xcode 26 but is
  incompatible with the current project format and dies with "The Xcode build system has
  terminated due to an error"
- freeing memory or quitting apps: `sudo purge` freed ~530 MB and capacity stayed pinned
  at 512; quitting Spotify, Notion and Beeper released ~90 pipe fds and it did not move
  one byte
- raising a kernel limit: there is no `kern.ipc.maxpipekva` sysctl on Darwin 25. And the
  pipe never grows — 512 bytes whether you write 512 or 65536 at a time, before or after
  draining, as your own user or via `launchctl asuser`

Cloud builds are immune (different machine). Builds 9-21 were ALL cloud builds; build 22
is the first local build this box has ever produced.

### The local signing trap: two distribution certs, same human-readable name

Once the pipe deadlock was out of the way, `eas build --local` got through prebuild, pods
and the JS bundle, then died the moment fastlane started the archive — before a single
source file compiled — with:

```
Provisioning profile "*[expo] com.wagerpals.app AppStore ..." doesn't include signing
certificate "Apple Distribution: Viraat Das (3C4383262W)".
```

The team has TWO usable distribution certificates, and only one of them is in the profiles:

| cert | ASC type | serial | where the private key is | in the profiles? |
|---|---|---|---|---|
| `iPhone Distribution: Viraat Das` | `IOS_DISTRIBUTION` | `3D6F8E4B…` | EAS servers | **yes** — both profiles |
| `Apple Distribution: Viraat Das` | `DISTRIBUTION` | `18FBE858…` | this machine's login keychain | no |

`eas build --local` imports its own cert into a temporary keychain (the log even says
"Verifying whether the distribution certificate and provisioning profile match" and
passes), but Xcode then searches every keychain, prefers the newer *Apple* Distribution
identity over the legacy *iPhone* Distribution one, and rejects the profile. **Cloud builds
never hit this** — the cloud machine has no competing local cert, which is exactly why
builds 12-21 sailed through.

`mobile/scripts/local-build.sh` sidesteps it instead of fighting it: archive and export
with `CODE_SIGN_STYLE=Automatic` plus `-allowProvisioningUpdates` and the App Store Connect
API key, so Xcode provisions against the cert this machine actually holds. Do NOT "fix" it
by deleting the local identity or by re-uploading credentials to EAS unless you intend to
change what cloud builds sign with too.

One detail that looks alarming and is not: the **archive** comes out Apple *Development*
signed with `aps-environment=development`. `xcodebuild -exportArchive` re-signs it for
distribution. Verify the `.ipa`, never the `.xcarchive`:

```bash
codesign -dvvv Payload/WagerPals.app          # want: Apple Distribution: Viraat Das
codesign -d --entitlements - --xml Payload/WagerPals.app | plutil -p -
# want: aps-environment => production, get-task-allow => false,
#       com.apple.developer.applesignin present
```
