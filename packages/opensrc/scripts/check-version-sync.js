#!/usr/bin/env node

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const cliDir = join(rootDir, 'cli');

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const expectedVersion = packageJson.version;

const cargoToml = readFileSync(join(cliDir, 'Cargo.toml'), 'utf-8');
const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]*)"/m);

if (!cargoMatch) {
  console.error('Could not find version field in cli/Cargo.toml');
  process.exit(1);
}

const cargoVersion = cargoMatch[1];
let errors = 0;

if (cargoVersion !== expectedVersion) {
  console.error(`Version mismatch: package.json=${expectedVersion}, cli/Cargo.toml=${cargoVersion}`);
  errors++;
}

if (errors > 0) {
  console.error(`\nRun "pnpm run version:sync" in packages/opensrc to fix.`);
  process.exit(1);
}

console.log(`Versions in sync: ${expectedVersion}`);
