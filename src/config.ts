import dotenv from 'dotenv';
import path from 'path';
import { CrawlerConfig } from './types/crawler.js';

// Load environment variables from .env
dotenv.config();

export interface AppConfig extends CrawlerConfig {
  inputCsv: string;
  outputCsv: string;
  checkpointFile: string;
  cacheDir: string;
}

const getEnvNumber = (key: string, defaultValue: number): number => {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultValue : num;
};

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return val.toLowerCase() === 'true';
};

export const config: AppConfig = {
  inputCsv: path.resolve(process.env.INPUT_CSV || 'input.csv'),
  outputCsv: path.resolve(process.env.OUTPUT_CSV || 'output/output.csv'),
  checkpointFile: path.resolve(process.env.CHECKPOINT_FILE || 'output/checkpoint.json'),
  cacheDir: path.resolve(process.env.CACHE_DIR || 'output/cache'),

  concurrency: getEnvNumber('CONCURRENCY', 5),
  maxDepth: getEnvNumber('MAX_DEPTH', 2),
  maxPagesPerSite: getEnvNumber('MAX_PAGES_PER_SITE', 25),
  maxCrawlTimePerSiteMs: getEnvNumber('MAX_CRAWL_TIME_PER_SITE_MS', 60000),
  pageTimeoutMs: getEnvNumber('PAGE_TIMEOUT_MS', 15000),
  headless: getEnvBoolean('HEADLESS', true),
  minDelayMs: getEnvNumber('MIN_DELAY_MS', 500),
  maxDelayMs: getEnvNumber('MAX_DELAY_MS', 2000),
  maxRetries: getEnvNumber('MAX_RETRIES', 3),
  retryInitialDelayMs: getEnvNumber('RETRY_INITIAL_DELAY_MS', 1000),
  retryMaxDelayMs: getEnvNumber('RETRY_MAX_DELAY_MS', 10000),
};
