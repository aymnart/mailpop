import { chromium, Browser, BrowserContext } from 'playwright';
import { CrawlTarget, CrawlResult, CrawlPage, CrawlerConfig } from './types/crawler.js';
import { DiscoveredEmail } from './types/email.js';
import { parseRobotsTxt } from './robots.js';
import { parseSitemap } from './sitemap.js';
import { extractAndFilterLinks, getLinkPriority } from './link-discovery.js';
import { extractEmails } from './extractor.js';
import { selectBestEmail } from './scorer.js';
import { Cache } from './cache.js';
import { Logger } from './logger.js';
import { getRandomDelay } from './utils/delay.js';
import { retryWithBackoff } from './utils/retry.js';
import { normalizeUrl } from './utils/normalize.js';
import { isDomainMatch } from './utils/validators.js';
import { PageLoadError, RateLimitError } from './utils/errors.js';

export class Crawler {
  private browser: Browser | null = null;
  private cache: Cache;

  constructor() {
    this.cache = new Cache();
  }

  /**
   * Launches the headless/headful Playwright Chromium browser.
   */
  async initialize(headless: boolean = true): Promise<void> {
    if (this.browser) {
      return;
    }
    this.browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });
  }

  /**
   * Closes the active browser instance.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Loads a single page content using Playwright inside the context.
   * Leverages exponential backoff retries.
   */
  private async loadPage(
    pageUrl: string,
    context: BrowserContext,
    config: CrawlerConfig,
  ): Promise<{ html: string; title: string }> {
    return await retryWithBackoff(
      async () => {
        const page = await context.newPage();
        try {
          // Navigate with DOMContentLoaded as the baseline
          const response = await page.goto(pageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: config.pageTimeoutMs,
          });

          if (!response) {
            throw new PageLoadError('No response received from page', pageUrl);
          }

          const status = response.status();
          if (status === 429) {
            throw new RateLimitError(`Rate limited (429)`, pageUrl);
          }
          if (status >= 500) {
            throw new PageLoadError(`Server error (${status})`, pageUrl, status);
          }

          // Wait for load states to let JavaScript load components (React, Angular, Vue, Next.js, etc.)
          await page.waitForLoadState('load', { timeout: 1500 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => {});

          const html = await page.content();
          const title = await page.title().catch(() => '');

          return { html, title };
        } finally {
          await page.close();
        }
      },
      {
        maxRetries: config.maxRetries,
        initialDelayMs: config.retryInitialDelayMs,
        maxDelayMs: config.retryMaxDelayMs,
        onRetry: (err, attempt) => {
          let host = pageUrl;
          try {
            host = new URL(pageUrl).hostname;
          } catch (_e) {
            /* ignore */
          }

          Logger.info(
            'page-load-retry',
            host,
            undefined,
            `Attempt ${attempt}`,
            `Retrying navigation to ${pageUrl}: ${err.message}`,
          ).catch(() => {});
        },
      },
    );
  }

  /**
   * Crawls a single company website, performing discovery, BFS traversal, and email extraction.
   * Respects depth limit, crawl page budget, and website crawl duration timeout.
   */
  async crawlWebsite(target: CrawlTarget, config: CrawlerConfig): Promise<CrawlResult> {
    const startTime = Date.now();
    const domain = target.domain;

    if (!this.browser) {
      throw new Error('Browser is not initialized. Run initialize() first.');
    }

    const startUrl = normalizeUrl(target.website);
    if (!startUrl) {
      return {
        target,
        success: false,
        discoveredEmails: [],
        selectedEmail: null,
        error: 'Invalid start URL',
        pagesCrawledCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    let context: BrowserContext | null = null;
    const discoveredEmails: DiscoveredEmail[] = [];
    const occurrenceCounts: Record<string, number> = {};
    let pagesCrawledCount = 0;

    try {
      // 1. Initial configuration for browser context
      context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        bypassCSP: true,
        ignoreHTTPSErrors: true,
      });

      // Bandwidth & CPU optimization: block assets (images, fonts, stylesheets)
      // and heavy marketing/analytics scripts that hang connection states.
      await context.route('**/*', (route) => {
        const req = route.request();
        const type = req.resourceType();
        const url = req.url().toLowerCase();

        const isAsset = ['image', 'media', 'font', 'stylesheet'].includes(type);
        const isTracking = [
          'google-analytics',
          'googletagmanager',
          'doubleclick',
          'facebook.net',
          'hotjar',
          'segment.io',
          'mixpanel',
          'sentry.io',
          'amplitude',
          'hubspot',
        ].some((term) => url.includes(term));

        if (isAsset || isTracking) {
          route.abort().catch(() => {});
        } else {
          route.continue().catch(() => {});
        }
      });

      // 2. Discover Sitemaps & robots.txt
      const robotsInfo = await parseRobotsTxt(startUrl, this.cache);
      const sitemapLinks = [...robotsInfo.sitemaps];

      // If robots.txt doesn't mention sitemaps, guess standard names
      if (sitemapLinks.length === 0) {
        try {
          const parsedBase = new URL(startUrl);
          sitemapLinks.push(`${parsedBase.protocol}//${parsedBase.host}/sitemap.xml`);
          sitemapLinks.push(`${parsedBase.protocol}//${parsedBase.host}/sitemap_index.xml`);
        } catch (_e) {
          sitemapLinks.push(`${startUrl}/sitemap.xml`);
        }
      }

      // Collect URLs from sitemaps (limit total processed URLs to avoid high memory usage)
      const sitemapUrls: string[] = [];
      for (const sitemapUrl of sitemapLinks) {
        const urls = await parseSitemap(sitemapUrl, this.cache, 250);
        sitemapUrls.push(...urls);
        if (sitemapUrls.length >= 500) {
          break;
        }
      }

      // Initialize BFS queue and visited tracker
      const queue: CrawlPage[] = [];
      const visited = new Set<string>();

      // Push homepage as the first item
      queue.push({ url: startUrl, depth: 0, referrer: '' });
      visited.add(startUrl);

      // Prioritize sitemap URLs (keep ones containing contact keywords, max 10 to start)
      const filteredSitemapUrls = sitemapUrls
        .filter((url) => getLinkPriority(url) > 0)
        .slice(0, 10);

      for (const sUrl of filteredSitemapUrls) {
        const normalized = normalizeUrl(sUrl);
        if (normalized && !visited.has(normalized)) {
          queue.push({ url: normalized, depth: 1, referrer: 'sitemap' });
          visited.add(normalized);
        }
      }

      await Logger.info(
        'crawl-start',
        domain,
        undefined,
        'Active',
        `Queue size: ${queue.length} pages, sitemaps parsed: ${sitemapLinks.length}`,
      );

      // 3. Traversal (BFS) Loop
      let earlyExitTriggered = false;

      while (
        queue.length > 0 &&
        pagesCrawledCount < config.maxPagesPerSite &&
        !earlyExitTriggered
      ) {
        const elapsed = Date.now() - startTime;
        if (elapsed > config.maxCrawlTimePerSiteMs) {
          await Logger.info(
            'crawl-time-limit',
            domain,
            elapsed,
            'Timeout',
            `Reached budget limit of ${config.maxCrawlTimePerSiteMs}ms`,
          );
          break;
        }

        // Dequeue batch of up to 3 pages to load concurrently
        const batchSize = Math.min(3, queue.length, config.maxPagesPerSite - pagesCrawledCount);
        const batch: CrawlPage[] = [];
        for (let i = 0; i < batchSize; i++) {
          const item = queue.shift();
          if (item) {
            batch.push(item);
          }
        }

        if (batch.length === 0) {
          break;
        }

        pagesCrawledCount += batch.length;

        // Apply throttling delay between page batches (if we've already crawled pages)
        if (pagesCrawledCount > batch.length) {
          await getRandomDelay(config.minDelayMs, config.maxDelayMs);
        }

        // Crawl current batch pages concurrently
        await Promise.all(
          batch.map(async (current) => {
            if (earlyExitTriggered) {
              return;
            }

            const pageStart = Date.now();
            try {
              const { html, title } = await this.loadPage(current.url, context!, config);
              const pageDuration = Date.now() - pageStart;

              // Extract emails
              const extracted = extractEmails(html, current.url, title, pageDuration);

              for (const item of extracted) {
                // Keep occurrences tracker updated
                occurrenceCounts[item.email] = (occurrenceCounts[item.email] || 0) + 1;

                // Deduplicate: If already found, update with higher confidence if applicable
                const existingIdx = discoveredEmails.findIndex((e) => e.email === item.email);
                if (existingIdx === -1) {
                  discoveredEmails.push(item);
                  await Logger.email(
                    domain,
                    item.email,
                    item.emailSource,
                    item.confidenceScore,
                    item.discoveryMethod,
                  );
                } else {
                  if (item.confidenceScore > discoveredEmails[existingIdx].confidenceScore) {
                    discoveredEmails[existingIdx] = item;
                  }
                }
              }

              // Check if we can trigger an early stop
              const currentBest = selectBestEmail(discoveredEmails, domain, occurrenceCounts);
              if (
                currentBest &&
                currentBest.confidenceScore >= 95 &&
                isDomainMatch(currentBest.email, domain)
              ) {
                earlyExitTriggered = true;
                await Logger.info(
                  'crawl-early-stop',
                  domain,
                  Date.now() - startTime,
                  'Success',
                  `Early exit triggered by: ${currentBest.email} (${currentBest.confidenceScore} score)`,
                );
              }

              // Discover and enqueue internal links if depth is within bounds and early exit hasn't fired
              if (!earlyExitTriggered && current.depth < config.maxDepth) {
                const childLinks = extractAndFilterLinks(html, current.url, domain);
                for (const link of childLinks) {
                  if (!visited.has(link) && visited.size < 100) {
                    // Safety ceiling to prevent massive Set sizes
                    visited.add(link);
                    queue.push({
                      url: link,
                      depth: current.depth + 1,
                      referrer: current.url,
                    });
                  }
                }
              }
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : String(err);
              await Logger.error(
                'page-crawl-error',
                domain,
                Date.now() - pageStart,
                `Failed ${current.url}: ${errorMsg}`,
              );
            }
          }),
        );
      }

      // 4. Select Final Email
      const selectedEmail = selectBestEmail(discoveredEmails, domain, occurrenceCounts);
      const totalDuration = Date.now() - startTime;

      await Logger.info(
        'crawl-end',
        domain,
        totalDuration,
        selectedEmail ? 'Found' : 'Empty',
        `Crawled ${pagesCrawledCount} pages. Final email: ${selectedEmail ? selectedEmail.email : 'None'}`,
      );

      return {
        target,
        success: true,
        discoveredEmails,
        selectedEmail,
        pagesCrawledCount,
        durationMs: totalDuration,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await Logger.error('crawl-fatal-error', domain, Date.now() - startTime, errorMsg);
      return {
        target,
        success: false,
        discoveredEmails: [],
        selectedEmail: null,
        error: errorMsg,
        pagesCrawledCount,
        durationMs: Date.now() - startTime,
      };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }
}
