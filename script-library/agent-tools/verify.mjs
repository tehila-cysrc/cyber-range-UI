#!/usr/bin/env node
// Standalone verification harness — runs without the external Agent Simulator.
// Exercises one Normal, one Suspicious, and one Adversarial-simulated capability through the
// adapter and fails loudly (non-zero exit) if any result violates the expected ToolResult
// contract. Run: node script-library/agent-tools/verify.mjs

import { runTool } from './adapter.mjs';

let failed = false;

function heading(label) {
  console.log(`\n=== ${label} ===`);
}

function checkToolResult(label, result) {
  const required = ['status', 'result', 'target', 'mode', 'extra'];
  for (const field of required) {
    if (!(field in result)) {
      console.error(`FAIL [${label}] missing ToolResult field "${field}"`);
      failed = true;
    }
  }
  if (!['success', 'failed', 'retrying'].includes(result.status)) {
    console.error(`FAIL [${label}] invalid status "${result.status}"`);
    failed = true;
  }
  if (!['dry_run', 'live'].includes(result.mode)) {
    console.error(`FAIL [${label}] invalid mode "${result.mode}"`);
    failed = true;
  }
  if (typeof result.result !== 'string' || result.result.length === 0) {
    console.error(`FAIL [${label}] result must be a non-empty string`);
    failed = true;
  }
  console.log(`  status=${result.status} mode=${result.mode}`);
  console.log(`  result=${result.result}`);
}

// --- Normal: check_disk_space ---
heading('DRY RUN — normal (check_disk_space)');
checkToolResult('check_disk_space/dry_run', runTool('check_disk_space', 'dry_run'));

heading('LIVE SAFE ACTION — normal (check_disk_space)');
{
  const r = runTool('check_disk_space', 'live');
  checkToolResult('check_disk_space/live', r);
  if (r.mode !== 'live') {
    console.error('FAIL check_disk_space live run did not report mode=live');
    failed = true;
  }
}

// --- Suspicious: inspect_safe_environment_variables ---
heading('DRY RUN — suspicious (inspect_safe_environment_variables)');
checkToolResult('inspect_safe_environment_variables/dry_run', runTool('inspect_safe_environment_variables', 'dry_run'));

heading('LIVE SAFE ACTION — suspicious (inspect_safe_environment_variables)');
checkToolResult('inspect_safe_environment_variables/live', runTool('inspect_safe_environment_variables', 'live'));

// --- Adversarial-simulated: simulate_credential_probe (dry_run_only) ---
heading('DRY RUN — SIMULATED ADVERSARIAL ACTION (simulate_credential_probe)');
{
  const r = runTool('simulate_credential_probe', 'dry_run');
  checkToolResult('simulate_credential_probe/dry_run', r);
  if (!/SIMULATED/.test(r.result)) {
    console.error('FAIL simulate_credential_probe dry_run result should clearly read as simulated');
    failed = true;
  }
}

heading('confirming simulate_credential_probe refuses live execution');
try {
  runTool('simulate_credential_probe', 'live');
  console.error('FAIL simulate_credential_probe/live should have thrown (dry_run_only)');
  failed = true;
} catch (err) {
  if (!/NotImplementedError/.test(err.message)) {
    console.error(`FAIL unexpected error shape from dry_run_only live call: ${err.message}`);
    failed = true;
  } else {
    console.log(`  OK — refused as expected: ${err.message}`);
  }
}

console.log('');
if (failed) {
  console.error('VERIFICATION FAILED — see FAIL lines above.');
  process.exit(1);
} else {
  console.log('VERIFICATION PASSED — normal, suspicious, and adversarial-simulated capabilities all behave per contract.');
  process.exit(0);
}
