#!/usr/bin/env bun
import { join, resolve } from 'node:path';
import dedent from 'dedent';
import { kProtocolVersionString } from './config';

type ServerType = 'primary' | 'secondary';

const serverType = process.argv[2] as ServerType;

if (serverType !== 'primary' && serverType !== 'secondary') {
  console.error('Usage: bun minecraft-server.ts [primary|secondary]');
  console.error('  primary  - Runs on port 25566 in primary/ directory');
  console.error('  secondary - Runs on port 25567 in secondary/ directory');
  process.exit(1);
}

const SERVER_PORT = serverType === 'primary' ? 25566 : 25567;
const WORK_DIR = join('minecraft-server', serverType);
const JAVA_DIR = join(WORK_DIR, 'java');

function getJavaExecutablePath(): string {
  if (process.platform === 'darwin') {
    return join(JAVA_DIR, 'jdk-21.0.2.jdk', 'Contents', 'Home', 'bin', 'java');
  } else if (process.platform === 'win32') {
    return join(JAVA_DIR, 'bin', 'java.exe');
  } else {
    return join(JAVA_DIR, 'bin', 'java');
  }
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`Downloading ${url} to ${outputPath}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await Bun.write(outputPath, buffer);
  console.log(`Downloaded ${outputPath}`);
}

async function extractTarGz(tarPath: string, extractDir: string): Promise<void> {
  console.log(`Extracting ${tarPath} to ${extractDir}...`);

  const proc = Bun.spawn(['tar', '-xzf', tarPath, '-C', extractDir, '--strip-components=1'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`tar extraction failed with code ${exitCode}`);
  }
}

async function downloadAndInstallJava(): Promise<void> {
  const javaExecutable = getJavaExecutablePath();
  const javaFile = Bun.file(javaExecutable);
  if (await javaFile.exists()) {
    console.log('Java already installed, skipping download.');
    return;
  }

  console.log('Java not found, downloading and installing...');

  await Bun.write(join(WORK_DIR, '.keep'), '');
  await Bun.write(join(JAVA_DIR, '.keep'), '');

  let javaUrl: string;
  let fileName: string;

  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      javaUrl = 'https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c558476027ac/13/GPL/openjdk-21.0.2_macos-aarch64_bin.tar.gz';
      fileName = 'openjdk-21.0.2_macos-aarch64_bin.tar.gz';
    } else {
      javaUrl = 'https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c558476027ac/13/GPL/openjdk-21.0.2_macos-x64_bin.tar.gz';
      fileName = 'openjdk-21.0.2_macos-x64_bin.tar.gz';
    }
  } else if (process.platform === 'linux') {
    if (process.arch === 'arm64') {
      javaUrl = 'https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c558476027ac/13/GPL/openjdk-21.0.2_linux-aarch64_bin.tar.gz';
      fileName = 'openjdk-21.0.2_linux-aarch64_bin.tar.gz';
    } else {
      javaUrl = 'https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c558476027ac/13/GPL/openjdk-21.0.2_linux-x64_bin.tar.gz';
      fileName = 'openjdk-21.0.2_linux-x64_bin.tar.gz';
    }
  } else if (process.platform === 'win32') {
    javaUrl = 'https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c558476027ac/13/GPL/openjdk-21.0.2_windows-x64_bin.zip';
    fileName = 'openjdk-21.0.2_windows-x64_bin.zip';
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  const javaArchivePath = join(WORK_DIR, fileName);

  try {
    await downloadFile(javaUrl, javaArchivePath);
    await extractTarGz(javaArchivePath, JAVA_DIR);

    await Bun.write(javaArchivePath, '');

    console.log('Java installation completed!');
  } catch (error) {
    console.error('Failed to install Java:', error);
    throw error;
  }
}

async function getMinecraftVersion(): Promise<string> {
  const pinnedVersion = kProtocolVersionString;

  console.log('Checking for Minecraft version updates...');

  try {
    const response = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    if (response.ok) {
      const manifest = (await response.json()) as any;
      const latestVersion = manifest.latest.release;

      if (latestVersion === pinnedVersion) {
        console.log(`Using Minecraft version ${pinnedVersion} (latest)`);
      } else {
        console.log(`Using Minecraft version ${pinnedVersion} (latest available: ${latestVersion})`);
      }
    }
  } catch {
    console.log(`Using Minecraft version ${pinnedVersion} (could not check for updates)`);
  }

  return pinnedVersion;
}

async function downloadMinecraftServer(version: string): Promise<string> {
  const serverJarPath = join(WORK_DIR, `minecraft-server-${version}.jar`);
  const serverFile = Bun.file(serverJarPath);

  if (await serverFile.exists()) {
    console.log(`Minecraft server ${version} already exists, skipping download.`);
    return serverJarPath;
  }

  console.log(`Downloading Minecraft server ${version}...`);

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
  console.log('EULA accepted.');
  const serverPropertiesPath = join(serverDir, 'server.properties');
  if (!(await Bun.file(serverPropertiesPath).exists())) {
    const serverProperties = dedent`
      online-mode=false
      network-compression-threshold=-1
      enforce-secure-profile=false
      server-port=${port}
    `;

    await Bun.write(serverPropertiesPath, serverProperties);
    console.log(`Server properties configured (offline mode, port ${port}).`);
  } else {
    console.log('Server properties already exist, skipping configuration.');
  }
}

async function startMinecraftServer(javaPath: string, serverJarPath: string, port: number): Promise<void> {
  const serverDir = WORK_DIR;

  await setupServerFiles(serverDir, port);

  console.log('Starting Minecraft server...');
  console.log('Press Ctrl+C to stop the server');

  const absoluteJavaPath = resolve(javaPath);
  const absoluteServerJarPath = resolve(serverJarPath);
  const absoluteServerDir = resolve(serverDir);

  console.log(`Java path: ${absoluteJavaPath}`);
  console.log(`Server jar: ${absoluteServerJarPath}`);
  console.log(`Working directory: ${absoluteServerDir}`);

  const isProduction = process.env.PRODUCTION === '1';
  const memorySize = isProduction ? '3G' : '1G';
  console.log(`Memory: ${memorySize} (${isProduction ? 'production' : 'development'})`);

  const serverProcess = Bun.spawn([absoluteJavaPath, `-Xmx${memorySize}`, `-Xms${memorySize}`, '-jar', absoluteServerJarPath, 'nogui'], {
    cwd: absoluteServerDir,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  let isShuttingDown = false;
  process.on('SIGINT', () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.log('\nShutting down Minecraft server...');
    serverProcess.kill('SIGINT');
  });

  const exitCode = await serverProcess.exited;
  console.log(`Minecraft server exited with code ${exitCode}`);
  process.exit(exitCode);
}

console.log(`Starting ${serverType} server on port ${SERVER_PORT}...`);

await downloadAndInstallJava();
const version = await getMinecraftVersion();
const serverJarPath = await downloadMinecraftServer(version);
const javaExecutable = getJavaExecutablePath();
await startMinecraftServer(javaExecutable, serverJarPath, SERVER_PORT);
