// Writes the agent's Text-format JSON Schema (docs/ai-agent/) from the app's zod contract
// (src/services/ai/assessmentContract.ts). Run: npm run export-ai-schema -w server (builds first).
// The output is what the admin pastes into the Foundry agent definition; a test fails if the committed
// files drift from the contract.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { buildEnvelopeJsonSchema, buildAgentTextFormat, CONTRACT_VERSION, PROPOSED_CONTRACT_VERSION } = await import('../dist/services/ai/assessmentContract.js');

// docs/ai-agent/          = the contract of the pinned agent version (contract 2, applied to v6)
// docs/ai-agent/proposed/ = the Phase 8 proposal (contract 3), NOT applied in Foundry
const docs = join(here, '..', '..', 'docs', 'ai-agent');
for (const [dir, version] of [[docs, CONTRACT_VERSION], [join(docs, 'proposed'), PROPOSED_CONTRACT_VERSION]]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'assessment-envelope.schema.json'), JSON.stringify(buildEnvelopeJsonSchema(version), null, 2) + '\n');
  writeFileSync(join(dir, 'agent-text-format.json'), JSON.stringify(buildAgentTextFormat(version), null, 2) + '\n');
  console.log(`wrote contract ${version}: ${dir}/assessment-envelope.schema.json and agent-text-format.json`);
}
