import { describe, expect, it } from "vitest";

import { SCENE_BACKGROUND_CSS_VARIABLE, readSceneBackgroundColor } from "./sceneTheme";

describe("readSceneBackgroundColor", () => {
  it("reads and trims the shared CSS background variable", () => {
    const styles = {
      getPropertyValue: (name: string) => name === SCENE_BACKGROUND_CSS_VARIABLE ? "  #53ffba  " : ""
    };

    expect(readSceneBackgroundColor(styles)).toBe("#53ffba");
  });

  it("rejects a missing scene background variable", () => {
    const styles = { getPropertyValue: () => "" };

    expect(() => readSceneBackgroundColor(styles)).toThrow(SCENE_BACKGROUND_CSS_VARIABLE);
  });
});
