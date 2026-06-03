import { load } from 'cheerio';
import { normalizeDomain, normalizeUrl } from './utils/normalize.js';

const AVOID_KEYWORDS = [
  'logout',
  'login',
  'signup',
  'register',
  'checkout',
  'cart',
  'dashboard',
  'account',
  'auth',
  'admin',
  'wp-admin',
];

/**
 * Checks if a URL matches patterns we should avoid.
 */
export function shouldAvoidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathAndQuery = (parsed.pathname + parsed.search + parsed.hash).toLowerCase();

    // Avoid non-http protocols, assets, documents, and media
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true;
    }

    const fileExtension = parsed.pathname.split('.').pop()?.toLowerCase();
    if (
      fileExtension &&
      [
        'pdf',
        'jpg',
        'jpeg',
        'png',
        'gif',
        'svg',
        'zip',
        'tar',
        'gz',
        'mp4',
        'mp3',
        'docx',
        'xlsx',
        'pptx',
        'epub',
        'exe',
        'dmg',
      ].includes(fileExtension)
    ) {
      return true;
    }

    return AVOID_KEYWORDS.some((keyword) => pathAndQuery.includes(keyword));
  } catch (_e) {
    return true; // Avoid invalid URLs
  }
}

/**
 * Validates if the target URL is on the same domain or subdomain.
 */
export function isInternalUrl(url: string, targetDomain: string): boolean {
  try {
    const parsed = new URL(url);
    const emailDomain = normalizeDomain(parsed.hostname);
    const cleanTarget = normalizeDomain(targetDomain);

    return emailDomain === cleanTarget || emailDomain.endsWith('.' + cleanTarget);
  } catch (_e) {
    return false;
  }
}

/**
 * Calculates a priority score for a URL.
 * Higher scores mean the page is more likely to contain contact information.
 */
export function getLinkPriority(url: string): number {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();

    // High priority: contact pages, team pages, about pages
    const high = ['contact', 'about', 'team', 'support', 'help'];
    if (high.some((keyword) => path.includes(keyword))) {
      return 2;
    }

    // Medium priority: terms, policies, partnerships, services
    const med = ['privacy', 'legal', 'terms', 'partnership', 'sales', 'company', 'services'];
    if (med.some((keyword) => path.includes(keyword))) {
      return 1;
    }

    return 0;
  } catch (_e) {
    return -1;
  }
}

/**
 * Extracts and filters internal links from an HTML document.
 * Returns URLs sorted by their priority score (highest first).
 */
export function extractAndFilterLinks(
  html: string,
  baseUrl: string,
  targetDomain: string,
): string[] {
  const links = new Set<string>();

  try {
    const $ = load(html);

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href')?.trim();
      if (!href) return;

      try {
        // Resolve relative links against base URL
        const resolvedUrl = new URL(href, baseUrl);

        // Remove hash / fragment to prevent duplicate crawling of same page
        resolvedUrl.hash = '';

        const normalized = normalizeUrl(resolvedUrl.toString());

        if (normalized && isInternalUrl(normalized, targetDomain) && !shouldAvoidUrl(normalized)) {
          links.add(normalized);
        }
      } catch (_e) {
        // Ignore parsing errors for individual bad hrefs
      }
    });
  } catch (_e) {
    // Ignore html parse errors
  }

  // Convert to array and sort by priority score
  return Array.from(links).sort((a, b) => getLinkPriority(b) - getLinkPriority(a));
}
