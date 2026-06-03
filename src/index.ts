#!/usr/bin/env node

import { config } from './config.js';
import {
  readCsvGenerator,
  appendCsvRow,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  getCsvHeaders,
} from './csv.js';
import { Crawler } from './crawler.js';
import { Logger } from './logger.js';
import pLimit from 'p-limit';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OutputCsvRow } from './types/csv.js';
import { CrawlTarget } from './types/crawler.js';
import { normalizeDomain, findWebsiteInRow } from './utils/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const version = pkg.version || 'unknown';

let highestContiguousIndex = -1;
const completedIndices = new Set<number>();
let completedUrls: string[] = [];
let crawlerInstance: Crawler | null = null;
let isShuttingDown = false;

/**
 * Handles graceful shutdown on SIGINT / SIGTERM signals.
 */
async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  process.stdout.write(
    `\n[SHUTDOWN] Received ${signal}. Saving checkpoints and shutting down...\n`,
  );

  if (crawlerInstance) {
    try {
      await crawlerInstance.close();
    } catch (_e) {
      /* ignore */
    }
  }

  if (highestContiguousIndex >= 0) {
    try {
      await saveCheckpoint(config.checkpointFile, {
        lastProcessedIndex: highestContiguousIndex,
        completedUrls,
        timestamp: new Date().toISOString(),
      });
      process.stdout.write(`[SHUTDOWN] Checkpoint persisted at index ${highestContiguousIndex}.\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[SHUTDOWN] Failed to write checkpoint: ${msg}\n`);
    }
  }

  process.exit(0);
}

// Register signal listeners
process.on('SIGINT', () => {
  handleShutdown('SIGINT').catch(() => process.exit(1));
});
process.on('SIGTERM', () => {
  handleShutdown('SIGTERM').catch(() => process.exit(1));
});

/**
 * Marks an index as completed and advances the highest contiguous completed index.
 */
function markIndexCompleted(index: number, url: string): void {
  completedIndices.add(index);
  completedUrls.push(url);
  while (completedIndices.has(highestContiguousIndex + 1)) {
    highestContiguousIndex++;
  }
}

/**
 * Main application runner.
 */
