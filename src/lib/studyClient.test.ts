import { describe, expect, it } from "vitest";

import { decodeBase64Bytes } from "./studyClient";

describe("decodeBase64Bytes", () => {
  it("restores raw texture bytes from the server payload", () => {
    expect([...decodeBase64Bytes("AAECA/8=")]).toEqual([0, 1, 2, 3, 255]);
  });
});
