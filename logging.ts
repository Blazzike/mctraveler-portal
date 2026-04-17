/**
 * Structured logging utility with consistent prefixes and log levels.
 *
 * Usage:
 *   import { log } from '@/logging';
 *   log.info('Proxy', 'Server started on port %d', 25565);
 *   log.warn('Auth', 'Session verification failed for %s', username);
 *   log.error('Switch', 'Dimension trick failed:', error);
 *   log.debug('Packet', 'Received packet 0x%02x', packetId);
 */

type LogFn = (message: string, ...args: any[]) => void;

interface Logger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
}

function formatPrefix(component: string): string {
  return `[${component}]`;
}

function createLogFn(level: 'info' | 'warn' | 'error' | 'debug'): LogFn {
  return (message: string, ...args: any[]) => {
    console[level](message, ...args);
  };
}

function createComponentLogger(component: string): Logger {
  const prefix = formatPrefix(component);
  return {
    info: (message: string, ...args: any[]) => console.log(`${prefix} ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`${prefix} ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`${prefix} ${message}`, ...args),
    debug: (message: string, ...args: any[]) => console.debug(`${prefix} ${message}`, ...args),
  };
}

export const log = {
  /** Create a scoped logger for a specific component */
  for: createComponentLogger,
  /** Raw log functions (no prefix) */
  info: createLogFn('info'),
  warn: createLogFn('warn'),
  error: createLogFn('error'),
  debug: createLogFn('debug'),
};
