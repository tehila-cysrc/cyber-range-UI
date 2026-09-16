# Planned / deferred scripts (placeholders)

## user-activity
- user-folder-create.ps1 — mkdir under Lab\activity
- user-smb-list.ps1 — `Get-ChildItem \\fileserver\share` (read-only list)
- user-launch-notepad.ps1 — Start-Process notepad (noisy process create 4688 if audited)

## infrastructure
- infra-stop-service.ps1 / infra-start-service.ps1 — allowlisted only
- infra-cpu-brief.ps1 — 15s low-priority loop (cap hard)
- infra-mem-brief.ps1 — allocate small buffer then free (cap hard)
- infra-disk-warn-sim.ps1 — write marker event claiming low disk (do NOT fill disk)

## administrative
- admin-create-service.ps1 — create a no-op service pointing at cmd /c echo (lab only)
- admin-install-software.ps1 — deferred (packaging risk); prefer chocolatey in controlled lab later
