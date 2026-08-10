import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDirectory = resolve(projectRoot, "dist");
const releaseDirectory = resolve(projectRoot, "release");

async function collectFiles(directory, archive = {}) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolutePath, archive);
      continue;
    }
    if (!entry.isFile()) continue;

    // Chrome expects manifest.json at the archive root, so paths are always
    // relative to dist rather than including a top-level dist directory.
    const archivePath = relative(distDirectory, absolutePath).split("\\").join("/");
    archive[archivePath] = new Uint8Array(await readFile(absolutePath));
  }

  return archive;
}

const manifest = JSON.parse(await readFile(resolve(distDirectory, "manifest.json"), "utf8"));
if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version || "")) {
  throw new Error("dist/manifest.json contains an invalid Chrome extension version");
}

const files = await collectFiles(distDirectory);
if (!files["manifest.json"] || !files[manifest.background?.service_worker] || !files[manifest.side_panel?.default_path]) {
  throw new Error("dist is missing manifest.json, the service worker, or the side-panel entry point");
}

const archiveBytes = zipSync(files, { level: 9 });
const archiveName = `mass-friends-remover-facebook-v${manifest.version}.zip`;
const archivePath = resolve(releaseDirectory, archiveName);
await mkdir(releaseDirectory, { recursive: true });
await writeFile(archivePath, archiveBytes);

const unpacked = unzipSync(archiveBytes);
if (!unpacked["manifest.json"] || Object.keys(unpacked).some(path => path.startsWith("dist/"))) {
  throw new Error("release archive has an invalid Chrome Web Store layout");
}

console.log(`Chrome Web Store package: release/${archiveName}`);
console.log(`Packaged ${Object.keys(files).length} files (${archiveBytes.byteLength.toLocaleString()} bytes)`);
