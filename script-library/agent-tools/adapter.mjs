#!/usr/bin/env node
// Reference/bridge adapter between the external Agent Simulator's ToolDeclaration/ToolResult
// contract and this Script Library's ai-agent scripts. Standalone: no dependency on server/,
// client/, the DB, or Azure. See ../AGENT_SIMULATOR_INTEGRATION.md — this file is one possible
// runtime integration (shell out to it via CLI, or reimplement the same dispatch against
// catalog.json directly), not assumed to be the Agent Simulator repo's final integration.
//
// CLI:    node adapter.mjs <tool_name> <dry_run|live>   → prints a ToolResult JSON object to stdout
// Import: import { runTool } from './adapter.mjs'

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(HERE, 'catalog.json');
const SCRIPT_ROOT = path.resolve(HERE, '../scripts/ai-agent');

export function loadCatalog() {
  const raw = readFileSync(CATALOG_PATH, 'utf-8');
  return JSON.parse(raw);
}

function findTool(catalog, toolName) {
  const tool = catalog.tools.find((t) => t.tool_name === toolName);
  if (!tool) {
    throw new Error(`unknown tool_name: ${toolName}`);
  }
  return tool;
}

function scriptPathsFor(toolName) {
  const kebab = toolName.replace(/_/g, '-');
  return {
    windows: path.join(SCRIPT_ROOT, `${kebab}.ps1`),
    linux: path.join(SCRIPT_ROOT, `${kebab}-linux.sh`),
  };
}

function truncate(text, maxBytes) {
  const buf = Buffer.from(text ?? '', 'utf-8');
  if (buf.length <= maxBytes) return text ?? '';
  return buf.subarray(0, maxBytes).toString('utf-8') + '\n...[truncated]';
}

function summarize(text, maxLen = 200) {
  const oneLine = (text ?? '').trim().replace(/\s+/g, ' ');
  if (oneLine.length <= maxLen) return oneLine || '(no output)';
  return oneLine.slice(0, maxLen) + '...';
}

// dry_run(): never spawns a process, never touches disk/network. Pure synthetic description
// built from the catalog entry itself.
export function dryRun(tool) {
  return {
    status: 'success',
    result: `SIMULATED (dry run): ${tool.description} Target: ${tool.target_constraint}`,
    target: tool.target_constraint,
    mode: 'dry_run',
    extra: {
      tool_name: tool.tool_name,
      category: tool.category,
      blast_radius: tool.blast_radius,
      dry_run_only: tool.dry_run_only,
      expected_outcomes: tool.expected_outcomes,
    },
  };
}

// execute_live(): spawns the OS-appropriate real script for safe tools. dry_run_only tools
// throw — never a silent no-op.
export function executeLive(tool) {
  if (tool.dry_run_only) {
    throw new Error(`NotImplementedError: ${tool.tool_name} is dry_run_only and has no live execution path`);
  }

  const paths = scriptPathsFor(tool.tool_name);
  const isWindows = os.platform() === 'win32';
  const scriptPath = isWindows ? paths.windows : paths.linux;

  const spawnArgs = isWindows
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]]
    : ['bash', [scriptPath]];

  const result = spawnSync(spawnArgs[0], spawnArgs[1], {
    timeout: tool.timeout_seconds * 1000,
    encoding: 'utf-8',
    windowsHide: true,
  });

  if (result.error) {
    return {
      status: 'failed',
      result: `execution error: ${result.error.message}`,
      target: tool.target_constraint,
      mode: 'live',
      extra: { tool_name: tool.tool_name, exitCode: null },
    };
  }

  const stdout = truncate(result.stdout ?? '', tool.max_result_bytes);
  const exitCode = result.status;
  const status = exitCode === 0 ? 'success' : 'failed';

  return {
    status,
    result: summarize(stdout),
    target: tool.target_constraint,
    mode: 'live',
    extra: { tool_name: tool.tool_name, exitCode, stdout },
  };
}

export function runTool(toolName, mode) {
  const catalog = loadCatalog();
  const tool = findTool(catalog, toolName);

  if (mode === 'dry_run') {
    return dryRun(tool);
  }
  if (mode === 'live') {
    return executeLive(tool);
  }
  throw new Error(`unknown mode: ${mode} (expected "dry_run" or "live")`);
}

function cliMain() {
  const [, , toolName, mode] = process.argv;
  if (!toolName || !mode) {
    process.stderr.write('usage: node adapter.mjs <tool_name> <dry_run|live>\n');
    process.exit(2);
  }
  try {
    const result = runTool(toolName, mode);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    process.stdout.write(
      JSON.stringify(
        { status: 'failed', result: err.message, target: null, mode, extra: {} },
        null,
        2,
      ) + '\n',
    );
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  cliMain();
}
