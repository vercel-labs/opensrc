#!/usr/bin/env node

import { existsSync, mkdirSync, chmodSync, createWriteStream, unlinkSync, writeFileSync, symlinkSync, lstatSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { platform, arch } from 'os';
import { get } from 'https';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const binDir = join(projectRoot, 'bin');

function isMusl() {
  if (platform() !== 'linux') return false;
  try {
    const result = execSync('ldd --version 2>&1 || true', { encoding: 'utf8' });
    return result.toLowerCase().includes('musl');
  } catch {
    return existsSync('/lib/ld-musl-x86_64.so.1') || existsSync('/lib/ld-musl-aarch64.so.1');
  }
}

const osKey = platform() === 'linux' && isMusl() ? 'linux-musl' : platform();
const platformKey = `${osKey}-${arch()}`;
const ext = platform() === 'win32' ? '.exe' : '';
const binaryName = `opensrc-${platformKey}${ext}`;
const binaryPath = join(binDir, binaryName);

const packageJson = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
);
const version = packageJson.version;

const GITHUB_REPO = 'vercel-labs/opensrc';
const DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${binaryName}`;
const CHECKSUMS_URL = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/CHECKSUMS.txt`;

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    function cleanup(err) {
      file.close();
      try { unlinkSync(dest); } catch {}
      reject(err);
    }

    const request = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        cleanup(new Error('Too many redirects'));
        return;
      }
      get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const location = response.headers.location;
          if (!location) {
            cleanup(new Error('Redirect with no Location header'));
            return;
          }
          const resolved = new URL(location, url).href;
          request(resolved, redirectCount + 1);
          return;
        }

        if (response.statusCode !== 200) {
          cleanup(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', cleanup);
    };

    request(url);
  });
}

async function downloadText(url) {
  return new Promise((resolve, reject) => {
    const request = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const location = response.headers.location;
          if (!location) {
            reject(new Error('Redirect with no Location header'));
            return;
          }
          request(new URL(location, url).href, redirectCount + 1);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(data));
      }).on('error', reject);
    };
    request(url);
  });
}

async function verifyChecksum(filePath, fileName) {
  try {
    const checksums = await downloadText(CHECKSUMS_URL);
    const line = checksums.split('\n').find((l) => l.includes(fileName));
    if (!line) {
      console.log('⚠ No checksum entry found for this binary, skipping verification');
      return true;
    }
    const expectedHash = line.split(/\s+/)[0];
    const fileBuffer = readFileSync(filePath);
    const actualHash = createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash !== expectedHash) {
      console.log(`✗ Checksum mismatch!`);
      console.log(`  Expected: ${expectedHash}`);
      console.log(`  Actual:   ${actualHash}`);
      return false;
    }
    console.log('✓ Checksum verified');
    return true;
  } catch (err) {
    console.log(`⚠ Could not verify checksum: ${err.message}`);
    return true;
  }
}

async function main() {
  if (existsSync(binaryPath)) {
    if (platform() !== 'win32') {
      chmodSync(binaryPath, 0o755);
    }
    console.log(`✓ Native binary ready: ${binaryName}`);
    await fixGlobalInstallBin();
    return;
  }

  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  console.log(`Downloading native binary for ${platformKey}...`);
  console.log(`URL: ${DOWNLOAD_URL}`);

  try {
    await downloadFile(DOWNLOAD_URL, binaryPath);

    const checksumValid = await verifyChecksum(binaryPath, binaryName);
    if (!checksumValid) {
      unlinkSync(binaryPath);
      console.log('Binary removed due to checksum mismatch.');
      console.log('This may indicate a corrupted download or a supply-chain issue.');
      console.log('');
      console.log('To build the native binary locally:');
      console.log('  1. Install Rust: https://rustup.rs');
      console.log('  2. Run: npm run build:native');
      await fixGlobalInstallBin();
      return;
    }

    if (platform() !== 'win32') {
      chmodSync(binaryPath, 0o755);
    }

    console.log(`✓ Downloaded native binary: ${binaryName}`);
  } catch (err) {
    console.log(`Could not download native binary: ${err.message}`);
    console.log('');
    console.log('To build the native binary locally:');
    console.log('  1. Install Rust: https://rustup.rs');
    console.log('  2. Run: npm run build:native');
  }

  await fixGlobalInstallBin();
}

async function fixGlobalInstallBin() {
  if (platform() === 'win32') {
    await fixWindowsShims();
  } else {
    await fixUnixSymlink();
  }
}

// Replaces npm's JS-wrapper symlink with a direct link to the native binary
// for zero-overhead startup. If npm later reinstalls, it will recreate its own
// symlink pointing at bin/opensrc.js, which still works (just slower).
async function fixUnixSymlink() {
  let npmBinDir;
  try {
    const prefix = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
    npmBinDir = join(prefix, 'bin');
  } catch {
    return;
  }

  const symlinkPath = join(npmBinDir, 'opensrc');

  try {
    const stat = lstatSync(symlinkPath);
    if (!stat.isSymbolicLink()) return;
  } catch {
    return;
  }

  try {
    unlinkSync(symlinkPath);
    symlinkSync(binaryPath, symlinkPath);
    console.log('✓ Optimized: symlink points to native binary (zero overhead)');
  } catch (err) {
    console.log(`⚠ Could not optimize symlink: ${err.message}`);
    console.log('  CLI will work via Node.js wrapper (slightly slower startup)');
  }
}

async function fixWindowsShims() {
  let npmBinDir;
  try {
    npmBinDir = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
  } catch {
    return;
  }

  const cmdShim = join(npmBinDir, 'opensrc.cmd');
  const ps1Shim = join(npmBinDir, 'opensrc.ps1');

  if (!existsSync(cmdShim)) return;

  const cpuArch = arch() === 'arm64' ? 'arm64' : 'x64';
  const relativeBinaryPath = `node_modules\\opensrc\\bin\\opensrc-win32-${cpuArch}.exe`;
  const absoluteBinaryPath = join(npmBinDir, relativeBinaryPath);

  if (!existsSync(absoluteBinaryPath)) return;

  try {
    const cmdContent = `@ECHO off\r\n"%~dp0${relativeBinaryPath}" %*\r\n`;
    writeFileSync(cmdShim, cmdContent);

    const ps1Content = `#!/usr/bin/env pwsh\r\n$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent\r\n& "$basedir\\${relativeBinaryPath}" $args\r\nexit $LASTEXITCODE\r\n`;
    writeFileSync(ps1Shim, ps1Content);

    console.log('✓ Optimized: shims point to native binary (zero overhead)');
  } catch (err) {
    console.log(`⚠ Could not optimize shims: ${err.message}`);
    console.log('  CLI will work via Node.js wrapper (slightly slower startup)');
  }
}

main().catch(console.error);
