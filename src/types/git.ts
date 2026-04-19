/**
 * Project. — Git types (M5)
 */

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface GitCommitResult {
  hash: string;
  branch: string;
  summary: string;
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}
