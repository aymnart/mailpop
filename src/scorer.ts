import { DiscoveredEmail, EmailType } from './types/email.js';
import { isDomainMatch } from './utils/validators.js';
import { normalizeDomain } from './utils/normalize.js';

const PUBLIC_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'mail.com',
  'zoho.com',
  'protonmail.com',
  'yandex.com',
  'gmx.com',
  'live.com',
  'me.com',
  'msn.com',
];

/**
 * Returns a priority base score (0 to 100) for the email prefix.
 */
export function getEmailBaseScore(email: string): { score: number; type: EmailType } {
  const localPart = email.split('@')[0].toLowerCase();

  const roleScores: { prefixes: string[]; score: number }[] = [
    { prefixes: ['contact'], score: 100 },
    { prefixes: ['info'], score: 95 },
    { prefixes: ['hello'], score: 90 },
    { prefixes: ['support', 'help'], score: 85 },
    { prefixes: ['sales', 'partnership', 'partnerships', 'bizdev', 'business'], score: 80 },
    { prefixes: ['team', 'office', 'admin'], score: 70 },
    { prefixes: ['founder', 'ceo', 'co-founder', 'owner'], score: 65 },
    { prefixes: ['media', 'press', 'marketing', 'pr'], score: 55 },
    { prefixes: ['jobs', 'careers', 'hr', 'recruiting'], score: 45 },
  ];

  // Check role-based scores
  for (const group of roleScores) {
    if (group.prefixes.some((p) => localPart === p || localPart.startsWith(p + '.'))) {
      return { score: group.score, type: 'role' };
    }
  }

  // Automated keywords check
  const automatedPrefixes = [
    'noreply',
    'no-reply',
    'donotreply',
    'do-not-reply',
    'mailer-daemon',
    'postmaster',
    'abuse',
    'security',
    'spam',
    'bot',
    'system',
    'notification',
  ];
  if (automatedPrefixes.some((p) => localPart === p || localPart.startsWith(p + '-'))) {
    return { score: 0, type: 'automated' };
  }

  // If not role or automated, it's likely a personal/employee email (e.g. john.doe@)
  return { score: 40, type: 'personal' };
}

/**
 * Evaluates the confidence score (0 to 100) for a discovered email based on various signals.
 * @param discovered - The email discovery object.
 * @param targetDomain - The target domain we are crawling.
 * @param occurrences - Number of times this email was found across different pages of the site.
 */
export function scoreDiscoveredEmail(
  discovered: DiscoveredEmail,
  targetDomain: string,
  occurrences: number = 1,
): number {
  let score = discovered.confidenceScore; // Start with the extraction score (40 to 90)

  // 1. Page Location modifier
  const method = discovered.discoveryMethod;
  if (method === 'contact-page') {
    score += 10;
  } else if (method === 'about-page') {
    score += 5;
  } else if (method === 'sitemap') {
    score += 5;
  }

  // 2. Email Location modifier
  const sourceType = discovered.metadata.sourceType;
  if (sourceType === 'mailto') {
    score += 5;
  } else if (sourceType === 'footer') {
    score += 5;
  } else if (sourceType === 'script') {
    score -= 10; // lower confidence for script elements
  } else if (sourceType === 'obfuscated') {
    score -= 5;
  }

  // 3. Domain Match modifiers (Crucial for cold outreach safety)
  const emailParts = discovered.email.split('@');
  if (emailParts.length === 2) {
    const emailDomain = normalizeDomain(emailParts[1]);
    const normalizedTarget = normalizeDomain(targetDomain);

    if (emailDomain === normalizedTarget || emailDomain.endsWith('.' + normalizedTarget)) {
      // Direct or subdomain match is excellent
      score += 10;
    } else if (PUBLIC_DOMAINS.includes(emailDomain)) {
      // Gmail/Yahoo is common for small businesses, but slightly less authoritative than matching domain
      score -= 15;
    } else {
      // Serious penalty for matching an entirely different corporate domain (risk of scrapers picking up CDNs/analytics domains)
      score -= 50;
    }
  }

  // 4. Frequency/Occurrences modifier
  if (occurrences > 1) {
    score += Math.min(10, occurrences * 2); // Boost if found on multiple pages
  }

  // Clamp score strictly between 10 and 100 (if no domain matches and penalized, could drop low, but 10 is floor)
  const finalScore = Math.max(10, Math.min(100, score));
  return Math.round(finalScore);
}

/**
 * Compares two discovered emails and returns the better one based on selection rules:
 * 1. Highest confidence score.
 * 2. Highest base/priority score (role-based order).
 * 3. Domain-matching over external.
 */
export function selectBestEmail(
  emails: DiscoveredEmail[],
  targetDomain: string,
  occurrenceCounts: Record<string, number>,
): DiscoveredEmail | null {
  if (emails.length === 0) {
    return null;
  }

  // Pre-calculate scores for all emails
  const scoredList = emails.map((email) => {
    const occurrences = occurrenceCounts[email.email] || 1;
    const confidence = scoreDiscoveredEmail(email, targetDomain, occurrences);
    const { score: baseScore } = getEmailBaseScore(email.email);
    const matchesDomain = isDomainMatch(email.email, targetDomain);

    return {
      email,
      confidence,
      baseScore,
      matchesDomain,
    };
  });

  // Sort according to priority rules
  scoredList.sort((a, b) => {
    // 1. Highest Confidence Score
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    // 2. Highest Base Score (role priority contact > info > hello ...)
    if (b.baseScore !== a.baseScore) {
      return b.baseScore - a.baseScore;
    }

    // 3. Domain Matching
    if (a.matchesDomain && !b.matchesDomain) return -1;
    if (!a.matchesDomain && b.matchesDomain) return 1;

    // 4. Role type preference
    if (a.email.emailType === 'role' && b.email.emailType !== 'role') return -1;
    if (a.email.emailType !== 'role' && b.email.emailType === 'role') return 1;

    return 0;
  });

  const best = scoredList[0];

  // Update confidence score to the calculated final score
  best.email.confidenceScore = best.confidence;

  return best.email;
}
