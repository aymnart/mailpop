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
const FG_MAGENTA = '\x1b[35m';
const FG_GRAY = '\x1b[90m';
const FG_WHITE = '\x1b[37m';
const TEXT_BLACK = '\x1b[30m';

const BG_CYAN = '\x1b[46m';
const BG_RED = '\x1b[41m';
const BG_MAGENTA = '\x1b[45m';

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
   * Logs a beautiful intro banner with all configuration settings.
   */
  static async intro(
    version: string,
    inputPath: string,
    outputPath: string,
    concurrency: number,
    excludePrefixes: string[],
    checkpointFile: string,
  ): Promise<void> {
    const border = `${BOLD}${FG_CYAN}┌────────────────────────────────────────────────────────┐${RESET}`;
    const title = `${BOLD}${FG_CYAN}│${RESET}   ${BOLD}${FG_MAGENTA}⚡ MAILPOP${RESET} ${FG_GRAY}v${version}${RESET}                                    ${BOLD}${FG_CYAN}│${RESET}`;
    const desc = `${BOLD}${FG_CYAN}│${RESET}   ${FG_WHITE}Production-Ready Contact Email Scraper${RESET}               ${BOLD}${FG_CYAN}│${RESET}`;
    const bottom = `${BOLD}${FG_CYAN}└────────────────────────────────────────────────────────┘${RESET}`;

    const infoLines = [
      `  ${BOLD}📂 Input CSV:${RESET}     ${FG_GREEN}${inputPath}${RESET}`,
      `  ${BOLD}📂 Output CSV:${RESET}    ${FG_GREEN}${outputPath}${RESET}`,
      `  ${BOLD}⚙️ Concurrency:${RESET}   ${FG_CYAN}${concurrency} targets${RESET}`,
      `  ${BOLD}🚫 Exclusions:${RESET}   ${FG_YELLOW}${excludePrefixes.join(', ') || 'None'}${RESET}`,
      `  ${BOLD}🔄 Checkpoint:${RESET}   ${FG_GRAY}${checkpointFile}${RESET}`,
    ];

    const fullConsoleMsg = `\n${border}\n${title}\n${desc}\n${bottom}\n\n${infoLines.join('\n')}\n\n`;
    process.stdout.write(fullConsoleMsg);

    await writeLog('app.log', {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      action: 'app-initialize',
      message: `Mailpop v${version} initialized. Input: ${inputPath}, Output: ${outputPath}, Concurrency: ${concurrency}, Exclusions: ${excludePrefixes.join(',')}`,
    });
  }

  /**
   * Logs a beautiful outro banner with summary metrics.
   */
  static async outro(
    processedCount: number,
    totalDurationMs: number,
    outputPath: string,
  ): Promise<void> {
    const border = `${BOLD}${FG_GREEN}┌────────────────────────────────────────────────────────┐${RESET}`;
    const title = `${BOLD}${FG_GREEN}│${RESET}   ${BOLD}${FG_GREEN}🎉 CRAWL COMPLETED SUCCESSFULLY!${RESET}                       ${BOLD}${FG_GREEN}│${RESET}`;
    const bottom = `${BOLD}${FG_GREEN}└────────────────────────────────────────────────────────┘${RESET}`;

    const infoLines = [
      `  ${BOLD}✨ Total Targets:${RESET}  ${FG_CYAN}${processedCount}${RESET}`,
      `  ${BOLD}⏱️ Time Elapsed:${RESET}   ${FG_CYAN}${(totalDurationMs / 1000).toFixed(1)}s${RESET}`,
      `  ${BOLD}💾 Output File:${RESET}    ${FG_GREEN}${outputPath}${RESET}`,
    ];

    const fullConsoleMsg = `\n${border}\n${title}\n${bottom}\n\n${infoLines.join('\n')}\n\n`;
    process.stdout.write(fullConsoleMsg);

    await writeLog('app.log', {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      action: 'runner-complete',
      duration: totalDurationMs,
      message: `Crawl completed successfully. Processed ${processedCount} targets in ${(totalDurationMs / 1000).toFixed(1)}s. Output: ${outputPath}`,
    });
  }

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

    const levelTag = `${BOLD}${BG_MAGENTA}${TEXT_BLACK} EMAIL ${RESET}`;
    const domainStr = ` ${FG_GRAY}[${FG_CYAN}${domain}${FG_GRAY}]${RESET}`;
    const emailStr = ` Found ${BOLD}${FG_GREEN}${email}${RESET}`;
    const detailsStr = ` (${FG_YELLOW}${method}${RESET}, confidence: ${BOLD}${confidence}${RESET}) at ${FG_GRAY}${source}${RESET}`;

    const consoleMsg = `${levelTag}${domainStr}${emailStr}${detailsStr}`;
    process.stdout.write(consoleMsg + '\n');

    await writeLog('discovered-emails.log', entry);
  }
}
