// Writes the agent's Text-format JSON Schema (docs/ai-agent/) from the app's zod contract
// (src/services/ai/assessmentContract.ts). Run: npm run export-ai-schema -w server (builds first).
// The output is what the admin pastes into the Foundry agent definition; a test fails if the committed
// files drift from the contract.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { buildEnvelopeJsonSchema, buildAgentTextFormat } = await import('../dist/services/ai/assessmentContract.js');

const outDir = join(here, '..', '..', 'docs', 'ai-agent');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'assessment-envelope.schema.json'), JSON.stringify(buildEnvelopeJsonSchema(), null, 2) + '\n');
writeFileSync(join(outDir, 'agent-text-format.json'), JSON.stringify(buildAgentTextFormat(), null, 2) + '\n');
console.log(`wrote ${outDir}/assessment-envelope.schema.json and agent-text-format.json`);
