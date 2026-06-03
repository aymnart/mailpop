import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { config } from './config.js';
import { Logger } from './logger.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

export class Cache {
  private cacheDir: string;

  constructor() {
    this.cacheDir = config.cacheDir;
  }

  /**
   * Generates a unique, file-safe cache path for a given key.
   */
  private getCachePath(key: string): string {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return path.join(this.cacheDir, `${hash}.json`);
  }

  /**
   * Retrieves an item from the cache. Returns null if missing or expired.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cachePath = this.getCachePath(key);
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry<T>;

      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        // Expired cache entry, clean it up
        await fs.unlink(cachePath);
        return null;
      }

      return entry.value;
    } catch (_e) {
      // Cache miss or error reading
      return null;
    }
  }

  /**
   * Sets an item in the cache with an optional TTL (Time To Live).
   */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cachePath = this.getCachePath(key);

      const entry: CacheEntry<T> = {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
      };

      await fs.writeFile(cachePath, JSON.stringify(entry), 'utf-8');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await Logger.error(
        'cache-write',
        undefined,
        undefined,
        `Failed to write cache key '${key}': ${errorMsg}`,
      );
    }
  }

  /**
   * Deletes a cache entry.
   */
  async delete(key: string): Promise<void> {
    try {
      const cachePath = this.getCachePath(key);
      await fs.unlink(cachePath);
    } catch (_e) {
      // Ignore errors (e.g. key didn't exist)
    }
  }

  /**
   * Clears the entire cache directory.
   */
  async clear(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      await Logger.info(
        'cache-clear',
        undefined,
        undefined,
        'Cache directory deleted successfully.',
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await Logger.error('cache-clear', undefined, undefined, `Failed to clear cache: ${errorMsg}`);
    }
  }
}
