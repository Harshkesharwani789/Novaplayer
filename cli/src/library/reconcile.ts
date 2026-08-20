import { promises as fs } from "node:fs";
import type { Library } from "./library";
import { fileExists, findDuplicates } from "./drift";

export interface ReconcileResult {
  /** Dead index entries removed (file was gone from disk). */
  prunedMissing: number;
  /** Duplicate entries removed (same song saved more than once). */
  mergedDuplicates: number;
  /** Redundant audio files deleted from disk. */
  deletedFiles: number;
}

/**
 * Silent library hygiene: drop entries whose audio file is gone, and collapse
 * duplicate songs down to a single copy (deleting the redundant files). Mutates
 * the library in place; never touches the network.
 *
 * Deletion is deliberately scoped to files NovaPlayer itself downloaded — see
 * the comment on step 2. Nothing here ever deletes a file the user brought.
 */
export async function reconcileLibrary(
  library: Library,
  existsCache?: Map<string, boolean>,
): Promise<ReconcileResult> {
  let prunedMissing = 0;
  let mergedDuplicates = 0;
  let deletedFiles = 0;

  // 1) Prune entries whose file no longer exists on disk.
  for (const t of library.all()) {
    if (!(await fileExists(t.filePath, existsCache))) {
      await library.remove(t.id);
      prunedMissing++;
    }
  }

  // 2) Collapse duplicate songs among the survivors (all still on disk).
  //
  // ONLY app-downloaded tracks take part. A track with source "local" came from
  // `novaplayer scan <dir>`: the app indexed a file the user already owned,
  // anywhere on their disk, and did not create. Two of those can legitimately
  // share an artist+title — a studio cut and a live version, the same song on
  // an album and on a greatest-hits, a radio edit and an album version — and
  // are NOT duplicates. Deleting one would destroy a file the app has no
  // business touching, silently and with no undo. Byte-identical local
  // duplicates are already handled at scan time by the content fingerprint,
  // which is the only signal strong enough to justify removing a file.
  const managed = library.all().filter((t) => t.source !== "local");
  for (const group of findDuplicates(managed)) {
    const sorted = [...group.tracks].sort((a, b) =>
      a.addedAt.localeCompare(b.addedAt),
    );
    const keptPath = sorted[0]!.filePath;
    for (const dup of sorted.slice(1)) {
      // Don't delete a file the kept copy also points to.
      if (dup.filePath && dup.filePath !== keptPath) {
        try {
          await fs.rm(dup.filePath, { force: true });
          existsCache?.set(dup.filePath, false);
          deletedFiles++;
        } catch {
          // locked or undeletable; the index entry still goes.
        }
      }
      await library.remove(dup.id);
      mergedDuplicates++;
    }
  }

  return { prunedMissing, mergedDuplicates, deletedFiles };
}
