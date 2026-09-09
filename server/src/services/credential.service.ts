import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db } from '../db/index.js';

// Single secret-handling module for the whole app: every cloud Service Principal secret and (later)
// VM login credential is encrypted/decrypted here, and nowhere else. Never log or return a value
// produced by readCredentialPlaintext() — see CLAUDE/invariants.md.
const ALGORITHM = 'aes-256-gcm';

export type CredentialKind = 'service_principal' | 'vm_login';

interface CredentialRow {
  secretCiphertext: Buffer;
  secretIv: Buffer;
  secretAuthTag: Buffer;
}

function getMasterKey(): Buffer {
  const raw = process.env.CREDENTIAL_MASTER_KEY;
  if (!raw) {
    throw new Error('CREDENTIAL_MASTER_KEY is not set — required to store or read cloud environment credentials');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_MASTER_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key)');
  }
  return key;
}

export function storeCredential(
  kind: CredentialKind,
  plaintextSecret: string,
  metadata: Record<string, unknown> | null,
  createdByUsername: string,
): number {
  const { ciphertext, iv, authTag } = encrypt(plaintextSecret);

  const result = db
    .prepare(
      `INSERT INTO credentials (kind, secret_ciphertext, secret_iv, secret_auth_tag, metadata_json, created_at, created_by_username)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(kind, ciphertext, iv, authTag, metadata ? JSON.stringify(metadata) : null, new Date().toISOString(), createdByUsername);

  return result.lastInsertRowid as number;
}

export function rotateCredential(credentialId: number, plaintextSecret: string): void {
  const { ciphertext, iv, authTag } = encrypt(plaintextSecret);

  db.prepare(
    `UPDATE credentials SET secret_ciphertext = ?, secret_iv = ?, secret_auth_tag = ?, rotated_at = ? WHERE id = ?`,
  ).run(ciphertext, iv, authTag, new Date().toISOString(), credentialId);
}

// The only function in the codebase that ever produces plaintext secret material. Callers must use
// the result immediately (e.g. to build an Azure credential object) and never store or log it.
export function readCredentialPlaintext(credentialId: number): string {
  const key = getMasterKey();
  const row = db
    .prepare(
      `SELECT secret_ciphertext AS secretCiphertext, secret_iv AS secretIv, secret_auth_tag AS secretAuthTag
       FROM credentials WHERE id = ?`,
    )
    .get(credentialId) as CredentialRow | undefined;

  if (!row) {
    throw new Error(`no credential with id ${credentialId}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, row.secretIv);
  decipher.setAuthTag(row.secretAuthTag);
  const plaintext = Buffer.concat([decipher.update(row.secretCiphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function deleteCredential(credentialId: number): void {
  db.prepare('DELETE FROM credentials WHERE id = ?').run(credentialId);
}

function encrypt(plaintextSecret: string) {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextSecret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}
