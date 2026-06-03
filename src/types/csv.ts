export type InputCsvRow = Record<string, string>;
export type OutputCsvRow = Record<string, string>;

export interface CheckpointData {
  lastProcessedIndex: number;
  completedUrls: string[];
  timestamp: string;
}
