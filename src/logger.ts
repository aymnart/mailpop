import fs from 'fs/promises';
import path from 'path';

const LOGS_DIR = path.resolve('logs');

// ANSI escape codes for styling
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const FG_CYAN = '\x1b[36m';
const FG_GREEN = '\x1b[32m';
const FG_RED = '\x1b[31m';
const FG_YELLOW = '\x1b[33m';
const FG_GRAY = '\x1b[90m';
const FG_WHITE = '\x1b[37m';
const TEXT_BLACK = '\x1b[30m';

const BG_CYAN = '\x1b[46m';
const BG_GREEN = '\x1b[42m';
const BG_RED = '\x1b[41m';

/**
 * Ensures that the logs directory exists on disk.
 */
async function ensureLogsDir(): Promise<void> {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  } catch (_e) {
    // Ignore error if directory already exists
  }
}

/**
 * Writes a single JSON line to a specified log file.
 */
async function writeLog(filename: string, data: object): Promise<void> {
  await ensureLogsDir();
  const filePath = path.join(LOGS_DIR, filename);
  const logLine = JSON.stringify(data) + '\n';
  try {
    await fs.appendFile(filePath, logLine, 'utf-8');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to write log to ${filename}: ${errorMsg}\n`);
  }
}

export class Logger {
  /**
   * Logs general information events.
   */
  static async info(
    action: string,
    domain?: string,
    duration?: number,
    result?: string,
    message?: string,
  ): Promise<void> {
    const entry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      domain,
      action,
      duration,
      result,
      message,
    };

    const levelTag = `${BOLD}${BG_CYAN}${TEXT_BLACK} INFO ${RESET}`;
    const domainStr = domain ? ` ${FG_GRAY}[${FG_CYAN}${domain}${FG_GRAY}]${RESET}` : '';
    const actionStr = ` ${BOLD}${action}${RESET}`;
    const resultStr = result ? ` -> ${FG_GREEN}${result}${RESET}` : '';
    const msgStr = message ? ` | ${FG_GRAY}${message}${RESET}` : '';

    const consoleMsg = `${levelTag}${domainStr}${actionStr}${resultStr}${msgStr}`;
    process.stdout.write(consoleMsg + '\n');

    await writeLog('app.log', entry);
  }

  /**
   * Logs error events and duplicates them to errors.log.
   */
  static async error(
    action: string,
    domain?: string,
    duration?: number,
    errorMsg?: string,
    stack?: string,
  ): Promise<void> {
    const entry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      domain,
      action,
      duration,
      error: errorMsg,
      stack,
    };

    const levelTag = `${BOLD}${BG_RED}${FG_WHITE} ERROR ${RESET}`;
    const domainStr = domain ? ` ${FG_GRAY}[${FG_RED}${domain}${FG_GRAY}]${RESET}` : '';
    const actionStr = ` ${BOLD}${action}${RESET}`;
    const errorStr = errorMsg ? `: ${FG_RED}${errorMsg}${RESET}` : '';

    const consoleMsg = `${levelTag}${domainStr}${actionStr}${errorStr}`;
    process.stderr.write(consoleMsg + '\n');

    await writeLog('app.log', entry);
    await writeLog('errors.log', entry);
  }

  /**
   * Logs a discovered email to the dedicated discovered-emails.log file.
   */
  static async email(
    domain: string,
    email: string,
    source: string,
    confidence: number,
    method: string,
  ): Promise<void> {
    const entry = {
      timestamp: new Date().toISOString(),
      domain,
      email,
      emailSource: source,
      confidenceScore: confidence,
      discoveryMethod: method,
    };

    const levelTag = `${BOLD}${BG_GREEN}${TEXT_BLACK} EMAIL ${RESET}`;
    const domainStr = ` ${FG_GRAY}[${FG_CYAN}${domain}${FG_GRAY}]${RESET}`;
    const emailStr = ` Found ${BOLD}${FG_GREEN}${email}${RESET}`;
    const detailsStr = ` (${FG_YELLOW}${method}${RESET}, confidence: ${BOLD}${confidence}${RESET}) at ${FG_GRAY}${source}${RESET}`;

    const consoleMsg = `${levelTag}${domainStr}${emailStr}${detailsStr}`;
    process.stdout.write(consoleMsg + '\n');

    await writeLog('discovered-emails.log', entry);
  }
}
