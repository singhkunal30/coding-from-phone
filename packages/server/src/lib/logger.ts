/** Lightweight structured logger; swap with pino/winston when scaling. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const levelRank: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = (process.env.LOG_LEVEL as Level) || 'info';

const fmt = (level: Level, args: unknown[]) => {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${ts}] [${level.toUpperCase()}]`, ...args);
};

const log = (level: Level, args: unknown[]) => {
  if (levelRank[level] >= levelRank[minLevel]) fmt(level, args);
};

export const logger = {
  debug: (...args: unknown[]) => log('debug', args),
  info: (...args: unknown[]) => log('info', args),
  warn: (...args: unknown[]) => log('warn', args),
  error: (...args: unknown[]) => log('error', args),
};
