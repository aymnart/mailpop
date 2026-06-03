import { load, Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { DiscoveredEmail, EmailMetadata, EmailType } from './types/email.js';
import { normalizeEmail } from './utils/normalize.js';
import { isValidEmail } from './utils/validators.js';

// Standard email regex for searching inside strings
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}\b/g;

// Obfuscated email regex matching "name [at] domain [dot] com", "name(at)domain(dot)com", "name AT domain DOT com"
const OBFUSCATED_REGEX =
  /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\s+dot\s+)\s*([a-zA-Z]{2,10})\b/gi;

// Base64 candidate regex for extracting potential base64 encoded strings
const BASE64_CANDIDATE_REGEX = /\b[a-zA-Z0-9+/]{12,80}={0,2}\b/g;

/**
 * Decodes a Cloudflare email protection hex string.
 */
export function decodeCloudflareEmail(hex: string): string {
  try {
    let email = '';
    const r = parseInt(hex.substring(0, 2), 16);
    for (let i = 2; i < hex.length; i += 2) {
      const c = parseInt(hex.substring(i, i + 2), 16) ^ r;
      email += String.fromCharCode(c);
    }
    return email;
  } catch (_e) {
    return '';
  }
}

/**
 * Decodes HTML Unicode entities (e.g. &#x63; or &#99;).
 * Cheerio generally decodes these, but this serves as a fallback.
 */
export function decodeUnicodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/**
 * Attempts to extract Base64 encoded email addresses.
 */
export function extractBase64Emails(text: string): string[] {
  const emails: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex index
  BASE64_CANDIDATE_REGEX.lastIndex = 0;

  while ((match = BASE64_CANDIDATE_REGEX.exec(text)) !== null) {
    try {
      const decoded = Buffer.from(match[0], 'base64').toString('utf-8');
      const normalized = normalizeEmail(decoded);
      if (isValidEmail(normalized)) {
        emails.push(normalized);
      }
    } catch (_e) {
      // Not a valid base64 string or decode failed
    }
  }
  return emails;
}

/**
 * Maps a URL path to a discovery method / page type.
 */
function getDiscoveryMethod(url: string): DiscoveredEmail['discoveryMethod'] {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes('contact')) return 'contact-page';
    if (path.includes('about')) return 'about-page';
    if (path.includes('sitemap')) return 'sitemap';
    return 'general-page';
  } catch (_e) {
    return 'general-page';
  }
}

/**
 * Classifies an email as 'role', 'personal', or 'automated'.
 */
export function classifyEmailType(email: string): EmailType {
  const localPart = email.split('@')[0].toLowerCase();

  const rolePrefixes = [
    'contact',
    'info',
    'hello',
    'support',
    'sales',
    'partnerships',
    'partnership',
    'business',
    'team',
    'founder',
    'ceo',
    'media',
    'press',
    'jobs',
    'careers',
    'admin',
    'office',
    'help',
    'inquiries',
    'inquiry',
    'hi',
    'welcome',
    'hr',
    'marketing',
    'privacy',
    'legal',
    'billing',
    'finance',
  ];

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
    'notifications',
    'alert',
    'alerts',
  ];

  if (
    automatedPrefixes.some((prefix) => localPart === prefix || localPart.startsWith(prefix + '-'))
  ) {
    return 'automated';
  }

  if (rolePrefixes.some((prefix) => localPart === prefix || localPart.startsWith(prefix + '.'))) {
    return 'role';
  }

  return 'personal';
}

/**
 * Extract text from a cheerio element, inserting spaces between elements
 * to prevent adjacent tags from concatenating their text content.
 */
export function extractTextWithSpaces(elem: Cheerio<AnyNode>, $: CheerioAPI): string {
  if (!elem || elem.length === 0) return '';
  const htmlParts: string[] = [];
  elem.each((_: number, el: AnyNode) => {
    htmlParts.push($(el).html() || '');
  });
  const html = htmlParts.join(' ');
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  return decodeUnicodeEntities(cleanHtml.replace(/<[^>]+>/g, ' '));
}

/**
 * Extracts all unique emails from a given HTML string and URL.
 */
