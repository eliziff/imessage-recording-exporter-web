import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
if (!output.startsWith(`${root}\\`) && !output.startsWith(`${root}/`)) throw new Error("Refusing to replace a build folder outside the project.");

await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const file of ["index.html", "styles.css", "app.js", "stitcher.js", "favicon.svg"]) {
  await cp(resolve(root, file), resolve(output, file));
}
await cp(resolve(root, "vendor"), resolve(output, "vendor"), { recursive: true });
await writeFile(resolve(output, ".nojekyll"), "");
console.log(`Built ${output}`);
