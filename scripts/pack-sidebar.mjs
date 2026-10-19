import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sidebar = resolve(root, "sidebar-app");
const { version } = JSON.parse(readFileSync(resolve(sidebar, "package.json"), "utf8"));

execFileSync("npm", ["run", "pack"], { cwd: sidebar, stdio: "inherit" });
const destination = resolve(root, "public", "downloads", `freshqa-sidebar-v${version}.zip`);
const latest = resolve(root, "public", "downloads", "freshqa-sidebar-latest.zip");
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(resolve(sidebar, "dist", "sidebar-app.zip"), destination);
copyFileSync(destination, latest);
console.log(`Ready to download: ${destination}`);
