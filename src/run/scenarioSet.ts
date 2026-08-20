/**
 * Scenario-set loading and cross-validation.
 *
 * Scenarios live as one JSON file per persona-bound instance:
 *   data/scenarios/<scenarioId>.json      - the public split (committed)
 *   private-pool/scenarios/<id>.json      - the held-out split (never in git, G16)
 *
 * The private directory is optional by design: a fresh clone has no private
 * pool, and everything public must still load, validate and run without it.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadGoldDb, type RealEstateDb } from '../env/db.js';
import { loadScenarioConfig, type ScenarioConfig } from '../engine/scenario.js';
import { loadPersonaCard, type PersonaCard } from '../simulator/persona.js';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
export const PERSONAS_DIR = join(REPO_ROOT, 'data', 'personas');
export const PUBLIC_SCENARIOS_DIR = join(REPO_ROOT, 'data', 'scenarios');
export const PRIVATE_SCENARIOS_DIR = join(REPO_ROOT, 'private-pool', 'scenarios');
export const CORPUS_PATH = join(REPO_ROOT, 'data', 'corpus', 'project.json');

export interface ScenarioSet {
  scenarios: ScenarioConfig[];
  personas: Map<string, PersonaCard>;
  corpus: RealEstateDb;
  /** True when the private pool directory existed and was included. */
  privatePoolLoaded: boolean;
}

export function loadPersonas(dir: string = PERSONAS_DIR): Map<string, PersonaCard> {
  const personas = new Map<string, PersonaCard>();
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const card = loadPersonaCard(join(dir, file));
    personas.set(card.personaId, card);
  }
  return personas;
}

/** Load every scenario in a directory, enforcing filename = scenarioId. */
export function loadScenarioDir(dir: string): ScenarioConfig[] {
  const scenarios: ScenarioConfig[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const scenario = loadScenarioConfig(join(dir, file));
    const stem = file.replace(/\.json$/, '');
    if (scenario.scenarioId !== stem) {
      throw new Error(`Scenario file ${file} carries scenarioId "${scenario.scenarioId}"`);
    }
    scenarios.push(scenario);
  }
  return scenarios;
}

export function loadScenarioSet(options?: { includePrivate?: boolean }): ScenarioSet {
  const includePrivate = options?.includePrivate ?? true;
  const scenarios = loadScenarioDir(PUBLIC_SCENARIOS_DIR);
  const privateAvailable = includePrivate && existsSync(PRIVATE_SCENARIOS_DIR);
  if (privateAvailable) {
    scenarios.push(...loadScenarioDir(PRIVATE_SCENARIOS_DIR));
  }
  return {
    scenarios,
    personas: loadPersonas(),
    corpus: loadGoldDb(CORPUS_PATH),
    privatePoolLoaded: privateAvailable,
  };
}

/**
 * Referential integrity across the set. Returns human-readable problems;
 * an empty array means the set is internally consistent. The Phase 1 gate
 * validator treats any entry here as a hard failure.
 */
export function crossValidate(set: ScenarioSet): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenSeeds = new Map<number, string>();

  for (const s of set.scenarios) {
    const where = s.scenarioId;

    if (seenIds.has(s.scenarioId)) problems.push(`${where}: duplicate scenarioId`);
    seenIds.add(s.scenarioId);

    const prior = seenSeeds.get(s.seed);
    if (prior !== undefined) {
      problems.push(`${where}: seed ${s.seed} already used by ${prior}`);
    }
    seenSeeds.set(s.seed, s.scenarioId);

    if (s.dbVersion !== set.corpus.dbVersion) {
      problems.push(
        `${where}: targets dbVersion ${s.dbVersion} but the corpus is ${set.corpus.dbVersion}`,
      );
    }

    const persona = set.personas.get(s.personaId);
    if (persona === undefined) {
      problems.push(`${where}: persona ${s.personaId} does not exist`);
      continue;
    }

    const personaTraps = new Set(persona.hidden.traps.map((t) => t.id));
    for (const trapId of s.activeTrapIds) {
      if (!personaTraps.has(trapId)) {
        problems.push(`${where}: arms trap "${trapId}" which ${s.personaId} does not carry`);
      }
    }

    // A scenario id encodes its persona binding: <base>.<personaId>.
    const boundPersona = s.scenarioId.split('.').at(-1);
    if (boundPersona !== s.personaId) {
      problems.push(`${where}: id suffix "${boundPersona}" != personaId ${s.personaId}`);
    }
  }

  return problems;
}

/** Base situation id: `scn_cold_001.P01` -> `scn_cold_001`. */
export function baseScenarioId(scenarioId: string): string {
  const parts = scenarioId.split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : scenarioId;
}
