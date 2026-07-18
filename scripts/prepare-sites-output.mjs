import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve(process.cwd(), ".openai", "hosting.json");
const destination = resolve(process.cwd(), "dist", ".openai", "hosting.json");

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
