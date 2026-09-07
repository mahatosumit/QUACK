import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";

export function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Crash-safe replacement for `writeFile(filePath, data)`: writes to a sibling
 * temp file first, then renames it over the destination. A process crash
 * mid-write leaves only the temp file half-written; the destination is never
 * observed in a truncated/partial state.
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmpPath, data, "utf8");
  await renameWithTransientRetry(tmpPath, filePath);
}

async function renameWithTransientRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
