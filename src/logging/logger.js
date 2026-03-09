const fs = require('fs');
const os = require('os');
const path = require('path');
const { getRequestContext } = require('./requestContext');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const IST_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_LOG_ROOT = path.resolve(process.cwd(), 'logs');
const LOG_FILE_PREFIX = 'backend';
const MAX_STRING_LENGTH = 1000;
const MAX_ARRAY_LENGTH = 25;
const MAX_OBJECT_KEYS = 30;
const MAX_DEPTH = 4;
const REDACTED_VALUE = '[REDACTED]';
const REDACTED_FIELD_PATTERN = /(authorization|cookie|password|token|secret|api[_-]?key|session|set-cookie)/i;

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function getIstDateParts(date = new Date()) {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);

  return {
    year: String(istDate.getUTCFullYear()),
    month: pad(istDate.getUTCMonth() + 1),
    day: pad(istDate.getUTCDate()),
    hour: pad(istDate.getUTCHours()),
    minute: pad(istDate.getUTCMinutes()),
    second: pad(istDate.getUTCSeconds()),
    millisecond: pad(istDate.getUTCMilliseconds(), 3),
  };
}

function formatIstTimestamp(date = new Date()) {
  const parts = getIstDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond}+05:30`;
}

function getLogRootPath() {
  const configuredPath = typeof process.env.LOG_ROOT_PATH === 'string' ? process.env.LOG_ROOT_PATH.trim() : '';
  return configuredPath || DEFAULT_LOG_ROOT;
}

function resolveLogFilePath(date = new Date()) {
  const parts = getIstDateParts(date);
  const monthFolder = `${parts.year}-${parts.month}`;
  const fileName = `${LOG_FILE_PREFIX}-${parts.year}-${parts.month}-${parts.day}.log`;
  const directoryPath = path.resolve(getLogRootPath(), monthFolder);
  const filePath = path.join(directoryPath, fileName);

  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    directoryPath,
    filePath,
  };
}

function sanitizeForLogging(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (value instanceof Date) {
    return formatIstTimestamp(value);
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer length=${value.length}]`;
  }

  if (Array.isArray(value)) {
    const sanitizedItems = value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeForLogging(item, depth + 1));
    if (value.length > MAX_ARRAY_LENGTH) {
      sanitizedItems.push(`[+${value.length - MAX_ARRAY_LENGTH} more items]`);
    }
    return sanitizedItems;
  }

  if (typeof value === 'string') {
    if (value.length <= MAX_STRING_LENGTH) {
      return value;
    }

    return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
  }

  if (typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value);
  const limitedEntries = entries.slice(0, MAX_OBJECT_KEYS);
  const sanitizedObject = {};

  for (const [key, nestedValue] of limitedEntries) {
    if (REDACTED_FIELD_PATTERN.test(key)) {
      sanitizedObject[key] = REDACTED_VALUE;
      continue;
    }

    sanitizedObject[key] = sanitizeForLogging(nestedValue, depth + 1);
  }

  if (entries.length > MAX_OBJECT_KEYS) {
    sanitizedObject.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }

  return sanitizedObject;
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return sanitizeForLogging(error);
  }

  return sanitizeForLogging({
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code,
    cause: error.cause,
  });
}

class DailyRotatingLogWriter {
  constructor() {
    this.currentDayKey = null;
    this.currentFilePath = null;
    this.stream = null;
  }

  ensureStream(date = new Date()) {
    const { dayKey, directoryPath, filePath } = resolveLogFilePath(date);
    if (this.stream && this.currentDayKey === dayKey && this.currentFilePath === filePath) {
      return;
    }

    if (this.stream) {
      this.stream.end();
    }

    fs.mkdirSync(directoryPath, { recursive: true });
    this.stream = fs.createWriteStream(filePath, {
      flags: 'a',
      encoding: 'utf8',
    });
    this.currentDayKey = dayKey;
    this.currentFilePath = filePath;
  }

  write(entry, date = new Date()) {
    this.ensureStream(date);
    this.stream.write(`${JSON.stringify(entry)}${os.EOL}`);
  }

  close() {
    if (!this.stream) {
      return;
    }

    this.stream.end();
    this.stream = null;
    this.currentDayKey = null;
    this.currentFilePath = null;
  }
}

const logWriter = new DailyRotatingLogWriter();
let processHandlersRegistered = false;

function buildLogEntry(level, message, metadata) {
  const now = new Date();
  const requestContext = getRequestContext();

  return {
    timestamp: formatIstTimestamp(now),
    timezone: IST_TIMEZONE,
    level,
    message,
    requestId: requestContext?.requestId,
    method: requestContext?.method,
    path: requestContext?.path,
    ...sanitizeForLogging(metadata),
  };
}

function writeLog(level, message, metadata = {}) {
  try {
    logWriter.write(buildLogEntry(level, message, metadata));
  } catch (error) {
    process.stderr.write(`Failed to write log entry: ${error.message}${os.EOL}`);
  }
}

const logger = {
  info(message, metadata) {
    writeLog('info', message, metadata);
  },
  warn(message, metadata) {
    writeLog('warn', message, metadata);
  },
  error(message, metadata) {
    writeLog('error', message, metadata);
  },
  debug(message, metadata) {
    writeLog('debug', message, metadata);
  },
};

function closeLogger() {
  logWriter.close();
}

function registerProcessLogging() {
  if (processHandlersRegistered) {
    return;
  }

  processHandlersRegistered = true;

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      error: serializeError(reason),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      error: serializeError(error),
    });
    closeLogger();
    process.exit(1);
  });
}

module.exports = {
  closeLogger,
  formatIstTimestamp,
  getLogRootPath,
  logger,
  registerProcessLogging,
  sanitizeForLogging,
  serializeError,
};