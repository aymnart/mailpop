import { load } from 'cheerio';
import { Logger } from './logger.js';
import { Cache } from './cache.js';

/**
 * Fetches and recursively parses a sitemap URL. If it's a sitemap index, it parses
 * sub-sitemaps up to a limit. Returns discovered URLs.
 * @param sitemapUrl - Absolute URL to the XML sitemap.
 * @param cache - Cache instance to store results.
 * @param maxUrls - Maximum number of URLs to extract per sitemap to prevent memory overload.
 */
export async function parseSitemap(
  sitemapUrl: string,
  cache: Cache,
  maxUrls: number = 500,
): Promise<string[]> {
  const cached = await cache.get<string[]>(sitemapUrl);
  if (cached) {
    return cached;
  }

  const urls: string[] = [];
  let host = '';
  try {
    host = new URL(sitemapUrl).hostname;
  } catch (_e) {
    host = sitemapUrl;
  }

  try {
    const response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) mailpop/1.0',
        Accept: 'application/xml, text/xml, application/xhtml+xml, */*',
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
    });

    if (response.ok) {
      const xml = await response.text();
      // Use xmlMode: true for Cheerio to parse XML tags correctly
      const $ = load(xml, { xmlMode: true });

      // 1. Check if it's a sitemap index (contains <sitemap> tags)
      const sitemaps = $('sitemap');
      if (sitemaps.length > 0) {
        const nestedUrls: string[] = [];
        // Limit scanning to first 5 sub-sitemaps to avoid excessive fetches
        const subSitemapsLimit = Math.min(sitemaps.length, 5);
        for (let i = 0; i < subSitemapsLimit; i++) {
          const loc = $(sitemaps[i]).find('loc').text().trim();
          if (loc) {
            const nested = await parseSitemap(loc, cache, maxUrls);
            nestedUrls.push(...nested);
            if (nestedUrls.length >= maxUrls) {
              break;
            }
          }
        }
        const finalNested = nestedUrls.slice(0, maxUrls);
        await cache.set(sitemapUrl, finalNested, 86400000); // Cache 24 hours
        return finalNested;
      }

      // 2. Otherwise it's a normal sitemap (contains <url> tags)
      $('url').each((_, element) => {
        if (urls.length >= maxUrls) {
          return;
        }
        const loc = $(element).find('loc').text().trim();
        if (loc) {
          urls.push(loc);
        }
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await Logger.info(
      'sitemap-fetch-skip',
      host,
      undefined,
      'Skipped',
      `Failed to parse sitemap: ${errorMsg}`,
    );
  }

  const finalUrls = urls.slice(0, maxUrls);
  // Cache the results for 24 hours (86400000 ms)
  await cache.set(sitemapUrl, finalUrls, 86400000);
  return finalUrls;
}
