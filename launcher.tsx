#!/usr/bin/env bun
import { $, type Subprocess, spawn } from 'bun';
import { Box, render, Text, useApp, useInput } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import { kIsProduction } from './config';

const MAX_BUFFER_LINES = 200;

type Pane = 'primary' | 'secondary' | 'proxy';
type LogLine = { text: string; isError: boolean };

function ProcessPane({
  name,
  port,
  pane,
  focused,
  logs,
  onFocus,
  onCrash,
  registerProc,
}: {
  name: string;
  port: number;
  pane: Pane;
  focused: boolean;
  logs: LogLine[];
  onFocus: () => void;
  onCrash: (exitCode: number) => void;
  registerProc: (pane: Pane, proc: Subprocess) => void;
}) {
  const [status, setStatus] = useState<'starting' | 'running' | 'stopped' | 'crashed'>('starting');

  useEffect(() => {
    const command = pane === 'proxy' ? (kIsProduction ? 'proxy' : 'proxy:watch') : `minecraft:${pane}`;
    const args =
      command === 'minecraft:primary'
        ? ['minecraft:primary']
        : command === 'minecraft:secondary'
          ? ['minecraft:secondary']
          : [kIsProduction ? 'proxy' : 'proxy:watch'];

    const proc = spawn(['bun', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
      env: { ...process.env, PRODUCTION: kIsProduction ? '1' : '0' },
    });

    registerProc(pane, proc);

    const appendLog = (text: string, isError: boolean) => {
      logs.push({ text, isError });
      if (logs.length > MAX_BUFFER_LINES) {
        logs.shift();
      }
    };

    appendLog(`Starting ${name}...`, false);

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
              appendLog(line, isError);
            }
          }
        }
      } catch {}
    };

    if (proc.stdout) processOutput(proc.stdout, false);
    if (proc.stderr) processOutput(proc.stderr, true);

    setStatus('running');

    proc.exited.then((exitCode) => {
      appendLog(`${name} exited with code ${exitCode}`, true);
      if (status !== 'stopped') {
        setStatus('crashed');
        onCrash(exitCode);
      }
    });

    return () => {
      setStatus('stopped');
      proc.kill('SIGTERM');
    };
  }, []);

  const borderColor = focused ? 'green' : status === 'crashed' ? 'red' : 'cyan';

  return (
    <Box borderStyle="single" borderColor={borderColor} flexDirection="column" flexGrow={1} onClick={onFocus}>
      <Box backgroundColor={borderColor} paddingX={1}>
        <Text bold>
          {name} ({port})
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {logs.map((line, i) => (
          <Text key={i} color={line.isError ? 'red' : 'white'}>
            {line.isError && '[ERROR] '}
            {line.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function Launcher() {
  const [focusedPane, setFocusedPane] = useState<Pane>('primary');
  const [inputMode, setInputMode] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [hasError, setHasError] = useState(false);
  const { exit } = useApp();

  const primaryLogs = useRef<LogLine[]>([]);
  const secondaryLogs = useRef<LogLine[]>([]);
  const proxyLogs = useRef<LogLine[]>([]);

  const processesRef = useRef<Map<Pane, Subprocess>>(new Map());

  const registerProc = (pane: Pane, proc: Subprocess) => {
    processesRef.current.set(pane, proc);
  };

  const handleCrash = (pane: Pane, exitCode: number) => {
    if (isShuttingDown) return;
    setHasError(true);
    setIsShuttingDown(true);

    for (const [p, proc] of processesRef.current.entries()) {
      if (p === 'primary' || p === 'secondary') {
        try {
          if (proc.stdin && typeof proc.stdin !== 'number') {
            (proc.stdin as { write: (data: string) => void }).write('stop\n');
          }
        } catch {}
      } else {
        proc.kill('SIGTERM');
      }
    }

    setTimeout(() => {
      exit();
    }, 3000);
  };

  useInput((input, key) => {
    if (inputMode) {
      if (key.return) {
        const logsMap = { primary: primaryLogs, secondary: secondaryLogs, proxy: proxyLogs };
        const proc = processesRef.current.get(focusedPane);
        if (proc?.stdin && typeof proc.stdin !== 'number') {
          (proc.stdin as { write: (data: string) => void }).write(`${inputValue}\n`);
        }
        logsMap[focusedPane].current.push({ text: `> ${inputValue}`, isError: false });
        setInputMode(false);
        setInputValue('');
      } else if (key.escape) {
        setInputMode(false);
        setInputValue('');
      } else if (key.backspace || key.delete) {
        setInputValue((prev) => prev.slice(0, -1));
      } else if (input) {
        setInputValue((prev) => prev + input);
      }
    } else {
      if (key.ctrlC || input === 'q') {
        if (!isShuttingDown) {
          setIsShuttingDown(true);
          for (const [p, proc] of processesRef.current.entries()) {
            if (p === 'primary' || p === 'secondary') {
              try {
                if (proc.stdin && typeof proc.stdin !== 'number') {
                  (proc.stdin as { write: (data: string) => void }).write('stop\n');
                }
              } catch {}
            } else {
              proc.kill('SIGTERM');
            }
          }
          setTimeout(() => {
            exit();
          }, 3000);
        } else {
          exit();
        }
      } else if (input === '1') {
        setFocusedPane('primary');
      } else if (input === '2') {
        setFocusedPane('secondary');
      } else if (input === '3') {
        setFocusedPane('proxy');
      } else if (input === 'i') {
        setInputMode(true);
      }
    }
  });

  useEffect(() => {
    if (kIsProduction) {
      const webhookPort = 9000;
      Bun.serve({
        port: webhookPort,
        fetch: async (req) => {
          if (req.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
          }

          try {
            const payload = (await req.json()) as { ref?: string };
            const ref = payload.ref;

            if (ref === 'refs/heads/main') {
              proxyLogs.current.push({ text: '[Webhook] Push to main detected, pulling changes...', isError: false });
              try {
                const result = await $`git pull`.text();
                proxyLogs.current.push({ text: `[Webhook] Git pull: ${result.trim()}`, isError: false });
                proxyLogs.current.push({ text: '[Webhook] Restarting proxy...', isError: false });

                const proc = processesRef.current.get('proxy');
                if (proc) {
                  proc.kill('SIGTERM');
                  await proc.exited;
                  processesRef.current.delete('proxy');
                }

                const newProc = spawn(['bun', kIsProduction ? 'proxy' : 'proxy:watch'], {
                  stdout: 'pipe',
                  stderr: 'pipe',
                  stdin: 'pipe',
                  env: { ...process.env, PRODUCTION: kIsProduction ? '1' : '0' },
                });
                processesRef.current.set('proxy', newProc);

                return new Response('OK - pulled and restarted proxy', { status: 200 });
              } catch (e) {
                proxyLogs.current.push({ text: `[Webhook] Git pull failed: ${e}`, isError: true });
                return new Response('Git pull failed', { status: 500 });
              }
            }

            return new Response('OK - ignored (not main branch)', { status: 200 });
          } catch (e) {
            return new Response('Invalid payload', { status: 400 });
          }
        },
      });
      proxyLogs.current.push({ text: `[Webhook] GitHub webhook URL: http://localhost:${webhookPort}/`, isError: false });
    }
  }, []);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="row" flexGrow={1}>
        <Box flexGrow={1} flexDirection="column">
          <ProcessPane
            name="Primary Server"
            port={25566}
            pane="primary"
            focused={focusedPane === 'primary'}
            logs={primaryLogs.current}
            onFocus={() => setFocusedPane('primary')}
            onCrash={(code) => handleCrash('primary', code)}
            registerProc={registerProc}
          />
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <ProcessPane
            name="Secondary Server"
            port={25567}
            pane="secondary"
            focused={focusedPane === 'secondary'}
            logs={secondaryLogs.current}
            onFocus={() => setFocusedPane('secondary')}
            onCrash={(code) => handleCrash('secondary', code)}
            registerProc={registerProc}
          />
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        <ProcessPane
          name="Proxy Server"
          port={25565}
          pane="proxy"
          focused={focusedPane === 'proxy'}
          logs={proxyLogs.current}
          onFocus={() => setFocusedPane('proxy')}
          onCrash={(code) => handleCrash('proxy', code)}
          registerProc={registerProc}
        />
      </Box>
      <Box borderStyle="single" borderColor="white" paddingX={1}>
        {inputMode ? (
          <Text>
            <Text color="blue">{`> ${inputValue}_`}</Text>
          </Text>
        ) : (
          <Text>
            {hasError ? (
              <Text color="red">ERROR: A service crashed! Stopping others... Press Q to exit</Text>
            ) : isShuttingDown ? (
              <Text color="yellow">Stopping all services... Press Q to exit</Text>
            ) : (
              <Text>
                <Text color={focusedPane === 'primary' ? 'green' : 'white'}>1</Text>:
                <Text color={focusedPane === 'primary' ? 'green' : 'white'}>Primary</Text>
                {' | '}
                <Text color={focusedPane === 'secondary' ? 'green' : 'white'}>2</Text>:
                <Text color={focusedPane === 'secondary' ? 'green' : 'white'}>Secondary</Text>
                {' | '}
                <Text color={focusedPane === 'proxy' ? 'green' : 'white'}>3</Text>:
                <Text color={focusedPane === 'proxy' ? 'green' : 'white'}>Proxy</Text>
                {' | '}
                I: Command | Q: Quit
              </Text>
            )}
          </Text>
        )}
      </Box>
    </Box>
  );
}

render(<Launcher />);
