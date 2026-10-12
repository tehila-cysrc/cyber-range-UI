// In-memory throttle for failed logins. Passwords are compared in plaintext by design (CLAUDE.md), so
// guessing must at least be slow. Two buckets:
//  - per (IP, username): 10 failures / 10 min stops guessing one account's password;
//  - per IP: a looser cap stops spraying many usernames. It stays high because a whole classroom
//    usually shares one NAT address and students mistype at the start of an event.
// A successful login clears its (IP, username) bucket only, so a typo streak doesn't linger.
const WINDOW_MS = 10 * 60_000;
const MAX_PER_ACCOUNT = 10;
const MAX_PER_IP = 100;

const failures = new Map<string, { count: number; windowStart: number }>();

function accountKey(ip: string, username: string) {
  return `acct:${ip}|${username.trim().toLowerCase()}`;
}
function ipKey(ip: string) {
  return `ip:${ip}`;
}

function countFor(key: string, now: number): number {
  const f = failures.get(key);
  if (!f) return 0;
  if (now - f.windowStart > WINDOW_MS) {
    failures.delete(key);
    return 0;
  }
  return f.count;
}

function bump(key: string, now: number) {
  // Keep a username-spraying client from growing the map without bound.
  if (failures.size > 10_000) {
    for (const [k, f] of failures) if (now - f.windowStart > WINDOW_MS) failures.delete(k);
  }
  const f = failures.get(key);
  if (!f || now - f.windowStart > WINDOW_MS) failures.set(key, { count: 1, windowStart: now });
  else f.count++;
}

export function isLoginThrottled(ip: string, username: string, now = Date.now()): boolean {
  return countFor(accountKey(ip, username), now) >= MAX_PER_ACCOUNT || countFor(ipKey(ip), now) >= MAX_PER_IP;
}

export function recordLoginFailure(ip: string, username: string, now = Date.now()) {
  bump(accountKey(ip, username), now);
  bump(ipKey(ip), now);
}

export function recordLoginSuccess(ip: string, username: string) {
  failures.delete(accountKey(ip, username));
}
