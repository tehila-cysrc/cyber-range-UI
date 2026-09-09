import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Implements guacamole-lite's actual token wire format (https://github.com/vadimpronin/guacamole-lite)
// so that whenever a real guacd + guacamole-lite server is stood up, this broker's tokens work
// against it unmodified — nothing here is a guess at a protocol, it's the documented one. A future
// Phase 4 completion only needs to point GUACAMOLE_LITE_SECRET_KEY at the same key configured on
// that server and stand up the actual guacd network path; the token format itself needs no changes.
const CIPHER = 'aes-256-cbc';

export interface GuacamoleConnectionSettings {
  hostname: string;
  port: string;
  username: string;
  password: string;
  // Hardening flags recommended for a training-lab context: no clipboard/drive sharing out of a
  // student's session by default.
  'enable-drive'?: string;
  'disable-copy'?: string;
  'disable-paste'?: string;
}

export interface GuacamoleConnectionConfig {
  connection: {
    type: 'rdp' | 'ssh';
    settings: GuacamoleConnectionSettings;
  };
}

function getSecretKey(): Buffer {
  const raw = process.env.GUACAMOLE_LITE_SECRET_KEY;
  if (!raw) {
    throw new Error('GUACAMOLE_LITE_SECRET_KEY is not set — required to mint a broker connection token');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('GUACAMOLE_LITE_SECRET_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key)');
  }
  return key;
}

export function buildConnectionConfig(
  protocol: 'rdp' | 'ssh',
  host: string,
  port: number,
  username: string,
  password: string,
): GuacamoleConnectionConfig {
  return {
    connection: {
      type: protocol,
      settings: {
        hostname: host,
        port: String(port),
        username,
        password,
        'enable-drive': 'false',
        'disable-copy': 'true',
        'disable-paste': 'true',
      },
    },
  };
}

// Encrypts a connection config into the exact `{iv, value}` JSON shape guacamole-lite's crypt.js
// produces, then base64-encodes that whole JSON string — the final result is what a client passes as
// `?token=` to guacd's websocket tunnel. Never log this return value; it embeds the VM's login secret.
export function encryptConnectionToken(config: GuacamoleConnectionConfig): string {
  const key = getSecretKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);

  const envelope = JSON.stringify({ iv: iv.toString('base64'), value: encrypted.toString('base64') });
  return Buffer.from(envelope, 'utf8').toString('base64');
}

// Exported for verification only (proving the encryption round-trips and matches guacamole-lite's
// documented format) — the real decrypt happens inside guacd/guacamole-lite, never in this app.
export function decryptConnectionToken(token: string): GuacamoleConnectionConfig {
  const key = getSecretKey();
  const envelope = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as { iv: string; value: string };
  const decipher = createDecipheriv(CIPHER, key, Buffer.from(envelope.iv, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.value, 'base64')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
