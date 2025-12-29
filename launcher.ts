#!/usr/bin/env bun
import blessed from 'blessed';
import { type Subprocess, spawn } from 'bun';
import { kIsProduction } from './config';
import { $ } from 'bun';

const screen = blessed.screen({
  smartCSR: true,
  title: 'MCTraveler Portal Launcher',
  fullUnicode: true,
});

const processes: Map<string, Subprocess> = new Map();
let isShuttingDown = false;
let _hasError = false;
let focusedPane: 'primary' | 'secondary' | 'proxy' = 'primary';

function killAllProcesses() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  for (const [name, proc] of processes.entries()) {
    try {
      if ((name === 'primary' || name === 'secondary') && proc.stdin && typeof proc.stdin !== 'number') {
        (proc.stdin as { write: (data: string) => void }).write('stop\n');
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      // Process may already be dead
    }
  }

  setTimeout(() => {
    for (const proc of processes.values()) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Already stopped
      }
    }
  }, 3000);

  setTimeout(() => {
    for (const proc of processes.values()) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Force kill if still running
      }
    }
  }, 8000);
}

const primaryBox = blessed.box({
  parent: screen,
  label: ' Primary Server (25566) - 1 ',
  border: { type: 'line', fg: 'cyan' as any },
  style: {
    fg: 'white',
    border: { fg: 'cyan' },
    focus: { border: { fg: 'green' } },
  },
  top: 0,
  left: 0,
  width: '50%' as any,
  height: '50%-1' as any,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: ' ',
    track: { bg: 'grey' },
    style: { inverse: true },
  },
  keys: true,
  vi: true,
  mouse: true,
  tags: true,
});

primaryBox.on('click', () => {
  focusedPane = 'primary';
  primaryBox.focus();
  screen.render();
});

const secondaryBox = blessed.box({
  parent: screen,
  label: ' Secondary Server (25567) - 2 ',
  border: { type: 'line', fg: 'cyan' as any },
  style: {
    fg: 'white',
    border: { fg: 'cyan' },
    focus: { border: { fg: 'green' } },
  },
  top: 0,
  left: '50%' as any,
  width: '50%' as any,
  height: '50%-1' as any,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: ' ',
    track: { bg: 'grey' },
    style: { inverse: true },
  },
  keys: true,
  vi: true,
  mouse: true,
  tags: true,
});

secondaryBox.on('click', () => {
  focusedPane = 'secondary';
  secondaryBox.focus();
  screen.render();
});

const proxyBox = blessed.box({
  parent: screen,
  label: ' Proxy Server - 3 ',
  border: { type: 'line', fg: 'cyan' as any },
  style: {
    fg: 'white',
    border: { fg: 'cyan' },
    focus: { border: { fg: 'green' } },
  },
  top: '50%' as any,
  left: 0,
  width: '100%' as any,
  height: '50%-1' as any,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: {
    ch: ' ',
    track: { bg: 'grey' },
    style: { inverse: true },
  },
  keys: true,
  vi: true,
  mouse: true,
  tags: true,
});

proxyBox.on('click', () => {
  focusedPane = 'proxy';
  proxyBox.focus();
  screen.render();
});

const inputBox = blessed.textbox({
  parent: screen,
  bottom: 1,
  left: 0,
  width: '100%' as unknown as number,
  height: 1,
  hidden: true,
  style: {
    fg: 'white',
    bg: 'blue',
  },
  inputOnFocus: true,
});

const helpBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%' as unknown as number,
  height: 1,
  style: {
    fg: 'black',
    bg: 'white',
  },
  content: ' 1: Primary | 2: Secondary | 3: Proxy | I: Send Command | Q/Ctrl+C: Quit | ↑↓: Scroll ',
  tags: true,
});

screen.key(['q', 'C-c'], () => {
  if (!isShuttingDown) {
    appendToBox(primaryBox, '{yellow-fg}Sending shutdown signal...{/yellow-fg}');
    appendToBox(secondaryBox, '{yellow-fg}Sending shutdown signal...{/yellow-fg}');
    appendToBox(proxyBox, '{yellow-fg}Sending shutdown signal...{/yellow-fg}');
    helpBar.setContent(' {yellow-fg}Stopping all services... Press Q again to close UI{/yellow-fg} ');
    screen.render();
    killAllProcesses();
  } else {
    screen.destroy();
    process.exit(0);
  }
});

screen.key(['1'], () => {
  focusedPane = 'primary';
  primaryBox.focus();
  screen.render();
});

screen.key(['2'], () => {
  focusedPane = 'secondary';
  secondaryBox.focus();
  screen.render();
});

screen.key(['3'], () => {
  focusedPane = 'proxy';
  proxyBox.focus();
  screen.render();
});

screen.key(['i'], () => {
  inputBox.clearValue();
  inputBox.show();
  inputBox.focus();
  screen.render();
});

inputBox.on('submit', (value: string) => {
  inputBox.hide();

  const proc = processes.get(focusedPane);
  if (proc?.stdin && typeof proc.stdin !== 'number') {
    (proc.stdin as { write: (data: string) => void }).write(`${value}\n`);
  }

  const boxMap = { primary: primaryBox, secondary: secondaryBox, proxy: proxyBox };
  const box = boxMap[focusedPane];
  appendToBox(box, `{blue-fg}> ${value}{/blue-fg}`);
  box.focus();
  screen.render();
});

