import { delay } from './delay.js';

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Retries an asynchronous operation with exponential backoff.
 * @param operation - The asynchronous function to execute.
 * @param options - Configuration for retry count and delays.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      const err = error instanceof Error ? error : new Error(String(error));

      if (attempt > options.maxRetries) {
        throw err;
      }

      const backoffDelay = Math.min(
        options.initialDelayMs * Math.pow(2, attempt - 1),
        options.maxDelayMs,
      );

      // Add a small jitter (+/- 10%) to prevent thundering herd
      const jitter = (Math.random() - 0.5) * 0.2 * backoffDelay;
      const finalDelay = Math.max(0, backoffDelay + jitter);

      if (options.onRetry) {
        options.onRetry(err, attempt);
      }

      await delay(finalDelay);
    }
  }
}
