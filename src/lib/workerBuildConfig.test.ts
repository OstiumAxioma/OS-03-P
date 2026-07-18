import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");

describe("production worker build", () => {
  it("targets Cloudflare Workers through the official vinext Vite integration", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8")
    ) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const viteConfigPath = resolve(projectRoot, "vite.config.ts");
    const wranglerConfigPath = resolve(projectRoot, "wrangler.jsonc");

    expect(existsSync(viteConfigPath)).toBe(true);
    expect(existsSync(wranglerConfigPath)).toBe(true);
    if (!existsSync(viteConfigPath) || !existsSync(wranglerConfigPath)) return;

    const viteConfig = readFileSync(viteConfigPath, "utf8");
    const wranglerConfig = readFileSync(wranglerConfigPath, "utf8");

    expect(packageJson.scripts?.build).toContain("vite build");
    expect(packageJson.devDependencies?.["@cloudflare/vite-plugin"]).toBeDefined();
    expect(packageJson.devDependencies?.wrangler).toBeDefined();
    expect(viteConfig).toContain('from "@cloudflare/vite-plugin"');
    expect(viteConfig).toContain("cloudflare({");
    expect(viteConfig).toContain('viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }');
    expect(wranglerConfig).toContain('"compatibility_flags": ["nodejs_compat"]');
    expect(wranglerConfig).toContain('"main": "vinext/server/fetch-handler"');
    expect(wranglerConfig).toContain('"directory": "dist/client"');
  });
});
