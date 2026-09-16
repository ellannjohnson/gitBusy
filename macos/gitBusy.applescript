-- Source-tree AppleScript launcher template.
--
-- This file is no longer referenced by the macOS packaging script (which
-- compiles `macos/gitBusy-bundle.applescript` from each `.app` bundle's own
-- POSIX path). It is kept here for source-tree readers as an illustrative
-- reference and intentionally mirrors the bundle variant so neither copy
-- leaks an absolute host path. The bundle variant is what gets compiled
-- into the shipped `gitBusy.app`.

on run
  set launcherPath to POSIX path of (path to me) & "Contents/Resources/gitbusy-bundle-toggle.zsh"
  do shell script quoted form of launcherPath
  tell me to quit
end run