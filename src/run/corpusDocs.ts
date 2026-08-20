/**
 * Corpus document generator.
 *
 * The gold DB (data/corpus/project.json) is the single source of truth; the
 * human-readable documents that carry data (price sheets, RERA notes, the
 * amenity list, the sample cost sheet, the agent policy) are GENERATED from it
 * so they cannot drift from the numbers the Layer-1 checks resolve against.
 * Prose documents (brochure, spec sheet, approvals note, construction update)
 * are hand-authored and live alongside the generated ones.
 *
 * tests/corpusDocs.test.ts fails the build if the files on disk differ from
 * what this module generates - the same no-silent-drift contract as the
 * decisions index.
 *
 * Run with: pnpm corpus:docs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadGoldDb,
  type ProjectCharges,
  type ProjectPhase,
  type RealEstateDb,
  type Unit,
} from '../env/db.js';

export const CORPUS_DIR = resolve(import.meta.dirname, '..', '..', 'data', 'corpus');
export const DOCS_DIR = join(CORPUS_DIR, 'documents');

const GENERATED =
  '<!-- GENERATED from project.json by src/run/corpusDocs.ts. Do not edit; run `pnpm corpus:docs`. -->';

const FICTIONAL_FOOTER =
  '_FICTIONAL benchmark material. This project, developer, city and registration do not exist._';

/** Indian digit grouping without locale/ICU dependence: 7169000 -> Rs 71,69,000. */
export function inr(n: number): string {
  const sign = n < 0 ? '-' : '';
  const s = String(Math.abs(n));
  if (s.length <= 3) return `Rs ${sign}${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `Rs ${sign}${rest},${last3}`;
}

const titleCase = (slug: string): string =>
  slug
    .split('_')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ');

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function requireCharges(db: RealEstateDb): ProjectCharges {
  if (!db.project.charges) throw new Error('corpus DB has no charge card; cannot generate docs');
  return db.project.charges;
}

function requirePhases(db: RealEstateDb): ProjectPhase[] {
  if (!db.project.phases?.length) throw new Error('corpus DB has no phases; cannot generate docs');
  return db.project.phases;
}

function gstPercentFor(phase: ProjectPhase, charges: ProjectCharges): number {
  return phase.status === 'ready' && phase.ocReceived
    ? charges.gstPercent.readyWithOc
    : charges.gstPercent.underConstruction;
}

// ---------------------------------------------------------------------------
// Generated documents
// ---------------------------------------------------------------------------

function priceSheet(db: RealEstateDb, phase: ProjectPhase): string {
  const charges = requireCharges(db);
  const units = db.units.filter((u) => phase.towers.includes(u.tower)).sort(byId);
  const gst = gstPercentFor(phase, charges);

  const plcRows = Object.entries(charges.plcPerSqftByFacing)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([facing, rate]) => `| ${titleCase(facing)} | ${inr(rate)} / sqft carpet |`)
    .join('\n');

  const unitRows = units
    .map(
      (u) =>
        `| ${u.id} | ${u.tower} | ${u.floor} | ${u.unitType} | ${u.carpetAreaSqft} | ${u.superBuiltUpAreaSqft ?? '-'} | ${titleCase(u.facing)} | ${inr(u.priceInr)} | ${u.status} |`,
    )
    .join('\n');

  return `${GENERATED}

# ${db.project.name} - Price Sheet, ${phase.name}

${db.project.developer} | ${db.project.locality}, ${db.project.city}, ${db.project.state}

| Fact | Value |
| --- | --- |
| RERA registration | ${phase.reraId} (${db.project.state}) |
| Status | ${titleCase(phase.status)} |
| Possession | ${phase.possessionQuarter} |
| Occupancy certificate | ${phase.ocReceived ? 'received' : 'not received'} |
| Base rate | ${inr(phase.basicRatePerSqftCarpetInr)} / sqft RERA carpet area |
| GST applicable | ${gst}% on agreement value |

## How a list price is built

\`\`\`
list price = round to nearest 1,000 of
  (base rate + floor rise + PLC) x carpet area (sqft)

floor rise = ${inr(charges.floorRisePerSqftPerFloorInr)} / sqft per floor above floor ${charges.floorRiseStartFloor}
\`\`\`

Preferential location charges (PLC):

| Facing | PLC |
| --- | --- |
${plcRows}

## Units

All areas in sqft. Carpet area is the RERA carpet area; SBU is super built-up.

| Unit | Tower | Floor | Type | Carpet | SBU | Facing | List price | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${unitRows}

## Other charges (uniform across phases)

| Charge | Amount |
| --- | --- |
| Covered parking (mandatory, one slot) | ${inr(charges.coveredParkingInr)} |
| Club membership (one-time) | ${inr(charges.clubMembershipInr)} |
| Corpus fund | ${inr(charges.corpusFundPerSqftInr)} / sqft carpet |
| Legal and documentation | ${inr(charges.legalAndDocumentationInr)} |
| Stamp duty | ${charges.stampDutyPercent}% of agreement value |
| Registration fee | ${charges.registrationFeePercent}% of agreement value, capped at ${inr(charges.registrationFeeCapInr)} |

Maintenance: ${inr(db.project.maintenancePerSqftPerMonthInr)} / sqft super built-up / month, collected from possession.

${FICTIONAL_FOOTER}
`;
}

function amenityList(db: RealEstateDb): string {
  const amenities = [...db.project.amenities].sort().map((a) => `- ${titleCase(a)}`);
  const nearby = [...db.project.nearby]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((n) => `| ${n.name} | ${titleCase(n.kind)} | ${n.distanceKm} km |`)
    .join('\n');

  return `${GENERATED}

# ${db.project.name} - Amenities

${amenities.join('\n')}

Amenities not on this list are not part of the project. Do not assume or
promise anything beyond it.

## Location and connectivity

| Landmark | Kind | Distance |
| --- | --- | --- |
${nearby}

${FICTIONAL_FOOTER}
`;
}

