/**
 * Project. — GitSync (M5)
 *
 * Thin wrapper around `simple-git` that exposes the four operations needed
 * for M5 vault sync: init, status, commitAll, getLog.
 *
 * The module is designed to be safe — every method handles the "not a git repo"
 * case gracefully so callers never have to pre-check.
 */

import { simpleGit } from 'simple-git';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SimpleGitModule = any;

// ── Public types (canonical definition lives in src/types/git.ts) ─────────────

import type { GitStatusResult, GitCommitResult, GitLogEntry } from '../types/git.js';
export type { GitStatusResult, GitCommitResult, GitLogEntry };

// ── GitSync ──────────────────────────────────────────────────────────────────

export class GitSync {
  private sg: SimpleGitModule;

  constructor(private vaultRoot: string) {
    this.sg = simpleGit(vaultRoot, { baseDir: vaultRoot });
  }

  /** Returns true if the vault is inside a git repository */
  async isRepo(): Promise<boolean> {
    try {
      await this.sg.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialise a new git repository in the vault root (idempotent).
   * Also stages all files and creates an initial commit if the repo is fresh.
   */
  async init(): Promise<string> {
    const already = await this.isRepo();
    if (already) return 'Repository already initialised.';

    await this.sg.init();
    // Set a default user identity for the initial commit (local config only)
    await this.sg.addConfig('user.name', 'Project.', false, 'local');
    await this.sg.addConfig('user.email', 'project@local', false, 'local');
    await this.sg.add('.');
    const commit = await this.sg.commit('chore: init Project. vault');
    return `Initialised. First commit: ${commit.commit}`;
  }

  /**
   * Return the current git status of the vault.
   * Returns a safe default if the directory is not a git repo.
   */
  async status(): Promise<GitStatusResult> {
    const notRepo: GitStatusResult = {
      isRepo: false,
      branch: '',
      staged: [],
      modified: [],
      untracked: [],
      ahead: 0,
      behind: 0,
    };

    if (!(await this.isRepo())) return notRepo;

    const s = await this.sg.status();
    return {
      isRepo: true,
      branch: s.current ?? 'HEAD',
      staged: s.staged ?? [],
      modified: s.modified ?? [],
      untracked: s.not_added ?? [],
      ahead: s.ahead ?? 0,
      behind: s.behind ?? 0,
    };
  }

  /**
   * Stage all changes and create a commit.
   * If there is nothing to commit, returns a descriptive message without error.
   */
  async commitAll(message?: string): Promise<GitCommitResult> {
    if (!(await this.isRepo())) {
      throw new Error('Not a git repository. Call git_init first.');
    }

    const s = await this.sg.status();
    const hasChanges =
      (s.modified?.length ?? 0) +
      (s.not_added?.length ?? 0) +
      (s.deleted?.length ?? 0) +
      (s.staged?.length ?? 0) > 0;

    if (!hasChanges) {
      return { hash: '', branch: s.current ?? 'HEAD', summary: 'Nothing to commit.' };
    }

    await this.sg.add('.');
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const msg = message ?? `chore: vault sync — ${ts}`;
    const result = await this.sg.commit(msg);
    return {
      hash: result.commit,
      branch: result.branch,
      summary: msg,
    };
  }

  /**
   * Return the last `limit` commits (default 20).
   */
  async getLog(limit = 20): Promise<GitLogEntry[]> {
    if (!(await this.isRepo())) return [];

    const log = await this.sg.log({ maxCount: limit });
    return (log.all ?? []).map(
      (e: { hash: string; date: string; message: string; author_name: string }) => ({
        hash: e.hash.slice(0, 7),
        date: e.date,
        message: e.message,
        author: e.author_name,
      }),
    );
  }
}
