import { Logger } from './logger.js';
import { Cache } from './cache.js';

export interface RobotsInfo {
  sitemaps: string[];
  disallowedPaths: string[];
}

/**
 * Fetches and parses robots.txt for a website, extracting sitemap links and disallowed paths.
 * @param websiteUrl - Base website URL.
 * @param cache - Cache instance to store results.
 */
export async function parseRobotsTxt(websiteUrl: string, cache: Cache): Promise<RobotsInfo> {
  let domainHost = '';
  try {
    domainHost = new URL(websiteUrl).hostname;
  } catch (_e) {
    domainHost = websiteUrl;
  }

  // Construct absolute robots.txt URL
  let robotsUrl = '';
  try {
    const base = new URL(websiteUrl);
    robotsUrl = `${base.protocol}//${base.host}/robots.txt`;
  } catch (_e) {
    robotsUrl = `https://${domainHost}/robots.txt`;
  }

  const cached = await cache.get<RobotsInfo>(robotsUrl);
  if (cached) {
    return cached;
  }

  const result: RobotsInfo = {
    sitemaps: [],
    disallowedPaths: [],
  };

  try {
    const response = await fetch(robotsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) mailpop/1.0',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (response.ok) {
      const text = await response.text();
      const lines = text.split(/\r?\n/);

      let appliesToUs = true; // True unless we hit User-agent that isn't '*' or 'mailpop'

      for (const line of lines) {
        const cleaned = line.trim();
        if (!cleaned || cleaned.startsWith('#')) {
          continue;
        }

        const colonIdx = cleaned.indexOf(':');
        if (colonIdx === -1) {
          continue;
        }

        const key = cleaned.substring(0, colonIdx).trim().toLowerCase();
        const value = cleaned.substring(colonIdx + 1).trim();

        if (key === 'user-agent') {
          const ua = value.toLowerCase();
          appliesToUs = ua === '*' || ua === 'mailpop';
        } else if (key === 'sitemap') {
          try {
            // Validate it is a valid URL
            new URL(value);
            result.sitemaps.push(value);
          } catch (_e) {
            // Try resolving relative URL if needed
            try {
              const absUrl = new URL(value, robotsUrl).toString();
              result.sitemaps.push(absUrl);
            } catch (_err) {
              // Ignore invalid sitemap URL
            }
          }
        } else if (key === 'disallow' && appliesToUs) {
          if (value) {
            result.disallowedPaths.push(value);
          }
        }
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await Logger.info(
      'robots-fetch-skip',
      domainHost,
      undefined,
      'Skipped',
      `Failed to fetch robots.txt: ${errorMsg}`,
    );
  }

  // Cache the result for 24 hours (86400000 ms)
  await cache.set(robotsUrl, result, 86400000);
  return result;
}
