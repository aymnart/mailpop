/**
 * Delays execution for a specified number of milliseconds.
 * @param ms - Number of milliseconds to delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delays execution for a randomized duration between min and max milliseconds.
 * @param min - Minimum delay in milliseconds.
 * @param max - Maximum delay in milliseconds.
 */
export function getRandomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return delay(ms);
}
