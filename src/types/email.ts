export type EmailType = 'role' | 'personal' | 'automated';

export interface EmailMetadata {
  sourceUrl: string;
  sourceType:
    | 'text'
    | 'mailto'
    | 'footer'
    | 'header'
    | 'script'
    | 'meta'
    | 'json_ld'
    | 'obfuscated';
  pageTitle: string;
  discoveryTimestamp: string;
  crawlDurationMs: number;
}

export interface DiscoveredEmail {
  email: string;
  emailSource: string;
  emailType: EmailType;
  confidenceScore: number;
  discoveryMethod:
    | 'contact-page'
    | 'about-page'
    | 'footer'
    | 'header'
    | 'sitemap'
    | 'general-page'
    | 'obscure-js'
    | 'mailto-link';
  metadata: EmailMetadata;
}

export interface ScoredEmail {
  email: string;
  type: EmailType;
  baseScore: number;
  confidenceScore: number;
  sourceUrl: string;
  discoveryMethod: DiscoveredEmail['discoveryMethod'];
  metadata: EmailMetadata;
}
