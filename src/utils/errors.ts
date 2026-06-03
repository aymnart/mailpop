export class MailPopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class PageLoadError extends MailPopError {
  public statusCode?: number;
  public url: string;

  constructor(message: string, url: string, statusCode?: number) {
    super(message);
    this.url = url;
    this.statusCode = statusCode;
  }
}

export class RateLimitError extends PageLoadError {
  constructor(message: string, url: string) {
    super(message, url, 429);
  }
}

export class CrawlTimeoutError extends MailPopError {
  public domain: string;
  public durationMs: number;

  constructor(message: string, domain: string, durationMs: number) {
    super(message);
    this.domain = domain;
    this.durationMs = durationMs;
  }
}
