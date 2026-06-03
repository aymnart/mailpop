import * as fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import * as csv from 'fast-csv';
import { InputCsvRow, OutputCsvRow, CheckpointData } from './types/csv.js';
import { Logger } from './logger.js';

/**
 * Creates an async generator to stream rows from an input CSV file.
 * This guarantees memory-efficient processing for up to 50k+ rows.
 * @param filePath - Path to the input CSV file.
 */
export async function* readCsvGenerator(
  filePath: string,
): AsyncGenerator<{ row: InputCsvRow; index: number }> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input CSV file not found: ${filePath}`);
  }

  const stream = fs.createReadStream(filePath).pipe(
    csv.parse({
      headers: true,
      trim: true,
      discardUnmappedColumns: false,
    }),
  );

  let index = 0;
  for await (const row of stream) {
    yield { row: row as InputCsvRow, index };
    index++;
  }
}

/**
 * Reads only the header row of a CSV file.
 * Helper to dynamically extract the input schema.
 */
export async function getCsvHeaders(filePath: string): Promise<string[]> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input CSV file not found: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    const parser = csv.parse({ headers: true });

    stream
      .pipe(parser)
      .on('headers', (headers: string[]) => {
        stream.destroy();
        resolve(headers);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Appends a single row to the output CSV file in a thread-safe and escaped manner.
 * @param filePath - Path to the output CSV file.
 * @param row - Output row data.
 * @param headers - Complete ordered headers array for output alignment.
 * @param writeHeader - Whether to prefix the row with a header line.
 */
export async function appendCsvRow(
  filePath: string,
  row: OutputCsvRow,
  headers: string[],
  writeHeader: boolean = false,
): Promise<void> {
  const dir = path.dirname(filePath);
  try {
    await fsPromises.mkdir(dir, { recursive: true });
  } catch (_e) {
    // Ignore folder creation errors if it already exists
  }

  const csvLine = await new Promise<string>((resolve, reject) => {
    csv
      .writeToString([row], {
        headers: headers,
        includeEndRowDelimiter: true,
        writeHeaders: writeHeader,
      })
      .then(resolve)
      .catch(reject);
  });

  await fsPromises.appendFile(filePath, csvLine, 'utf-8');
}

/**
 * Loads checkpoint progress from disk. Returns null if missing/corrupt.
 */
export async function loadCheckpoint(filePath: string): Promise<CheckpointData | null> {
  try {
    const content = await fsPromises.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as CheckpointData;
    if (typeof data.lastProcessedIndex === 'number' && Array.isArray(data.completedUrls)) {
      return data;
    }
    return null;
  } catch (_e) {
    return null;
  }
}

/**
 * Saves checkpoint progress to disk.
 */
export async function saveCheckpoint(filePath: string, data: CheckpointData): Promise<void> {
  const dir = path.dirname(filePath);
  try {
    await fsPromises.mkdir(dir, { recursive: true });
    await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await Logger.error(
      'checkpoint-save-fail',
      undefined,
      undefined,
      `Failed to save checkpoint: ${errorMsg}`,
    );
  }
}

/**
 * Deletes the checkpoint file (used upon successful completion of run).
 */
export async function clearCheckpoint(filePath: string): Promise<void> {
  try {
    await fsPromises.unlink(filePath);
  } catch (_e) {
    // Ignore if checkpoint file doesn't exist
  }
}
