import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/studies", () => {
  it("returns a structured 400 response when no files are supplied", async () => {
    const form = new FormData();
    form.set("kind", "dicom");
    const request = new Request("http://localhost/api/studies", { method: "POST", body: form });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "NO_FILES",
      message: "Select at least one medical image file."
    });
  });
});