export function extractEmails(
  html: string,
  url: string,
  pageTitle: string,
  crawlDurationMs: number,
): DiscoveredEmail[] {
  const discovered: Map<string, DiscoveredEmail> = new Map();
  const $ = load(html);
  const discoveryMethod = getDiscoveryMethod(url);

  const addEmail = (
    rawEmail: string,
    sourceType: EmailMetadata['sourceType'],
    obfuscatedMethod?: string,
  ): void => {
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      return;
    }

    const type = classifyEmailType(email);
    const timestamp = new Date().toISOString();

    const metadata: EmailMetadata = {
      sourceUrl: url,
      sourceType,
      pageTitle,
      discoveryTimestamp: timestamp,
      crawlDurationMs,
    };

    // Calculate preliminary confidence score based on extraction details
    // Final confidence is refined in scorer.ts
    let initialConfidence = 60;
    if (sourceType === 'footer' || sourceType === 'header') {
      initialConfidence = 85;
    } else if (sourceType === 'mailto') {
      initialConfidence = 90;
    } else if (sourceType === 'obfuscated') {
      initialConfidence = 50;
    } else if (sourceType === 'script') {
      initialConfidence = 40;
    }

    if (obfuscatedMethod) {
      initialConfidence -= 10; // Obfuscated discovery has slightly lower confidence
    }

    const item: DiscoveredEmail = {
      email,
      emailSource: url,
      emailType: type,
      confidenceScore: Math.max(10, Math.min(100, initialConfidence)),
      discoveryMethod:
        obfuscatedMethod === 'cloudflare'
          ? 'obscure-js'
          : sourceType === 'mailto'
            ? 'mailto-link'
            : discoveryMethod,
      metadata,
    };

    const existing = discovered.get(email);
    if (!existing || existing.confidenceScore < item.confidenceScore) {
      discovered.set(email, item);
    }
  };

  // 1. Cloudflare email protection decoding
  // Search tags containing cfemail
  $('[data-cfemail]').each((_, el) => {
    const hex = $(el).attr('data-cfemail');
    if (hex) {
      const email = decodeCloudflareEmail(hex);
      if (email) addEmail(email, 'obfuscated', 'cloudflare');
    }
  });

  // Search links containing cloudflare email-protection path
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\/cdn-cgi\/l\/email-protection#([a-fA-F0-9]+)/);
    if (match && match[1]) {
      const email = decodeCloudflareEmail(match[1]);
      if (email) addEmail(email, 'obfuscated', 'cloudflare');
    }
  });

  // 2. Mailto links
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      addEmail(href, 'mailto');
    }
  });

  // 3. Header section extraction
  const headerElem = $('header, [id*="header"], [class*="header"]');
  if (headerElem.length > 0) {
    const headerText = extractTextWithSpaces(headerElem, $);
    let match: RegExpExecArray | null;
    EMAIL_REGEX.lastIndex = 0;
    while ((match = EMAIL_REGEX.exec(headerText)) !== null) {
      addEmail(match[0], 'header');
    }
  }

  // 4. Footer section extraction
  const footerElem = $('footer, [id*="footer"], [class*="footer"]');
  if (footerElem.length > 0) {
    const footerText = extractTextWithSpaces(footerElem, $);
    let match: RegExpExecArray | null;
    EMAIL_REGEX.lastIndex = 0;
    while ((match = EMAIL_REGEX.exec(footerText)) !== null) {
      addEmail(match[0], 'footer');
    }
  }

  // 5. Meta tags
  $('meta').each((_, el) => {
    const content = $(el).attr('content');
    if (content) {
      const cleanedContent = decodeUnicodeEntities(content);
      let match: RegExpExecArray | null;
      EMAIL_REGEX.lastIndex = 0;
      while ((match = EMAIL_REGEX.exec(cleanedContent)) !== null) {
        addEmail(match[0], 'meta');
      }
    }
  });

  // 6. Scripts (JSON-LD, Inline JavaScript)
  $('script').each((_, el) => {
    const scriptContent = $(el).html();
    if (scriptContent) {
      const decodedScript = decodeUnicodeEntities(scriptContent);

      // Look for standard emails in scripts
      let match: RegExpExecArray | null;
      EMAIL_REGEX.lastIndex = 0;
      while ((match = EMAIL_REGEX.exec(decodedScript)) !== null) {
        addEmail(match[0], 'script');
      }

      // Look for obfuscated pattern emails in scripts
      OBFUSCATED_REGEX.lastIndex = 0;
      let obfMatch: RegExpExecArray | null;
      while ((obfMatch = OBFUSCATED_REGEX.exec(decodedScript)) !== null) {
        addEmail(`${obfMatch[1]}@${obfMatch[2]}.${obfMatch[3]}`, 'script', 'text-obfuscation');
      }

      // Look for base64 encoded emails in scripts
      const base64Emails = extractBase64Emails(decodedScript);
      for (const b64Email of base64Emails) {
        addEmail(b64Email, 'script', 'base64');
      }
    }
  });

  // 7. Visible Body Text & Obfuscated matches in body
  const bodyText = extractTextWithSpaces($('body'), $);

  // Standard matches in body text
  let bodyMatch: RegExpExecArray | null;
  EMAIL_REGEX.lastIndex = 0;
  while ((bodyMatch = EMAIL_REGEX.exec(bodyText)) !== null) {
    addEmail(bodyMatch[0], 'text');
  }

  // Obfuscated matches in body text
  let obfBodyMatch: RegExpExecArray | null;
  OBFUSCATED_REGEX.lastIndex = 0;
  while ((obfBodyMatch = OBFUSCATED_REGEX.exec(bodyText)) !== null) {
    addEmail(
      `${obfBodyMatch[1]}@${obfBodyMatch[2]}.${obfBodyMatch[3]}`,
      'text',
      'text-obfuscation',
    );
  }

  return Array.from(discovered.values());
}
