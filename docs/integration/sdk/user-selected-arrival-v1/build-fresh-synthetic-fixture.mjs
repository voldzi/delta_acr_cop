import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// This generator accepts only the repository's explicitly synthetic fixture.
// It cannot renew a production or joint-acceptance proof.
const output = process.argv[2];
if (!output || process.argv.length !== 3) throw new Error('Pass one new output JSON path');
const source = fileURLToPath(new URL('../../../api/examples/user-selected-arrival-v1.fixture.json', import.meta.url));
const fixture = JSON.parse(readFileSync(source, 'utf8'));
if (fixture.fixtureKind !== 'synthetic_contract_not_live_route' || fixture.response.coverage.routingDataset.version !== 'synthetic-contract-graph') throw new Error('SYNTHETIC_SOURCE_REQUIRED');
const now = Date.now();
const iso = offset => new Date(now + offset).toISOString();
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
fixture.validationNow = iso(0);
fixture.response.generatedAt = iso(0);
const dataset = { version: 'synthetic-contract-graph', builtAt: iso(-3600000) };
fixture.response.coverage.routingDataset = dataset;
for (const route of fixture.response.routes) {
  if (!route.routeId.startsWith('synthetic-arrival-')) throw new Error('SYNTHETIC_ROUTE_REQUIRED');
  route.knownClosures.observedAt = iso(-1000);
  route.knownClosures.validUntil = iso(300000);
  route.knownClosures.routingDataset = dataset;
  route.knownClosures.requestHash = hash(fixture.response.query);
  route.knownClosures.geometryHash = hash(route.geometry);
  route.arrival.routingDataset = dataset;
  route.arrival.validUntil = route.knownClosures.validUntil;
  route.arrival.requestHash = route.knownClosures.requestHash;
  route.arrival.geometryHash = route.knownClosures.geometryHash;
  const feature = fixture.response.features.find(item => item.properties.routeId === route.routeId);
  if (!feature) throw new Error('SYNTHETIC_FEATURE_REQUIRED');
  feature.properties.knownClosures = structuredClone(route.knownClosures);
  feature.properties.arrival = structuredClone(route.arrival);
}
writeFileSync(output, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ fixtureKind: fixture.fixtureKind, validationNow: fixture.validationNow, validUntil: iso(300000), productionAcceptance: false }));
