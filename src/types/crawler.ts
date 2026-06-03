import { DiscoveredEmail } from './email.js';

export interface CrawlTarget {
  name: string;
  website: string;
  domain: string;
}

export interface CrawlPage {
  url: string;
  depth: number;
  referrer: string;
}

export interface CrawlResult {
  target: CrawlTarget;
  success: boolean;
  discoveredEmails: DiscoveredEmail[];
  selectedEmail: DiscoveredEmail | null;
  error?: string;
  pagesCrawledCount: number;
  durationMs: number;
}

export interface CrawlerConfig {
  concurrency: number;
  maxDepth: number;
  maxPagesPerSite: number;
  maxCrawlTimePerSiteMs: number;
  pageTimeoutMs: number;
  headless: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
}
