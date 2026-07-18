export const SCENE_BACKGROUND_CSS_VARIABLE = "--scene-background";

export type CssVariableReader = {
  getPropertyValue: (name: string) => string;
};

export function readSceneBackgroundColor(styles: CssVariableReader): string {
  const color = styles.getPropertyValue(SCENE_BACKGROUND_CSS_VARIABLE).trim();
  if (!color) {
    throw new Error(`Missing CSS variable ${SCENE_BACKGROUND_CSS_VARIABLE}.`);
  }
  return color;
}
