import fs from 'fs/promises';
import path from 'path';

const LOGS_DIR = path.resolve('logs');

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

    const consoleMsg = `[INFO] ${domain ? `[${domain}] ` : ''}${action}${result ? ` -> ${result}` : ''}${message ? ` | ${message}` : ''}`;
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

    const consoleMsg = `[ERROR] ${domain ? `[${domain}] ` : ''}${action}${errorMsg ? `: ${errorMsg}` : ''}`;
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

    const consoleMsg = `[EMAIL] [${domain}] Found ${email} (${method}, confidence: ${confidence}) at ${source}`;
    process.stdout.write(consoleMsg + '\n');

    await writeLog('discovered-emails.log', entry);
  }
}
