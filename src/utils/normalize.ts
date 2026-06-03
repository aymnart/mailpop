/**
 * Normalizes an email address.
 * - Trims whitespace
 * - Converts to lowercase
 * - Removes 'mailto:' prefix if present
 * - Strips query parameters (e.g. ?subject=...)
 * - Strips hash/fragment (e.g. #footer)
 * - Removes any remaining URL encoded pieces or trailing dots
 */
export function normalizeEmail(email: string): string {
  let cleaned = email.trim().toLowerCase();

  if (cleaned.startsWith('mailto:')) {
    cleaned = cleaned.substring(7);
  }

  // Remove query parameters
  const qMarkIndex = cleaned.indexOf('?');
  if (qMarkIndex !== -1) {
    cleaned = cleaned.substring(0, qMarkIndex);
  }

  // Remove hash/fragment
  const hashIndex = cleaned.indexOf('#');
  if (hashIndex !== -1) {
    cleaned = cleaned.substring(0, hashIndex);
  }

  // URL decode if there are encoded characters
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch (_e) {
    // Keep as is if URL decoding fails
  }

  // Remove leading/trailing periods, quotes, or whitespace that might be captured in scraping
  cleaned = cleaned.replace(/^['".\s]+|['".\s]+$/g, '');

  return cleaned;
}

/**
 * Normalizes a URL to ensure it has a valid protocol and is formatted consistently.
 * @param url - The input URL string.
 */
export function normalizeUrl(url: string): string {
  let cleaned = url.trim();
  if (!cleaned) {
    return '';
  }
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = 'https://' + cleaned;
  }

  try {
    const parsed = new URL(cleaned);
    return parsed.href;
  } catch (_e) {
    return cleaned;
  }
}

/**
 * Normalizes a domain name from a URL or raw string.
 * @param domainOrUrl - Input string.
 */
export function normalizeDomain(domainOrUrl: string): string {
  let cleaned = domainOrUrl.trim().toLowerCase();
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      cleaned = parsed.hostname;
    } catch (_e) {
      // fallback regex
      cleaned = cleaned.replace(/^https?:\/\/(www\.)?/, '');
    }
  }
  cleaned = cleaned.replace(/^www\./i, '');
  const slashIdx = cleaned.indexOf('/');
  if (slashIdx !== -1) {
    cleaned = cleaned.substring(0, slashIdx);
  }
  return cleaned;
}

/**
 * Searches a raw CSV row record for columns representing the target website URL.
 * Scans case-insensitively for fields like 'website', 'url', 'domain', 'site', 'web'.
 */
export function findWebsiteInRow(row: Record<string, string>): string | null {
  const candidateKeys = ['website', 'url', 'domain', 'site', 'web'];
  for (const key of Object.keys(row)) {
    const normalizedKey = key.toLowerCase().trim();
    if (candidateKeys.some((candidate) => normalizedKey.includes(candidate))) {
      const val = row[key];
      if (val && val.trim()) {
        return val.trim();
      }
    }
  }
  return null;
}
