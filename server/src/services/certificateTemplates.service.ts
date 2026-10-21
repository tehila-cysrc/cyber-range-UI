import { db } from '../db/index.js';

// Certificate library (CONFIG certificate_templates): the printed text of a completion certificate.
// The design itself is fixed (client features/certificate/Certificate.tsx) — a template only changes
// its words. A scenario picks a template (cyber_ranges.certificate_template_id); NULL, or a deleted
// template (ON DELETE SET NULL), means the default one. Exactly one template is the default.

export interface CertificateTemplateFields {
  name: string;
  label: string;
  title: string;
  body: string;
  skills: string[];
  program: string;
  programHighlight: string;
  signerName: string;
  signerTitle: string;
  statusText: string;
}

export interface CertificateTemplate extends CertificateTemplateFields {
  id: number;
  isDefault: boolean;
  updatedAt: string;
}

// The approved copy of design 1 (docs/brand/certificates) — the library's first, default entry.
export const ORIGINAL_CERTIFICATE: CertificateTemplateFields = {
  name: 'AI Agent Compromise & Hybrid IR',
  label: 'Certificate of Completion',
  title: 'AI Agent Compromise\n& Hybrid Incident Response',
  body: 'For successfully completing an advanced CySource Cyber Range exercise in AI-driven cyber incident investigation and response across hybrid Microsoft environments.',
  skills: [
    'AI Agent Compromise',
    'C2 Investigation',
    'Identity & Credential Abuse',
    'Hybrid Pivoting',
    'Attack Reconstruction',
    'Containment & Remediation',
  ],
  program: 'Advanced SOC Training',
  programHighlight: 'Cyber Range',
  signerName: 'Amir Bar-El',
  signerTitle: 'CySource Founder',
  statusText: 'Mission Complete',
};

// Limits keep the text inside the fixed A4 layout (title: two lines, body: about three).
const LIMITS: Record<Exclude<keyof CertificateTemplateFields, 'skills'>, number> = {
  name: 80,
  label: 40,
  title: 70,
  body: 260,
  program: 40,
  programHighlight: 30,
  signerName: 40,
  signerTitle: 40,
  statusText: 30,
};
const MAX_SKILLS = 6;
const MAX_SKILL_LENGTH = 32;

const SELECT = `SELECT id, name, label, title, body, skills_json AS skillsJson, program,
  program_highlight AS programHighlight, signer_name AS signerName, signer_title AS signerTitle,
  status_text AS statusText, is_default AS isDefault, updated_at AS updatedAt FROM certificate_templates`;

type Row = Omit<CertificateTemplate, 'skills' | 'isDefault'> & { skillsJson: string; isDefault: number };

function toTemplate(row: Row): CertificateTemplate {
  const { skillsJson, isDefault, ...rest } = row;
  let skills: string[] = [];
  try {
    const parsed = JSON.parse(skillsJson);
    if (Array.isArray(parsed)) skills = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    // A hand-edited bad value prints no skills rather than breaking every certificate.
  }
  return { ...rest, skills, isDefault: isDefault === 1 };
}

export function listCertificateTemplates(): CertificateTemplate[] {
  return (db.prepare(`${SELECT} ORDER BY is_default DESC, name COLLATE NOCASE`).all() as Row[]).map(toTemplate);
}

export function getCertificateTemplate(id: number): CertificateTemplate | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return row ? toTemplate(row) : null;
}

export function defaultCertificateTemplate(): CertificateTemplate {
  const row = db.prepare(`${SELECT} WHERE is_default = 1`).get() as Row | undefined;
  if (row) return toTemplate(row);
  // migrate() always leaves a default row; this only guards a hand-edited database.
  return { ...ORIGINAL_CERTIFICATE, id: 0, isDefault: true, updatedAt: '' };
}

/** The certificate a scenario awards: its own template, else the default. `null` = no scenario (legacy grant). */
export function certificateTemplateForScenario(cyberRangeId: number | null): CertificateTemplate {
  if (cyberRangeId === null) return defaultCertificateTemplate();
  const row = db
    .prepare(`${SELECT} WHERE id = (SELECT certificate_template_id FROM cyber_ranges WHERE id = ?)`)
    .get(cyberRangeId) as Row | undefined;
  return row ? toTemplate(row) : defaultCertificateTemplate();
}

/** Called by migrate(): the library always has a default — the original certificate on first run. */
export function ensureDefaultCertificateTemplate() {
  if (db.prepare('SELECT 1 FROM certificate_templates WHERE is_default = 1').get()) return;
  const first = db.prepare('SELECT id FROM certificate_templates ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (first) {
    db.prepare('UPDATE certificate_templates SET is_default = 1 WHERE id = ?').run(first.id);
    return;
  }
  insertTemplate(ORIGINAL_CERTIFICATE, true);
}

