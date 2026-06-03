import { normalizeDomain } from './normalize.js';
import { config } from '../config.js';
import dns from 'dns/promises';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const REJECTED_PREFIXES = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'abuse',
  'security',
  'spam',
];

const REJECTED_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'testing.com',
  'domain.com',
  'tempmail.com',
  'yopmail.com',
  'mailinator.com',
  'sharklasers.com',
  'guerrillamail.com',
  'dispostable.com',
  'getairmail.com',
  '10minutemail.com',
];

/**
 * Validates whether a string has a valid email format and is not in the blacklist.
 * @param email - The email to check.
 */
export function isValidEmail(email: string): boolean {
  if (!EMAIL_REGEX.test(email)) {
    return false;
  }

  const parts = email.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const localPart = parts[0].toLowerCase().trim();
  const domainPart = parts[1].toLowerCase().trim();

  // Reject blacklisted prefixes
  if (REJECTED_PREFIXES.includes(localPart)) {
    return false;
  }

  // Reject user-configured excluded prefixes (matches exact, or delimited by -, ., _, +)
  const isExcluded = config.excludePrefixes.some((prefix) => {
    const escaped = prefix.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(^|[-._+])` + escaped + `($|[-._+])`, 'i');
    return regex.test(localPart);
  });

  if (isExcluded) {
    return false;
  }

  // Reject blacklisted domains
  if (REJECTED_DOMAINS.includes(domainPart)) {
    return false;
  }

  // Reject Sentry ingest reporting domains
  if (domainPart.includes('sentry.io')) {
    return false;
  }

  // Simple heuristics for temporary or obviously fake emails
  if (
    localPart.startsWith('noreply') ||
    localPart.startsWith('no-reply') ||
    localPart.startsWith('donotreply')
  ) {
    return false;
  }

  if (
    domainPart.includes('tempmail') ||
    domainPart.includes('mailinator') ||
    domainPart.includes('yopmail') ||
    domainPart.startsWith('test.') ||
    domainPart === 'test'
  ) {
    return false;
  }

  // Exclude obviously invalid top level domains
  const tld = domainPart.split('.').pop();
  if (tld && (tld === 'local' || tld === 'temp' || tld === 'example')) {
    return false;
  }

  return true;
}

/**
 * Checks if the email domain matches the target company domain.
 * @param email - The email to verify.
 * @param targetDomainOrUrl - The target website/domain.
 */
export function isDomainMatch(email: string, targetDomainOrUrl: string): boolean {
  const parts = email.split('@');
  if (parts.length !== 2) {
    return false;
  }
  const emailDomain = normalizeDomain(parts[1]);
  const targetDomain = normalizeDomain(targetDomainOrUrl);

  return emailDomain === targetDomain || emailDomain.endsWith('.' + targetDomain);
}

/**
 * Verifies if a fallback email is valid using Disify API with local DNS MX lookup fallback.
 * @param email - The fallback email to verify.
 */
export async function verifyEmailFallback(email: string): Promise<boolean> {
  if (!isValidEmail(email)) {
    return false;
  }

  const domain = email.split('@')[1];
  if (!domain) {
    return false;
  }

  // 1. Try Disify email verification API
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://api.disify.com/v1/email/${email}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { format: boolean; disposable: boolean; dns: boolean };
      // Email is valid if format matches, not disposable, and DNS MX records exist
      return data.format && !data.disposable && data.dns;
    }
  } catch (_e) {
    // If API fails, fall back to direct DNS check
  }

  // 2. DNS MX records lookup fallback
  try {
    const mx = await dns.resolveMx(domain);
    return mx && mx.length > 0;
  } catch (_e) {
    return false;
  }
}
