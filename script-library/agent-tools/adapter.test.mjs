import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import { loadCatalog, dryRun, executeLive, runTool } from './adapter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_ROOT = path.resolve(HERE, '../scripts/ai-agent');

const VALID_CATEGORIES = ['process_execution', 'identity', 'file_access', 'network', 'automation', 'housekeeping'];
const VALID_BLAST_RADIUS = ['host_local_read', 'host_local_write', 'network_egress', 'cross_host_read', 'cross_host_write'];
const ALLOWED_SCHEMA_KEYS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'pattern', 'maxLength', 'minLength', 'enum', 'minimum', 'maximum',
]);
const FORBIDDEN_SCHEMA_KEYS = new Set(['oneOf', 'anyOf', 'allOf', 'not', '$ref', 'format']);

const catalog = loadCatalog();

// Lab scratch root used by write_decoy_payload_file / archive_scratch_directory, so tests can
// assert on real filesystem state and clean up after themselves.
const LAB_AGENT_ACTIVITY_DIR = os.platform() === 'win32'
  ? 'C:\\CyberRange\\Lab\\agent-activity'
  : '/var/tmp/cyber-range/agent-activity';

function cleanLabDir() {
  rmSync(LAB_AGENT_ACTIVITY_DIR, { recursive: true, force: true });
}

before(cleanLabDir);
after(cleanLabDir);

test('catalog has exactly the 19 expected tools', () => {
  assert.equal(catalog.tools.length, 19);
});

test('every tool_name is unique and matches ^[a-z0-9_]+$', () => {
  const names = catalog.tools.map((t) => t.tool_name);
  assert.equal(new Set(names).size, names.length, 'tool_name values must be unique');
  for (const name of names) {
    assert.match(name, /^[a-z0-9_]+$/, `tool_name "${name}" must be lowercase snake_case`);
  }
});

test('every tool has a valid category', () => {
  for (const tool of catalog.tools) {
    assert.ok(
      VALID_CATEGORIES.includes(tool.category),
      `${tool.tool_name} has invalid category "${tool.category}"`,
    );
  }
});

test('every tool has a valid blast_radius', () => {
  for (const tool of catalog.tools) {
    assert.ok(
      VALID_BLAST_RADIUS.includes(tool.blast_radius),
      `${tool.tool_name} has invalid blast_radius "${tool.blast_radius}"`,
    );
  }
});

test('requires_credentials is always false', () => {
  for (const tool of catalog.tools) {
    assert.equal(tool.requires_credentials, false, `${tool.tool_name} must have requires_credentials=false`);
  }
});

test('handler type is script_library_adapter and ref matches tool_name', () => {
  for (const tool of catalog.tools) {
    assert.equal(tool.handler?.type, 'script_library_adapter');
    assert.equal(tool.handler?.ref, tool.tool_name);
  }
});

test('every params_schema uses only the supported JSON Schema subset', () => {
  for (const tool of catalog.tools) {
    const schema = tool.params_schema;
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false, `${tool.tool_name} params_schema must set additionalProperties:false`);
    assert.deepEqual(schema.properties, {}, `${tool.tool_name} should be parameterless`);
    assert.deepEqual(schema.required, []);
    for (const key of Object.keys(schema)) {
      assert.ok(ALLOWED_SCHEMA_KEYS.has(key), `${tool.tool_name} params_schema uses disallowed key "${key}"`);
      assert.ok(!FORBIDDEN_SCHEMA_KEYS.has(key), `${tool.tool_name} params_schema uses forbidden key "${key}"`);
    }
  }
});

test('every tool declares required ToolDeclaration fields', () => {
  const requiredFields = [
    'tool_name', 'description', 'category', 'blast_radius', 'dry_run_only', 'requires_credentials',
    'idempotent', 'timeout_seconds', 'params_schema', 'target_constraint', 'expected_outcomes',
    'handler', 'max_result_bytes',
  ];
  for (const tool of catalog.tools) {
    for (const field of requiredFields) {
      assert.ok(field in tool, `${tool.tool_name} is missing field "${field}"`);
    }
    assert.ok(tool.timeout_seconds > 0 && tool.timeout_seconds <= 30);
    assert.ok(tool.max_result_bytes > 0 && tool.max_result_bytes <= 8000);
  }
});

test('a corresponding script file pair exists for every tool', () => {
  for (const tool of catalog.tools) {
    const kebab = tool.tool_name.replace(/_/g, '-');
    assert.ok(existsSync(path.join(SCRIPT_ROOT, `${kebab}.ps1`)), `${tool.tool_name} missing .ps1`);
    assert.ok(existsSync(path.join(SCRIPT_ROOT, `${kebab}-linux.sh`)), `${tool.tool_name} missing -linux.sh`);
  }
});

test('dry_run never performs real side effects (write_decoy_payload_file)', () => {
  cleanLabDir();
  const tool = catalog.tools.find((t) => t.tool_name === 'write_decoy_payload_file');
  const result = dryRun(tool);
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.status, 'success');
  assert.equal(existsSync(LAB_AGENT_ACTIVITY_DIR), false, 'dry_run must not touch the filesystem');
});

