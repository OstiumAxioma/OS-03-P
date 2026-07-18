import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTemporaryDirectory<T>(work: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "threevtk-"));

  try {
    return await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
