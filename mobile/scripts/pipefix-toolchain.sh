#!/bin/bash
# Install a custom Xcode toolchain whose clang cannot deadlock on a small pipe,
# so local iOS builds work on a box where the kernel is handing out 512-byte
# pipes. No sudo, nothing written into /Applications, fully reversible.
#
# WHY THIS EXISTS
# ---------------
# Xcode's CreateBuildDescription runs a toolchain probe
#
#   clang -v -E -dM -arch arm64 -isysroot <sdk> -x objective-c -c /dev/null
#
# through ExecuteExternalTool and does NOT read its pipes until the process
# exits. The probe emits ~20 KB (16082 B stdout + 4672 B stderr). That fits a
# healthy 16384-byte macOS pipe. When the kernel degrades to 512-byte pipes,
# clang blocks in write() forever and the build sits at CreateBuildDescription
# with no error, no compile workers, and no timeout. `timeout` cannot even kill
# it without -k.
#
# THE FIX
# -------
# Make the tool's EXIT independent of its output being drained. The shim runs
# the real clang, buffers both streams, forks one detached writer per stream,
# and exits immediately. xcodebuild's wait returns, it starts reading, and the
# writers push all 20 KB through the same 512-byte pipe. Pipe size stops
# mattering; no reboot, no freeing memory.
#
# Only the -dM probe takes that path. Every real compile is a plain exec of the
# real clang, so the build pays nothing.
#
# USAGE
# -----
#   ./mobile/scripts/pipefix-toolchain.sh           # install
#   TOOLCHAINS=io.wagerpals.pipefix xcodebuild ...  # or export it for eas build
#   ./mobile/scripts/pipefix-toolchain.sh --clean   # remove
#
# TOOLCHAINS is the lever that actually works. Two others do not, and are
# recorded here so nobody re-tries them:
#   - `xcrun --toolchain <id>` / `TOOLCHAINS=<id> xcrun -f clang` silently
#     resolves back to XcodeDefault; it ignores custom toolchains entirely
#     (a deliberately bogus id resolves the same way, with no error).
#   - Pointing DEVELOPER_DIR at a shadow Xcode.app made of symlinks is accepted
#     by xcodebuild, but SWBBuildService still resolves the toolchain from the
#     REAL Xcode it is loaded out of, so the probe runs the unshimmed clang.
set -euo pipefail

ID="io.wagerpals.pipefix"
TC="$HOME/Library/Developer/Toolchains/PipeFix.xctoolchain"

if [ "${1:-}" = "--clean" ]; then
  rm -rf "$TC"
  echo "removed $TC"
  exit 0
fi

XD="$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain"
[ -x "$XD/usr/bin/clang" ] || { echo "no clang in $XD" >&2; exit 1; }

rm -rf "$TC"
mkdir -p "$TC/usr/bin" "$TC/pipefix"

cat > "$TC/ToolchainInfo.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Identifier</key>
  <string>$ID</string>
  <key>DisplayName</key>
  <string>Xcode Default + pipe-safe clang probe</string>
  <key>Aliases</key>
  <array><string>pipefix</string></array>
</dict>
</plist>
PLIST

# Everything is the real toolchain except one file.
ln -s "$XD/Developer" "$TC/Developer"
for d in include lib libexec share; do ln -s "$XD/usr/$d" "$TC/usr/$d"; done
for f in "$XD"/usr/bin/*; do
  b=$(basename "$f")
  [ "$b" = "clang" ] || ln -s "$f" "$TC/usr/bin/$b"
done

cat > "$TC/pipefix/flush-detached.py" <<'PY'
#!/usr/bin/env python3
"""Run the real tool, then hand its output to detached writers so the tool's
exit never waits on anyone draining its pipes.

One writer PER STREAM, and each writer CLOSES THE OTHER STREAM'S FD. Without
that close the stderr writer keeps a handle on the stdout pipe, so a reader that
drains stdout to EOF first never sees EOF, never moves on to stderr, and the
stderr writer stays blocked against a full pipe -- the same deadlock one level
down. Xcode reads them one at a time, so this matters."""
import os, sys, signal, subprocess

signal.signal(signal.SIGPIPE, signal.SIG_DFL)
real, argv = sys.argv[1], sys.argv[2:]
p = subprocess.run([real] + argv, capture_output=True)
for fd, other, data in ((1, 2, p.stdout), (2, 1, p.stderr)):
    if not data:
        continue
    if os.fork() == 0:
        try:
            os.setpgrp()
            os.close(other)
            while data:
                data = data[os.write(fd, data):]
        except Exception:
            pass
        os._exit(0)
sys.exit(p.returncode)
PY

cat > "$TC/usr/bin/clang" <<SHIM
#!/bin/sh
# PipeFix clang. Transparent exec for every real compile; only the macro-dump
# toolchain probe (-dM) takes the buffered, detached-writer path.
REAL="$XD/usr/bin/clang"
case " \$* " in
  *" -dM "*) exec /usr/bin/python3 "$TC/pipefix/flush-detached.py" "\$REAL" "\$@" ;;
esac
exec "\$REAL" "\$@"
SHIM
chmod +x "$TC/usr/bin/clang" "$TC/pipefix/flush-detached.py"

echo "pipefix toolchain installed: $TC"
echo "  wraps: $XD/usr/bin/clang"
echo "  use:   export TOOLCHAINS=$ID"
