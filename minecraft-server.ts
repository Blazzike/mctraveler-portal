#!/usr/bin/env bun
import { join, resolve } from 'node:path';
import dedent from 'dedent';
import { kIsProduction, kProtocolVersionString, kSecondaryPort } from './config';
import { log } from './logging';

type ServerType = 'primary' | 'secondary';

const serverType = process.argv[2] as ServerType;

if (serverType !== 'primary' && serverType !== 'secondary') {
  log.for('MCServer').error('Usage: bun minecraft-server.ts [primary|secondary]');
  log.for('MCServer').error('  primary  - Runs on port 25566 in primary/ directory');
  log.for('MCServer').error('  secondary - Runs on port 25567 in secondary/ directory');
  process.exit(1);
}

const SERVER_PORT = serverType === 'primary' ? 25566 : 25567;
const WORK_DIR = join('minecraft-server', serverType);
const JAVA_DIR = join(WORK_DIR, 'java');

function getJavaExecutablePath(): string {
  if (process.platform === 'darwin') {
    return join(JAVA_DIR, 'jdk-25.0.2.jdk', 'Contents', 'Home', 'bin', 'java');
  } else if (process.platform === 'win32') {
    return join(JAVA_DIR, 'bin', 'java.exe');
  } else {
    return join(JAVA_DIR, 'bin', 'java');
  }
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  log.for('MCServer').info('Downloading %s to %s...', url, outputPath);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await Bun.write(outputPath, buffer);
  log.for('MCServer').info('Downloaded %s', outputPath);
}

async function extractTarGz(tarPath: string, extractDir: string): Promise<void> {
  log.for('MCServer').info('Extracting %s to %s...', tarPath, extractDir);

  const proc = Bun.spawn(['tar', '-xzf', tarPath, '-C', extractDir, '--strip-components=1'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`tar extraction failed with code ${exitCode}`);
  }
}

async function extractZip(zipPath: string, extractDir: string): Promise<void> {
  log.for('MCServer').info('Extracting %s to %s...', zipPath, extractDir);

  const proc = Bun.spawn(['tar', '-xf', zipPath, '-C', extractDir, '--strip-components=1'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`zip extraction failed with code ${exitCode}`);
  }
}

async function downloadAndInstallJava(): Promise<void> {
  const javaExecutable = getJavaExecutablePath();
  const javaFile = Bun.file(javaExecutable);
  if (await javaFile.exists()) {
    log.for('MCServer').info('Java already installed, skipping download.');
    return;
  }

  log.for('MCServer').info('Java not found, downloading and installing...');

  await Bun.write(join(WORK_DIR, '.keep'), '');
  await Bun.write(join(JAVA_DIR, '.keep'), '');

  let javaUrl: string;
  let fileName: string;

  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      javaUrl = 'https://download.java.net/java/GA/jdk25.0.2/b1e0dfa218384cb9959bdcb897162d4e/10/GPL/openjdk-25.0.2_macos-aarch64_bin.tar.gz';
      fileName = 'openjdk-25.0.2_macos-aarch64_bin.tar.gz';
    } else {
      javaUrl = 'https://download.java.net/java/GA/jdk25.0.2/b1e0dfa218384cb9959bdcb897162d4e/10/GPL/openjdk-25.0.2_macos-x64_bin.tar.gz';
      fileName = 'openjdk-25.0.2_macos-x64_bin.tar.gz';
    }
  } else if (process.platform === 'linux') {
    if (process.arch === 'arm64') {
      javaUrl = 'https://download.java.net/java/GA/jdk25.0.2/b1e0dfa218384cb9959bdcb897162d4e/10/GPL/openjdk-25.0.2_linux-aarch64_bin.tar.gz';
      fileName = 'openjdk-25.0.2_linux-aarch64_bin.tar.gz';
    } else {
      javaUrl = 'https://download.java.net/java/GA/jdk25.0.2/b1e0dfa218384cb9959bdcb897162d4e/10/GPL/openjdk-25.0.2_linux-x64_bin.tar.gz';
      fileName = 'openjdk-25.0.2_linux-x64_bin.tar.gz';
    }
  } else if (process.platform === 'win32') {
    javaUrl = 'https://download.java.net/java/GA/jdk25.0.2/b1e0dfa218384cb9959bdcb897162d4e/10/GPL/openjdk-25.0.2_windows-x64_bin.zip';
    fileName = 'openjdk-25.0.2_windows-x64_bin.zip';
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  const javaArchivePath = join(WORK_DIR, fileName);

  try {
    await downloadFile(javaUrl, javaArchivePath);
    if (process.platform === 'win32') {
      await extractZip(javaArchivePath, JAVA_DIR);
    } else {
      await extractTarGz(javaArchivePath, JAVA_DIR);
    }

    await Bun.write(javaArchivePath, '');

    log.for('MCServer').info('Java installation completed!');
  } catch (error) {
    log.for('MCServer').error('Failed to install Java: %s', error);
    throw error;
  }
}

