import { access, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const projectRoot = process.cwd();
const standaloneRoot = join(projectRoot, ".next", "standalone");

async function copyDirectory(source, target, required) {
  try {
    await access(source);
  } catch (error) {
    if (required) throw error;
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

await copyDirectory(join(projectRoot, ".next", "static"), join(standaloneRoot, ".next", "static"), true);
await copyDirectory(join(projectRoot, "public"), join(standaloneRoot, "public"), false);
