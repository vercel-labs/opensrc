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
const newCargoVersion = `version = "${version}"`;

const packageSectionMatch = cargoToml.match(/\[package\]([\s\S]*?)(?=\n\[|$)/);
if (!packageSectionMatch) {
  console.error('  Could not find [package] section in cli/Cargo.toml');
  process.exit(1);
}

const versionInSection = packageSectionMatch[1].match(/^version\s*=\s*"[^"]*"/m);

let cargoTomlUpdated = false;
if (versionInSection) {
  const oldMatch = versionInSection[0];
  if (oldMatch !== newCargoVersion) {
    cargoToml = cargoToml.replace(oldMatch, newCargoVersion);
    writeFileSync(cargoTomlPath, cargoToml);
    console.log(`  Updated cli/Cargo.toml: ${oldMatch} -> ${newCargoVersion}`);
    cargoTomlUpdated = true;
  } else {
    console.log(`  cli/Cargo.toml already up to date`);
  }
} else {
  console.error('  Could not find version field in [package] section of cli/Cargo.toml');
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
