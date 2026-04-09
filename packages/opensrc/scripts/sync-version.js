#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const cliDir = join(rootDir, 'cli');

const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;

console.log(`Syncing version ${version} to all config files...`);

const cargoTomlPath = join(cliDir, 'Cargo.toml');
let cargoToml = readFileSync(cargoTomlPath, 'utf-8');
const cargoVersionRegex = /^version\s*=\s*"[^"]*"/m;
const newCargoVersion = `version = "${version}"`;

let cargoTomlUpdated = false;
if (cargoVersionRegex.test(cargoToml)) {
  const oldMatch = cargoToml.match(cargoVersionRegex)?.[0];
  if (oldMatch !== newCargoVersion) {
    cargoToml = cargoToml.replace(cargoVersionRegex, newCargoVersion);
    writeFileSync(cargoTomlPath, cargoToml);
    console.log(`  Updated cli/Cargo.toml: ${oldMatch} -> ${newCargoVersion}`);
    cargoTomlUpdated = true;
  } else {
    console.log(`  cli/Cargo.toml already up to date`);
  }
} else {
  console.error('  Could not find version field in cli/Cargo.toml');
  process.exit(1);
}

if (cargoTomlUpdated) {
  try {
    execSync('cargo update -p opensrc --offline', { cwd: cliDir, stdio: 'pipe' });
    console.log(`  Updated cli/Cargo.lock`);
  } catch {
    try {
      execSync('cargo update -p opensrc', { cwd: cliDir, stdio: 'pipe' });
      console.log(`  Updated cli/Cargo.lock`);
    } catch (e) {
      console.error(`  Warning: Could not update Cargo.lock: ${e.message}`);
    }
  }
}

console.log('Version sync complete.');
