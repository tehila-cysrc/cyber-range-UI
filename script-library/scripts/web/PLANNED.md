# Planned web application scripts

Require a known lab app base URL (parameter). No brute force, no SQLi payloads.

## web-http-login-success (intermediate)
- POST valid lab credentials once to `/login` (or documented path)
- Expected: app access log 200; optional app auth success event
- QRadar: web access log source — successful POST /login

## web-http-login-fail (basic)
- POST wrong password **once** to generate a single failure
- Expected: 401/403 in access log
- QRadar: failed login line
- auto_inject_candidate: true

## web-http-health (basic) — covered by health-http-probe*
- GET homepage

## web-api-get (basic)
- GET `/api/health` or `/api/version`
- Expected: 200 JSON
- QRadar: access log

## web-file-upload-benign (intermediate)
- Upload tiny text file with CR-MARKER to lab upload endpoint only
- Never upload executables