inputBox.on('cancel', () => {
  inputBox.hide();
  const boxMap = { primary: primaryBox, secondary: secondaryBox, proxy: proxyBox };
  boxMap[focusedPane].focus();
  screen.render();
});

screen.key(['escape'], () => {
  if (!inputBox.hidden) {
    inputBox.cancel();
  }
});

function appendToBox(box: blessed.Widgets.BoxElement, text: string) {
  box.pushLine(text.replace(/\n$/, ''));
  box.setScrollPerc(100);
  screen.render();
}

async function startProcess(
  command: string,
  args: string[],
  box: blessed.Widgets.BoxElement,
  name: string,
  cwd?: string,
  env?: Record<string, string>
) {
  const proc = spawn([command, ...args], {
    cwd: cwd || process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
    env: { ...process.env, ...env },
  });

  const processKey = name.toLowerCase().split(' ')[0] || name.toLowerCase();
  processes.set(processKey, proc);

  appendToBox(box, `Starting ${name}...`);

  const processOutput = async (stream: ReadableStream<Uint8Array>, isError: boolean) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.trim()) {
            const prefix = isError ? '{red-fg}[ERROR]{/red-fg} ' : '';
            appendToBox(box, prefix + line);
          }
        }
      }
    } catch (e) {
      if (!isShuttingDown) {
        appendToBox(box, `{red-fg}Stream error: ${e}{/red-fg}`);
      }
    }
  };

  if (proc.stdout) processOutput(proc.stdout, false);
  if (proc.stderr) processOutput(proc.stderr, true);

  const exitCode = await proc.exited;
  if (!isShuttingDown) {
    _hasError = true;
    appendToBox(box, `{red-fg}${name} exited with code ${exitCode}{/red-fg}`);
    appendToBox(box, `{yellow-fg}Service crashed. Stopping all services...{/yellow-fg}`);
    helpBar.setContent(' {red-fg}ERROR: A service crashed! Stopping others... Press Q twice to exit.{/red-fg} ');
    screen.render();
    killAllProcesses();
  } else {
    if (exitCode === 0 || exitCode === 143) {
      appendToBox(box, `{green-fg}${name} stopped cleanly (exit code ${exitCode}){/green-fg}`);
    } else {
      appendToBox(box, `{yellow-fg}${name} exited with code ${exitCode}{/yellow-fg}`);
    }
  }
}

async function restartProxy() {
  const proc = processes.get('proxy');
  if (proc) {
    appendToBox(proxyBox, '{yellow-fg}Restarting proxy...{/yellow-fg}');
    proc.kill('SIGTERM');
    await proc.exited;
    processes.delete('proxy');
  }
  startProcess('bun', [kIsProduction ? 'proxy:node' : 'proxy:watch'], proxyBox, 'Proxy Server', undefined, { PRODUCTION: kIsProduction ? '1' : '0' });
}

async function handleGitHubWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = await req.json() as { ref?: string };
    const ref = payload.ref;
    
    if (ref === 'refs/heads/main') {
      appendToBox(proxyBox, '{magenta-fg}[Webhook] Push to main detected, pulling changes...{/magenta-fg}');
      screen.render();
      
      try {
        const result = await $`git pull`.text();
        appendToBox(proxyBox, `{magenta-fg}[Webhook] Git pull: ${result.trim()}{/magenta-fg}`);
        appendToBox(proxyBox, '{magenta-fg}[Webhook] Restarting proxy...{/magenta-fg}');
        screen.render();
        await restartProxy();
        return new Response('OK - pulled and restarted proxy', { status: 200 });
      } catch (e) {
        appendToBox(proxyBox, `{red-fg}[Webhook] Git pull failed: ${e}{/red-fg}`);
        screen.render();
        return new Response('Git pull failed', { status: 500 });
      }
    }
    
    return new Response('OK - ignored (not main branch)', { status: 200 });
  } catch (e) {
    return new Response('Invalid payload', { status: 400 });
  }
}

if (kIsProduction) {
  const webhookPort = 9000;
  Bun.serve({
    port: webhookPort,
    fetch: handleGitHubWebhook,
  });
  appendToBox(proxyBox, `{magenta-fg}[Webhook] GitHub webhook URL: http://localhost:${webhookPort}/{/magenta-fg}`);
}

primaryBox.focus();
screen.render();

appendToBox(primaryBox, '{cyan-fg}Initializing Primary Server...{/cyan-fg}');
appendToBox(secondaryBox, '{cyan-fg}Initializing Secondary Server...{/cyan-fg}');
appendToBox(proxyBox, '{cyan-fg}Initializing Proxy Server...{/cyan-fg}');

startProcess('bun', ['minecraft:primary'], primaryBox, 'Primary Server', undefined, { PRODUCTION: kIsProduction ? '1' : '0' });
startProcess('bun', ['minecraft:secondary'], secondaryBox, 'Secondary Server', undefined, { PRODUCTION: kIsProduction ? '1' : '0' });
startProcess('bun', [kIsProduction ? 'proxy:node' : 'proxy:watch'], proxyBox, 'Proxy Server', undefined, { PRODUCTION: kIsProduction ? '1' : '0' });
