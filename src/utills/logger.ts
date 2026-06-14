/**
 * Centralized logger for the extension.
 * All messages are prefixed so they're easy to spot in DevTools.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const PREFIX = '%c[YTMS]%c';
const PREFIX_STYLE = 'color:#ff4444;font-weight:bold';
const RESET_STYLE = '';

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.DEBUG) {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(PREFIX + ' ' + message, PREFIX_STYLE, RESET_STYLE, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info(PREFIX + ' ' + message, PREFIX_STYLE, RESET_STYLE, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(PREFIX + ' ' + message, PREFIX_STYLE, RESET_STYLE, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(PREFIX + ' ' + message, PREFIX_STYLE, RESET_STYLE, ...args);
    }
  }

  group(label: string): void {
    if (this.level <= LogLevel.DEBUG) {
      console.group(`${PREFIX} ${label}`, PREFIX_STYLE, RESET_STYLE);
    }
  }

  groupEnd(): void {
    if (this.level <= LogLevel.DEBUG) {
      console.groupEnd();
    }
  }

  time(label: string): void {
    console.time(`[YTMS] ${label}`);
  }

  timeEnd(label: string): void {
    console.timeEnd(`[YTMS] ${label}`);
  }
}

export const logger = new Logger();
