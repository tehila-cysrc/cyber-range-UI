import { writeFileSync, mkdirSync } from 'node:fs';

// Regenerates src/data/mitre/enterprise-attack.json from MITRE's official STIX bundle. Run manually
// (needs internet) when upgrading the pinned ATT&CK version, then commit the output — the server
// only ever reads the committed file. Usage: node scripts/build-mitre-catalog.mjs [version]
const version = process.argv[2] ?? '19.2';
const url = `https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack-${version}.json`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`[mitre] download failed: ${res.status} ${url}`);
  process.exit(1);
}
const bundle = await res.json();
const objects = bundle.objects ?? [];

const isLive = (o) => !o.revoked && !o.x_mitre_deprecated;
const attackId = (o) => o.external_references?.find((r) => r.source_name === 'mitre-attack')?.external_id;

const matrix = objects.find((o) => o.type === 'x-mitre-matrix' && isLive(o));
const tacticObjects = objects.filter((o) => o.type === 'x-mitre-tactic' && isLive(o));
const tacticOrder = new Map((matrix?.tactic_refs ?? []).map((ref, i) => [ref, i]));

const tactics = tacticObjects
  .map((o) => ({ id: attackId(o), shortname: o.x_mitre_shortname, name: o.name, order: tacticOrder.get(o.id) ?? 999 }))
  .sort((a, b) => a.order - b.order);
const tacticIdByShortname = new Map(tactics.map((t) => [t.shortname, t.id]));

const techniques = objects
  .filter((o) => o.type === 'attack-pattern' && isLive(o) && attackId(o))
  .map((o) => {
    const id = attackId(o);
    const tacticIds = (o.kill_chain_phases ?? [])
      .filter((p) => p.kill_chain_name === 'mitre-attack')
      .map((p) => tacticIdByShortname.get(p.phase_name))
      .filter(Boolean);
    return { id, name: o.name, tacticIds, parentId: id.includes('.') ? id.split('.')[0] : null };
  })
  .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

const catalog = {
  attackVersion: version,
  source: url,
  tactics: tactics.map(({ id, shortname, name, order }) => ({ id, shortname, name, order })),
  techniques,
};

mkdirSync(new URL('../src/data/mitre/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/data/mitre/enterprise-attack.json', import.meta.url), JSON.stringify(catalog) + '\n');
console.log(`[mitre] ATT&CK ${version}: ${tactics.length} tactics, ${techniques.length} techniques`);
