export type SyncDatabase = {
  rpc(name: string, args?: Record<string, unknown>): Promise<unknown>;
};
export type SyncSheetAdapter = {
  ensureTab(tab: string, headers: string[]): Promise<void>;
  readRows(tab: string, columns: number): Promise<unknown[][]>;
  writeRows(tab: string, columns: number, updates: {row: number; values: unknown[]}[]): Promise<void>;
};
export type BoundedSyncResult = {
  processed: number;
  failed: number;
  busy: boolean;
  timeLimited: boolean;
  idle?: boolean;
  code: string | null;
};
export function runBoundedSync(options: {
  db: SyncDatabase;
  sheets: SyncSheetAdapter;
  cleanupDb?: SyncDatabase;
  owner: string;
  spreadsheetId: string;
  maxJobs?: number;
  budgetMs?: number;
  now?: () => number;
}): Promise<BoundedSyncResult>;
