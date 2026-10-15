// Validation of an uploaded scenario ground-truth document (plan §E, §J "Malicious uploads"). Pure — no
// I/O. The bytes are never rendered or executed by the app; parsing happens in Foundry. The client's
// declared MIME type is ignored: the type comes from the extension and must match the magic bytes.
import { createHash } from 'node:crypto';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // fits the global 8 MB JSON limit after base64
const MAX_FILENAME_LENGTH = 200;

const TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
} as const;

export type DocumentRejectReason = 'invalid_filename' | 'unsupported_type' | 'invalid_encoding' | 'empty' | 'too_large' | 'invalid_file';

export type DocumentValidationResult =
  | { ok: true; filename: string; mimeType: string; bytes: Buffer; sha256: string }
  | { ok: false; status: 400 | 413; reason: DocumentRejectReason; error: string };

const fail = (reason: DocumentRejectReason, error: string, status: 400 | 413 = 400): DocumentValidationResult => ({ ok: false, status, reason, error });

// Keep only a safe display name: last path segment, no control characters, bounded length.
export function sanitizeFilename(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean || clean.length > MAX_FILENAME_LENGTH || clean === '.' || clean === '..') return null;
  return clean;
}

function containsAscii(bytes: Buffer, text: string): boolean {
  return bytes.indexOf(Buffer.from(text, 'latin1')) !== -1;
}

export function validateScenarioDocument(input: { filename?: unknown; contentBase64?: unknown }): DocumentValidationResult {
  const filename = sanitizeFilename(input.filename);
  if (!filename) return fail('invalid_filename', `filename is required (max ${MAX_FILENAME_LENGTH} characters)`);
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext !== 'pdf' && ext !== 'docx' && ext !== 'txt') return fail('unsupported_type', 'only PDF, DOCX and TXT documents are supported');

  if (typeof input.contentBase64 !== 'string') return fail('invalid_encoding', 'contentBase64 must be a base64 string');
  // Accept a FileReader data URL too; then require strict base64.
  const b64 = input.contentBase64.replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '');
  if (!b64) return fail('empty', 'the document is empty');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return fail('invalid_encoding', 'contentBase64 is not valid base64');
  // Reject before decoding a huge payload (base64 is 4/3 of the size).
  if ((b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0) > MAX_DOCUMENT_BYTES) {
    return fail('too_large', `the document is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB`, 413);
  }
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length === 0) return fail('empty', 'the document is empty');

  // Content must match the declared extension.
  if (ext === 'pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return fail('invalid_file', 'the file is not a valid PDF');
  if (ext === 'docx') {
    const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (!isZip || !containsAscii(bytes, 'word/document.xml')) return fail('invalid_file', 'the file is not a valid DOCX document');
  }
  if (ext === 'txt') {
    if (bytes.includes(0)) return fail('invalid_file', 'the text file contains binary data');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return fail('invalid_file', 'the text file must be UTF-8');
    }
  }

  return { ok: true, filename, mimeType: TYPES[ext], bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
