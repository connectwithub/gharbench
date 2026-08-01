/**
 * Run manifest.
 *
 * The manifest answers one question: "could someone else reproduce this
 * number?" Anything that could change a result and is not in the transcript
 * belongs here - model ids and versions, prompt hashes, the DB hash, seeds,
 * temperatures, package versions, the git commit, provider endpoints.
 *
 * A benchmark result without a manifest is an anecdote.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const MANIFEST_FILENAME = 'manifest.json';

export interface GitInfo {
  commit: string | null;
  branch: string | null;
  dirty: boolean | null;
}

export interface ModelEntry {
  role: 'buyer' | 'contestant' | 'judge';
  ref: string;
  provider: string;
  modelId: string;
  endpoint: string;
}

export interface PromptEntry {
  name: string;
  sha256: string;
}

export interface ScenarioEntry {
  scenarioId: string;
  version: string;
  seed: number;
  temperatures: { buyer: number; contestant: number };
  maxSteps: number;
  runs: number;
}

export interface RunManifest {
  runId: string;
  /** Wall clock. The only wall clock in a run artefact; simulated time lives in the transcript. */
  startedAt: string;
  harnessVersion: string;
  mode: 'offline' | 'live';
  git: GitInfo;
  node: { version: string; platform: string; arch: string };
  packages: Record<string, string>;
  models: ModelEntry[];
  prompts: PromptEntry[];
  db: { version: string; goldHash: string; path: string };
  scenarios: ScenarioEntry[];
  contestants: Array<{ id: string; version: string }>;
  buyers: Array<{ id: string; version: string }>;
  artefacts: { transcripts: string; costs: string };
  notes?: string[];
}

export function collectGitInfo(cwd: string = process.cwd()): GitInfo {
  const run = (args: string[]): string | null => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };

  const commit = run(['rev-parse', 'HEAD']);
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = run(['status', '--porcelain']);
  return { commit, branch, dirty: status === null ? null : status.length > 0 };
}

/** Resolved (installed) versions, not the semver ranges in package.json. */
export function collectPackageVersions(names: readonly string[]): Record<string, string> {
  const require = createRequire(import.meta.url);
  const out: Record<string, string> = {};
  for (const name of [...names].sort()) {
    try {
      const pkgPath = require.resolve(`${name}/package.json`);
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
      out[name] = pkg.version ?? 'unknown';
    } catch {
      out[name] = 'not-installed';
    }
  }
  return out;
}

export const TRACKED_PACKAGES = [
  'ai',
  '@ai-sdk/anthropic',
  '@ai-sdk/openai',
  '@ai-sdk/google',
  'zod',
] as const;

export function nodeInfo(): RunManifest['node'] {
  return { version: process.version, platform: process.platform, arch: process.arch };
}

export function writeManifest(runDir: string, manifest: RunManifest): string {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, MANIFEST_FILENAME);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * Run ids are wall-clock derived on purpose: they name a *run*, not a
 * simulation, and must sort chronologically in a directory listing.
 */
export function makeRunId(prefix: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${prefix}`;
}