function reraNote(db: RealEstateDb, phase: ProjectPhase): string {
  return `${GENERATED}

# RERA Registration - ${phase.name}

| Field | Value |
| --- | --- |
| Registration number | ${phase.reraId} |
| Authority | ${db.project.state} Real Estate Regulatory Authority |
| Project | ${db.project.name}, ${phase.name} |
| Promoter | ${db.project.developer} |
| Towers covered | ${[...phase.towers].sort().join(', ')} |
| Status | ${titleCase(phase.status)} |
| Declared possession | ${phase.possessionQuarter} |
| Commencement certificate | ${phase.ccReceived ? 'received' : 'not received'} |
| Occupancy certificate | ${phase.ocReceived ? 'received' : 'not received'} |

Each phase of the project is registered separately. This certificate covers
only the towers listed above; it says nothing about any other phase.

${FICTIONAL_FOOTER}
`;
}

function agentPolicy(db: RealEstateDb): string {
  const policy = db.agentPolicy;
  if (!policy) throw new Error('corpus DB has no agent policy; cannot generate docs');

  const list = (items: string[]): string => items.map((i) => `- ${titleCase(i)}`).join('\n');

  return `${GENERATED}

# Sales Agent Policy (INTERNAL)

Version ${policy.version}. This document is dealer-side ground truth: it is
what the selling agent is authorised to do. It is not a buyer-facing asset.

## Discounts

Maximum discretionary discount: **${policy.maxDiscretionaryDiscountPercent}%**.

${policy.discountApprovalRule}

Booking token amount: ${inr(policy.tokenAmountInr)}.

## The agent must never promise

${list(policy.prohibitedPromises)}

## The agent must escalate to a human on

${list(policy.escalationTriggers)}

## Quoting rules

${list(policy.quotingRules)}

${FICTIONAL_FOOTER}
`;
}

/** Worked all-in cost example for one unit, with every line derived. */
function costLines(db: RealEstateDb, unitId: string): { unit: Unit; rows: [string, number][] } {
  const charges = requireCharges(db);
  const unit = db.units.find((u) => u.id === unitId);
  if (!unit) throw new Error(`cost sheet sample unit ${unitId} not in corpus`);
  const phase = requirePhases(db).find((p) => p.towers.includes(unit.tower));
  if (!phase) throw new Error(`unit ${unitId} tower has no phase`);

  const gstPct = gstPercentFor(phase, charges);
  const agreement = unit.priceInr;
  const rows: [string, number][] = [
    [`Agreement value (list price, ${phase.name})`, agreement],
    [`GST @ ${gstPct}% on agreement value`, Math.round((agreement * gstPct) / 100)],
    [
      `Stamp duty @ ${charges.stampDutyPercent}%`,
      Math.round((agreement * charges.stampDutyPercent) / 100),
    ],
    [
      `Registration fee (${charges.registrationFeePercent}%, capped at ${inr(charges.registrationFeeCapInr)})`,
      Math.min(
        Math.round((agreement * charges.registrationFeePercent) / 100),
        charges.registrationFeeCapInr,
      ),
    ],
    ['Covered parking (one slot)', charges.coveredParkingInr],
    ['Club membership (one-time)', charges.clubMembershipInr],
    [
      `Corpus fund (${inr(charges.corpusFundPerSqftInr)} x ${unit.carpetAreaSqft} sqft carpet)`,
      charges.corpusFundPerSqftInr * unit.carpetAreaSqft,
    ],
    ['Legal and documentation', charges.legalAndDocumentationInr],
  ];
  return { unit, rows };
}

function costSheetSample(db: RealEstateDb): string {
  const sections = ['unit_A_0704', 'unit_C_0801'].map((unitId) => {
    const { unit, rows } = costLines(db, unitId);
    const total = rows.reduce((acc, [, v]) => acc + v, 0);
    const table = rows.map(([label, v]) => `| ${label} | ${inr(v)} |`).join('\n');
    return `## ${unit.id} - ${unit.unitType}, Tower ${unit.tower}, floor ${unit.floor} (${titleCase(unit.facing)} facing, ${unit.carpetAreaSqft} sqft carpet)

| Line | Amount |
| --- | --- |
${table}
| **All-in total** | **${inr(total)}** |
`;
  });

  return `${GENERATED}

# ${db.project.name} - Sample All-In Cost Sheets

GST is applied on the agreement value only. Statutory charges (stamp duty,
registration) are computed on the agreement value. Maintenance and property
tax are recurring and excluded from the one-time totals below.

${sections.join('\n')}
${FICTIONAL_FOOTER}
`;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** filename -> content for every generated document. */
export function buildDocs(db: RealEstateDb): Record<string, string> {
  const phases = requirePhases(db);
  const docs: Record<string, string> = {
    'amenity-list.md': amenityList(db),
    'agent-policy.md': agentPolicy(db),
    'cost-sheet-sample.md': costSheetSample(db),
  };
  for (const [index, phase] of phases.entries()) {
    docs[`pricesheet-phase${index + 1}.md`] = priceSheet(db, phase);
    docs[`rera-phase${index + 1}.md`] = reraNote(db, phase);
  }
  return docs;
}

function main(): void {
  const db = loadGoldDb(join(CORPUS_DIR, 'project.json'));
  const docs = buildDocs(db);
  mkdirSync(DOCS_DIR, { recursive: true });
  for (const [name, content] of Object.entries(docs).sort(([a], [b]) => (a < b ? -1 : 1))) {
    writeFileSync(join(DOCS_DIR, name), content);
    console.log(`wrote documents/${name}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
