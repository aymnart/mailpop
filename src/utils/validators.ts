import { normalizeDomain } from './normalize.js';

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

  // Reject blacklisted domains
  if (REJECTED_DOMAINS.includes(domainPart)) {
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
