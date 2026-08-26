#!/bin/bash
# Build a store-signed .ipa on this machine, start to finish, without EAS cloud
# credits and without EAS's own local-build wrapper.
#
# Why not `eas build --local`: it works right up to the archive and then dies at
# code signing, because EAS's stored distribution certificate is the legacy
# "iPhone Distribution: Viraat Das" (serial 3D6F8E4B...), which is the cert both
# EAS provisioning profiles contain, while this machine's login keychain holds a
# newer "Apple Distribution: Viraat Das" (serial 18FBE858...). Xcode prefers the
# Apple Distribution one and then reports
#   Provisioning profile "..." doesn't include signing certificate
#     "Apple Distribution: Viraat Das (3C4383262W)"
# Cloud builds never hit this: they have no local cert to prefer. Fixing it
# inside EAS means re-uploading credentials interactively; this script sidesteps
# it by letting Xcode provision against the cert this machine actually holds,
# using the App Store Connect API key.
#
# Two things this does that EAS would otherwise do for you, so don't skip them:
#   - runs `expo prebuild` (mobile/ios is generated, never committed)
#   - stamps the build number, since appVersionSource is "remote" and nothing
#     local increments it
#
#   ./mobile/scripts/local-build.sh 22          # build number 22
#   ./mobile/scripts/local-build.sh 22 --skip-prebuild
set -euo pipefail

BUILD_NUMBER="${1:?usage: local-build.sh <build-number> [--skip-prebuild]}"
SKIP_PREBUILD="${2:-}"
MARKETING_VERSION="$(python3 -c 'import json;print(json.load(open("mobile/app.json"))["expo"]["version"])')"
OUT="$HOME/wagerpals-ship22"
TEAM=3C4383262W

# shellcheck disable=SC1090
source ~/code/manas/ios/fastlane/.asc.env

# The pipe-deadlock shim (see AGENTS.md section 10). Idempotent; cheap.
./mobile/scripts/pipefix-toolchain.sh >/dev/null
export TOOLCHAINS=io.wagerpals.pipefix

mkdir -p "$OUT"

if [ "$SKIP_PREBUILD" != "--skip-prebuild" ]; then
  echo "==> prebuild"
  ( cd mobile && npm run prebuild )
fi

echo "==> stamping $MARKETING_VERSION ($BUILD_NUMBER)"
cd mobile/ios
plutil -replace CFBundleVersion -string "$BUILD_NUMBER" WagerPals/Info.plist
python3 - "$BUILD_NUMBER" "$MARKETING_VERSION" <<'PY'
import re, sys
build, marketing = sys.argv[1], sys.argv[2]
p = "WagerPals.xcodeproj/project.pbxproj"
s = open(p).read()
s = re.sub(r"CURRENT_PROJECT_VERSION = [^;]+;", f"CURRENT_PROJECT_VERSION = {build};", s)
s = re.sub(r"MARKETING_VERSION = [^;]+;", f"MARKETING_VERSION = {marketing};", s)
open(p, "w").write(s)
PY

echo "==> archive"
rm -rf "$OUT/WagerPals.xcarchive"
xcodebuild -workspace WagerPals.xcworkspace -scheme WagerPals -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/WagerPals.xcarchive" \
  -derivedDataPath "$OUT/dd" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM=$TEAM \
  archive

# The archive comes out DEVELOPMENT-signed (aps-environment=development).
# That is expected and harmless: exportArchive re-signs for distribution below.
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>export</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

echo "==> export"
rm -rf "$OUT/export"
xcodebuild -exportArchive \
  -archivePath "$OUT/WagerPals.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

IPA="$OUT/export/WagerPals.ipa"
echo "==> verifying $IPA"
codesign -dvvv "$OUT/WagerPals.xcarchive/Products/Applications/WagerPals.app" 2>&1 |
  grep -q "TeamIdentifier=$TEAM" || { echo "wrong team"; exit 1; }
ls -la "$IPA"
echo
echo "store-signed ipa ready. Submit with:"
echo "  cd mobile && eas submit --platform ios --profile production --path $IPA --non-interactive"
echo "then run the AGENTS.md section 7 TestFlight chain."