function insertTemplate(fields: CertificateTemplateFields, isDefault: boolean): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO certificate_templates (name, label, title, body, skills_json, program, program_highlight,
         signer_name, signer_title, status_text, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.name,
      fields.label,
      fields.title,
      fields.body,
      JSON.stringify(fields.skills),
      fields.program,
      fields.programHighlight,
      fields.signerName,
      fields.signerTitle,
      fields.statusText,
      isDefault ? 1 : 0,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

type Validated = { ok: true; fields: Partial<CertificateTemplateFields> } | { ok: false; error: string };

/** `partial` (PATCH): only the fields sent are checked and returned. */
export function validateTemplateFields(input: unknown, partial: boolean): Validated {
  const body = (input ?? {}) as Record<string, unknown>;
  const fields: Partial<CertificateTemplateFields> = {};
  for (const [key, max] of Object.entries(LIMITS) as Array<[keyof typeof LIMITS, number]>) {
    const value = body[key];
    if (value === undefined && partial) continue;
    if (typeof value !== 'string' || !value.trim()) return { ok: false, error: `${key} is required` };
    const text = key === 'title' ? value.replace(/\r\n/g, '\n').trim() : value.replace(/\s+/g, ' ').trim();
    if (text.length > max) return { ok: false, error: `${key} must be at most ${max} characters` };
    if (key === 'title' && text.split('\n').length > 2) return { ok: false, error: 'title may have at most two lines' };
    fields[key] = text;
  }
  if (body.skills !== undefined || !partial) {
    if (!Array.isArray(body.skills) || body.skills.some((s) => typeof s !== 'string')) {
      return { ok: false, error: 'skills must be a list of strings' };
    }
    const skills = (body.skills as string[]).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (skills.length > MAX_SKILLS) return { ok: false, error: `at most ${MAX_SKILLS} skills` };
    if (skills.some((s) => s.length > MAX_SKILL_LENGTH)) return { ok: false, error: `each skill must be at most ${MAX_SKILL_LENGTH} characters` };
    fields.skills = skills;
  }
  return { ok: true, fields };
}

function nameTaken(name: string, exceptId?: number): boolean {
  return !!db.prepare('SELECT 1 FROM certificate_templates WHERE name = ? COLLATE NOCASE AND id IS NOT ?').get(name, exceptId ?? null);
}

type Result = { ok: true; template: CertificateTemplate } | { ok: false; status: 400 | 404 | 409; error: string };

export function createCertificateTemplate(input: unknown): Result {
  const v = validateTemplateFields(input, false);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const fields = v.fields as CertificateTemplateFields;
  if (nameTaken(fields.name)) return { ok: false, status: 409, error: 'a certificate with this name already exists' };
  return { ok: true, template: getCertificateTemplate(insertTemplate(fields, false))! };
}

const COLUMN: Record<Exclude<keyof CertificateTemplateFields, 'skills'>, string> = {
  name: 'name',
  label: 'label',
  title: 'title',
  body: 'body',
  program: 'program',
  programHighlight: 'program_highlight',
  signerName: 'signer_name',
  signerTitle: 'signer_title',
  statusText: 'status_text',
};

/** Only the fields sent change; `isDefault: true` makes it the default (there is no "unset" — pick another). */
export function updateCertificateTemplate(id: number, input: unknown): Result {
  if (!getCertificateTemplate(id)) return { ok: false, status: 404, error: 'certificate not found' };
  const v = validateTemplateFields(input, true);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const makeDefault = (input as Record<string, unknown> | null)?.isDefault;
  if (makeDefault !== undefined && makeDefault !== true) return { ok: false, status: 400, error: 'isDefault can only be set to true' };
  if (v.fields.name !== undefined && nameTaken(v.fields.name, id)) {
    return { ok: false, status: 409, error: 'a certificate with this name already exists' };
  }
  const sets: string[] = [];
  const params: string[] = [];
  for (const [key, column] of Object.entries(COLUMN) as Array<[keyof typeof COLUMN, string]>) {
    if (v.fields[key] !== undefined) (sets.push(`${column} = ?`), params.push(v.fields[key]!));
  }
  if (v.fields.skills !== undefined) (sets.push('skills_json = ?'), params.push(JSON.stringify(v.fields.skills)));

  db.exec('BEGIN');
  try {
    if (sets.length) {
      db.prepare(`UPDATE certificate_templates SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, new Date().toISOString(), id);
    }
    if (makeDefault) {
      db.prepare('UPDATE certificate_templates SET is_default = 0 WHERE is_default = 1 AND id != ?').run(id);
      db.prepare('UPDATE certificate_templates SET is_default = 1 WHERE id = ?').run(id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, template: getCertificateTemplate(id)! };
}

/** Scenarios using it fall back to the default (FK ON DELETE SET NULL). The default itself can't be deleted. */
export function deleteCertificateTemplate(id: number): { ok: true; name: string; scenariosReset: number } | { ok: false; status: 404 | 409; error: string } {
  const template = getCertificateTemplate(id);
  if (!template) return { ok: false, status: 404, error: 'certificate not found' };
  if (template.isDefault) return { ok: false, status: 409, error: 'the default certificate can’t be deleted — make another one the default first' };
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM cyber_ranges WHERE certificate_template_id = ?').get(id) as { n: number };
  db.prepare('DELETE FROM certificate_templates WHERE id = ?').run(id);
  return { ok: true, name: template.name, scenariosReset: n };
}

/** Scenario id → name of every scenario that picked each template (default users are implicit). */
export function scenariosByTemplate(): Map<number, Array<{ id: number; name: string }>> {
  const rows = db
    .prepare('SELECT id, name, certificate_template_id AS templateId FROM cyber_ranges WHERE certificate_template_id IS NOT NULL ORDER BY name')
    .all() as Array<{ id: number; name: string; templateId: number }>;
  const map = new Map<number, Array<{ id: number; name: string }>>();
  for (const r of rows) map.set(r.templateId, [...(map.get(r.templateId) ?? []), { id: r.id, name: r.name }]);
  return map;
}

export function certificateTemplateExists(id: unknown): boolean {
  return Number.isInteger(id) && !!db.prepare('SELECT 1 FROM certificate_templates WHERE id = ?').get(id as number);
}