test('dry_run returns a valid ToolResult for every tool without touching disk/network', () => {
  cleanLabDir();
  for (const tool of catalog.tools) {
    const result = dryRun(tool);
    assert.equal(result.mode, 'dry_run');
    assert.equal(typeof result.status, 'string');
    assert.equal(typeof result.result, 'string');
    assert.ok(result.result.length > 0);
    assert.ok(Buffer.byteLength(result.result, 'utf-8') <= 2000, `${tool.tool_name} dry_run result too long for an LLM observation`);
  }
  assert.equal(existsSync(LAB_AGENT_ACTIVITY_DIR), false, 'dry_run must never create the lab scratch dir');
});

test('dry_run_only tools throw from execute_live and are never a silent no-op', () => {
  for (const toolName of ['simulate_credential_probe', 'beacon_to_decoy_endpoint']) {
    const tool = catalog.tools.find((t) => t.tool_name === toolName);
    assert.equal(tool.dry_run_only, true);
    assert.throws(() => executeLive(tool), /NotImplementedError/);
  }
});

test('probe_internal_service_ports scripts hardcode 127.0.0.1 with no parameter/env indirection', () => {
  const ps1 = readFileSync(path.join(SCRIPT_ROOT, 'probe-internal-service-ports.ps1'), 'utf-8');
  const sh = readFileSync(path.join(SCRIPT_ROOT, 'probe-internal-service-ports-linux.sh'), 'utf-8');
  for (const content of [ps1, sh]) {
    assert.match(content, /127\.0\.0\.1/, 'target must be hardcoded loopback');
    assert.doesNotMatch(content, /param\s*\(/i, 'must not accept parameters');
    assert.doesNotMatch(content, /\$env:|getenv|\$\{[A-Z_]+:-/i, 'must not read target from environment indirection');
  }
});

test('archive_scratch_directory scripts write to one fixed filename, never timestamped', () => {
  const ps1 = readFileSync(path.join(SCRIPT_ROOT, 'archive-scratch-directory.ps1'), 'utf-8');
  const sh = readFileSync(path.join(SCRIPT_ROOT, 'archive-scratch-directory-linux.sh'), 'utf-8');

  const ps1ArchiveLine = ps1.split('\n').find((l) => l.includes('$archivePath ='));
  assert.match(ps1ArchiveLine, /scratch-archive\.zip'/, 'archive path must be a fixed literal filename');
  assert.doesNotMatch(ps1ArchiveLine, /\$runId/, 'archive path must not include the run id');

  const shArchiveLine = sh.split('\n').find((l) => l.includes('ARCHIVE_PATH='));
  assert.match(shArchiveLine, /scratch-archive\.tar\.gz/, 'archive path must be a fixed literal filename');
  assert.doesNotMatch(shArchiveLine, /RUN_ID/, 'archive path must not include the run id');
});

test('live: check_disk_space (normal) returns a bounded successful ToolResult', () => {
  const result = runTool('check_disk_space', 'live');
  assert.equal(result.mode, 'live');
  assert.equal(result.status, 'success');
  assert.ok(Buffer.byteLength(result.result, 'utf-8') <= 500);
});

test('live: inspect_safe_environment_variables (suspicious) returns a bounded successful ToolResult', () => {
  const result = runTool('inspect_safe_environment_variables', 'live');
  assert.equal(result.mode, 'live');
  assert.equal(result.status, 'success');
  assert.ok(Buffer.byteLength(result.result, 'utf-8') <= 500);
});

test('live: write_decoy_payload_file writes to a fixed path, repeatable without growth', () => {
  cleanLabDir();
  const r1 = runTool('write_decoy_payload_file', 'live');
  assert.equal(r1.status, 'success');
  const scratchDir = path.join(LAB_AGENT_ACTIVITY_DIR, 'scratch');
  const files1 = readdirSync(scratchDir);
  assert.deepEqual(files1, ['decoy-payload.txt']);

  const r2 = runTool('write_decoy_payload_file', 'live');
  assert.equal(r2.status, 'success');
  const files2 = readdirSync(scratchDir);
  assert.deepEqual(files2, ['decoy-payload.txt'], 'repeated calls must not accumulate files');
});

test('live: archive_scratch_directory writes exactly one archive file, even after repeated calls', () => {
  cleanLabDir();
  runTool('write_decoy_payload_file', 'live');

  const r1 = runTool('archive_scratch_directory', 'live');
  assert.equal(r1.status, 'success');
  const r2 = runTool('archive_scratch_directory', 'live');
  assert.equal(r2.status, 'success');

  const archiveFiles = readdirSync(LAB_AGENT_ACTIVITY_DIR).filter((f) => f.startsWith('scratch-archive.'));
  assert.equal(archiveFiles.length, 1, 'repeated archive calls must produce exactly one archive file, not accumulate');

  const stat = statSync(path.join(LAB_AGENT_ACTIVITY_DIR, archiveFiles[0]));
  assert.ok(stat.isFile());
});

test('unknown tool_name is rejected, not silently accepted', () => {
  assert.throws(() => runTool('drop_table_users', 'dry_run'), /unknown tool_name/);
});
