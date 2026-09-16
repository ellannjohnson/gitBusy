on run
  set appPath to POSIX path of (path to me)
  set launcherPath to appPath & "Contents/Resources/gitbusy-bundle-toggle.zsh"
  do shell script quoted form of launcherPath
  tell me to quit
end run
