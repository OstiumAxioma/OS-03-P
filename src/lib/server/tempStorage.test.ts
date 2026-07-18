import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { withTemporaryDirectory } from "./tempStorage";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("withTemporaryDirectory", () => {
  it("removes the temporary directory after successful processing", async () => {
    let directory = "";

    await withTemporaryDirectory(async (path) => {
      directory = path;
      expect(await exists(path)).toBe(true);
    });

    expect(await exists(directory)).toBe(false);
  });

  it("removes the temporary directory when processing fails", async () => {
    let directory = "";

    await expect(
      withTemporaryDirectory(async (path) => {
        directory = path;
        throw new Error("decode failed");
      })
    ).rejects.toThrow("decode failed");

    expect(await exists(directory)).toBe(false);
  });
});