async function main(): Promise<void> {
  const startRunTime = Date.now();

  // Parse CLI flags and arguments
  const args = process.argv.slice(2);
  let inputPath = config.inputCsv;
  let outputPath = config.outputCsv;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i' || args[i] === '--input') {
      inputPath = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '-o' || args[i] === '--output') {
      outputPath = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '-e' || args[i] === '--exclude') {
      const excludeStr = args[i + 1] || '';
      const list = excludeStr
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      config.excludePrefixes = Array.from(new Set([...config.excludePrefixes, ...list]));
      i++;
    } else if (args[i] === '-v' || args[i] === '--version') {
      process.stdout.write(`mailpop v${version}\n`);
      process.exit(0);
    } else if (args[i] === '-h' || args[i] === '--help') {
      process.stdout.write(`
mailpop - CLI Guide
Usage: npx mailpop [options] [input.csv] [output.csv]

Options:
  -i, --input <path>     Path to the input CSV file
  -o, --output <path>    Path to the output CSV file
  -e, --exclude <list>   Comma-separated list of email local-parts to exclude
  -v, --version          Display the version number
  -h, --help             Display this help message
\n`);
      process.exit(0);
    } else if (!args[i].startsWith('-')) {
      positionals.push(args[i]);
    }
  }

  // Fallback to positional arguments
  if (positionals.length >= 1) {
    inputPath = path.resolve(positionals[0]);
  }
  if (positionals.length >= 2) {
    outputPath = path.resolve(positionals[1]);
  }

  await Logger.info(
    'app-initialize',
    undefined,
    undefined,
    'Running',
    `Initializing mailpop (Input: ${path.basename(inputPath)}, Output: ${path.basename(outputPath)})...`,
  );

  // 1. Extract dynamic headers from the input CSV
  let inputHeaders: string[] = [];
  try {
    inputHeaders = await getCsvHeaders(inputPath);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await Logger.error(
      'app-initialize-fail',
      undefined,
      undefined,
      `Failed to read input CSV headers: ${errorMsg}`,
    );
    process.exit(1);
  }

  // Construct combined output headers, preserving original columns and adding new ones
  const outputHeaders = [...inputHeaders];
  const newColumns = [
    'email',
    'email_source',
    'email_type',
    'confidence_score',
    'discovery_method',
  ];
  for (const col of newColumns) {
    if (!outputHeaders.includes(col)) {
      outputHeaders.push(col);
    }
  }

  // 2. Initialize crawler and browser
  crawlerInstance = new Crawler();
  await crawlerInstance.initialize(config.headless);

  // 3. Determine if resume is available
  let checkpointIndex = -1;
  const checkpoint = await loadCheckpoint(config.checkpointFile);

  if (checkpoint) {
    checkpointIndex = checkpoint.lastProcessedIndex;
    highestContiguousIndex = checkpointIndex;
    completedUrls = checkpoint.completedUrls;

    // Prime completed indices from checkpoint history to ensure tracking consistency
    for (let i = 0; i <= checkpointIndex; i++) {
      completedIndices.add(i);
    }

    await Logger.info(
      'runner-resume',
      undefined,
      undefined,
      'Resume',
      `Checkpoint found. Resuming crawl from row index ${checkpointIndex + 1}`,
    );
  } else {
    // New run. Setup fresh output file with CSV header line
    await Logger.info(
      'runner-fresh-start',
      undefined,
      undefined,
      'Fresh',
      'Starting fresh run. Writing CSV headers...',
    );

    try {
      const outDir = path.dirname(outputPath);
      await fs.mkdir(outDir, { recursive: true }).catch(() => {});
      const headerLine = outputHeaders.join(',') + '\n';
      await fs.writeFile(outputPath, headerLine, 'utf-8');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await Logger.error(
        'app-initialize-fail',
        undefined,
        undefined,
        `Failed to setup output file: ${errorMsg}`,
      );
      await crawlerInstance.close();
      process.exit(1);
    }
  }

  // 3. Process Input CSV with Concurrency Throttling
  const limit = pLimit(config.concurrency);
  const tasks: Promise<void>[] = [];
  let processedCount = 0;

  try {
    for await (const { row, index } of readCsvGenerator(inputPath)) {
      if (isShuttingDown) {
        break;
      }

      // Skip previously processed indices
      if (index <= checkpointIndex) {
        continue;
      }

      // Detect website URL column dynamically (Website, URL, Domain, Site, Web)
      const websiteUrl = findWebsiteInRow(row);
      if (!websiteUrl) {
        await Logger.error(
          'csv-row-skip',
          undefined,
          undefined,
          `Row ${index} is missing a website/url/domain column. Skipping.`,
        );
        markIndexCompleted(index, 'skipped-missing-url');
        continue;
      }

      // Schedule the crawl target
      const target: CrawlTarget = {
        name: row.Name || row.name || 'Unknown Company',
        website: websiteUrl,
        domain: row.Domain || row.domain || normalizeDomain(websiteUrl),
      };

      const task = limit(async () => {
        if (isShuttingDown) {
          return;
        }

        const result = await crawlerInstance!.crawlWebsite(target, config);

        if (isShuttingDown) {
          return;
        }

        // Map crawling result, retaining all original row keys
        const outputRow: OutputCsvRow = {
          ...row,
          email: result.selectedEmail ? result.selectedEmail.email : '',
          email_source: result.selectedEmail ? result.selectedEmail.emailSource : '',
          email_type: result.selectedEmail ? result.selectedEmail.emailType : '',
          confidence_score: result.selectedEmail
            ? String(result.selectedEmail.confidenceScore)
            : '',
          discovery_method: result.selectedEmail ? result.selectedEmail.discoveryMethod : '',
        };

        // Append output row incrementally matching the dynamic headers list
        await appendCsvRow(outputPath, outputRow, outputHeaders, false);

        // Mark index completed and log status
        markIndexCompleted(index, target.website);
        processedCount++;

        // Save progress checkpoints every 10 companies processed
        if (processedCount % 10 === 0) {
          await saveCheckpoint(config.checkpointFile, {
            lastProcessedIndex: highestContiguousIndex,
            completedUrls,
            timestamp: new Date().toISOString(),
          });
          await Logger.info(
            'runner-checkpoint',
            undefined,
            undefined,
            'Progress',
            `Checkpoint persisted. Processed: ${processedCount} in this run (Last index: ${highestContiguousIndex})`,
          );
        }
      });

      tasks.push(task);
    }

    // Wait for all scheduled crawler tasks to finish
    await Promise.all(tasks);

    // 4. Successful Finish
    if (!isShuttingDown) {
      await clearCheckpoint(config.checkpointFile);
      const totalDuration = Date.now() - startRunTime;
      await Logger.info(
        'runner-complete',
        undefined,
        totalDuration,
        'Success',
        `Crawl completed successfully. Processed ${processedCount} targets in ${Math.round(totalDuration / 1000)}s.`,
      );
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await Logger.error('runner-fatal', undefined, Date.now() - startRunTime, errorMsg);
  } finally {
    if (crawlerInstance) {
      await crawlerInstance.close();
    }
  }
}

// Start application
main().catch((err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error during application execution: ${errorMsg}\n`);
  process.exit(1);
});