async function getMinecraftVersion(): Promise<string> {
  const pinnedVersion = kProtocolVersionString;

  log.for('MCServer').info('Checking for Minecraft version updates...');

  try {
    const response = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    if (response.ok) {
      const manifest = (await response.json()) as any;
      const latestVersion = manifest.latest.release;

      if (latestVersion === pinnedVersion) {
        log.for('MCServer').info('Using Minecraft version %s (latest)', pinnedVersion);
      } else {
        log.for('MCServer').info('Using Minecraft version %s (latest available: %s)', pinnedVersion, latestVersion);
      }
    }
  } catch {
    log.for('MCServer').info('Using Minecraft version %s (could not check for updates)', pinnedVersion);
  }

  return pinnedVersion;
}

async function downloadMinecraftServer(version: string): Promise<string> {
  const serverJarPath = join(WORK_DIR, `minecraft-server-${version}.jar`);
  const serverFile = Bun.file(serverJarPath);

  if (await serverFile.exists()) {
    log.for('MCServer').info('Minecraft server %s already exists, skipping download.', version);
    return serverJarPath;
  }

  log.for('MCServer').info('Downloading Minecraft server %s...', version);

  const manifestResponse = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
  const manifest = (await manifestResponse.json()) as any;

  const versionInfo = manifest.versions.find((v: any) => v.id === version);
  if (!versionInfo) {
    throw new Error(`Version ${version} not found`);
  }

  const versionResponse = await fetch(versionInfo.url);
  const versionData = (await versionResponse.json()) as any;

  const serverUrl = versionData.downloads.server.url;

  await downloadFile(serverUrl, serverJarPath);

  return serverJarPath;
}

async function setupServerFiles(serverDir: string, port: number): Promise<void> {
  const eulaPath = join(serverDir, 'eula.txt');
  await Bun.write(eulaPath, 'eula=true\n');
  log.for('MCServer').info('EULA accepted.');
  const serverPropertiesPath = join(serverDir, 'server.properties');
  if (!(await Bun.file(serverPropertiesPath).exists())) {
    const serverProperties = dedent`
      online-mode=false
      network-compression-threshold=-1
      enforce-secure-profile=false
      server-port=${port}
      level-name=${port === kSecondaryPort ? 'last' : 'world'}
    `;

    await Bun.write(serverPropertiesPath, serverProperties);
    log.for('MCServer').info('Server properties configured (offline mode, port %d).', port);
  } else {
    log.for('MCServer').info('Server properties already exist, skipping configuration.');
  }
}

async function startMinecraftServer(javaPath: string, serverJarPath: string, port: number): Promise<number> {
  const serverDir = WORK_DIR;

  await setupServerFiles(serverDir, port);

  log.for('MCServer').info('Starting Minecraft server...');
  log.for('MCServer').info('Press Ctrl+C to stop the server');

  const absoluteJavaPath = resolve(javaPath);
  const absoluteServerJarPath = resolve(serverJarPath);
  const absoluteServerDir = resolve(serverDir);

  log.for('MCServer').info('Java path: %s', absoluteJavaPath);
  log.for('MCServer').info('Server jar: %s', absoluteServerJarPath);
  log.for('MCServer').info('Working directory: %s', absoluteServerDir);

  const memorySize = '8G';
  log.for('MCServer').info('Memory: %s (Mode: %s)', memorySize, kIsProduction ? 'production' : 'development');

  const serverProcess = Bun.spawn(
    [
      absoluteJavaPath,
      `-Xmx${memorySize}`,
      `-Xms${memorySize}`,
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:+AlwaysPreTouch',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',
      '-jar',
      absoluteServerJarPath,
      'nogui',
    ],
    {
      cwd: absoluteServerDir,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }
  );

  let isShuttingDown = false;
  const sigintHandler = () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    log.for('MCServer').info('Shutting down Minecraft server...');
    serverProcess.kill('SIGINT');
  };

  process.on('SIGINT', sigintHandler);

  const exitCode = await serverProcess.exited;
  process.off('SIGINT', sigintHandler);
  log.for('MCServer').info('Minecraft server exited with code %d', exitCode);
  return exitCode;
}

log.for('MCServer').info('Starting %s server on port %d...', serverType, SERVER_PORT);

await downloadAndInstallJava();
const version = await getMinecraftVersion();
const serverJarPath = await downloadMinecraftServer(version);
const javaExecutable = getJavaExecutablePath();

const MAX_RETRIES = 3;
let retryCount = 0;
const SUCCESS_THRESHOLD_MS = 60000; // 1 minute

while (retryCount < MAX_RETRIES) {
  const startTime = Date.now();
  const exitCode = await startMinecraftServer(javaExecutable, serverJarPath, SERVER_PORT);

  const duration = Date.now() - startTime;

  // If the server was up for more than the threshold, we consider it a successful run
  // and reset the retry count.
  if (duration > SUCCESS_THRESHOLD_MS) {
    log.for('MCServer').info('Server was running for a while, resetting retry count.');
    retryCount = 0;
  }

  // If it was a clean exit (SIGINT/Ctrl+C usually leads to exit code 130 or 0), don't retry
  if (exitCode === 0 || exitCode === 130) {
    log.for('MCServer').info('Server stopped normally.');
    process.exit(0);
  }

  retryCount++;
  if (retryCount < MAX_RETRIES) {
    log.for('MCServer').info('Server crashed! Retrying (%d/%d) in 5 seconds...', retryCount, MAX_RETRIES);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } else {
    log.for('MCServer').error('Server crashed %d times. Giving up.', MAX_RETRIES);
    process.exit(exitCode);
  }
}
