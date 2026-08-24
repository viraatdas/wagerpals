#!/usr/bin/env python3
"""Local iOS builds on this machine die when the kernel hands out minimum-size
pipes under memory pressure.

Xcode's CreateBuildDescription runs `clang -v -E -dM ...` through
ExecuteExternalTool and does NOT drain its output concurrently. That probe emits
~16 KB. A healthy macOS pipe holds 16384 bytes, so it fits and the build moves on.
Under memory pressure the kernel falls back to 512/1024-byte pipes, clang blocks
in write(), SWBBuildService sits idle waiting, and xcodebuild hangs forever with
zero compile workers and no error message. Measured here at 1024 and then 512.

Exit 0 = safe to build. Exit 1 = the build WILL hang; free memory first.
"""
import os, fcntl, sys

NEEDED = 16384

def capacity():
    r, w = os.pipe()
    try:
        fcntl.fcntl(w, fcntl.F_SETFL, os.O_NONBLOCK)
        n = 0
        try:
            while True:
                n += os.write(w, b"x" * 4096)
        except BlockingIOError:
            pass
        return n
    finally:
        os.close(r); os.close(w)

n = max(capacity() for _ in range(3))
print(f"pipe capacity: {n} bytes (need >= {NEEDED})")
if n >= NEEDED:
    print("OK - local builds can proceed")
    sys.exit(0)
print(
    "\nBLOCKED: the kernel is handing out minimum-size pipes, so xcodebuild will\n"
    "hang at CreateBuildDescription with no error. Free memory, then re-run:\n"
    "  - sudo purge\n"
    "  - quit the biggest apps (a browser is usually the top consumer)\n"
    "  - or reboot\n"
    "Cloud builds (eas build without --local) are unaffected.")
sys.exit(1)
