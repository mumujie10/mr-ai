#!/usr/bin/env node
/**
 * Stage the sibling `runtime/` project into the desktop bundle so the app
 * ships its own agent CLI instead of asking the user to install one.
 *
 * Output layout (consumed by src-tauri/src/engine/bundled.rs):
 *   resources/runtime/bin/<command>      launcher shim, what Rust resolves
 *   resources/runtime/lib/               CLI payload + its external modules
 *   resources/runtime/vendor/node        the Node that runs it
 *   resources/runtime/manifest.json      versions this payload was built for
 *
 * The payload is build output for one OS/arch pair: it is gitignored, and CI
 * must run this script on the same runner that packages the installer.
 */
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.resolve(appRoot, "cli");
const distDir = path.join(runtimeRoot, "dist");

const usage = `usage: node scripts/stage-runtime.mjs [--command <name>] [--node <path>] [--out <dir>]

  --command  launcher name the app resolves (default: mcode)
  --node     Node binary to vendor (default: the running node, i.e. local dev)
  --out      stage directory (default: src-tauri/resources/runtime)`;

function fail(message) {
  console.error(`stage-runtime: ${message}`);
  process.exit(1);
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`--${name} needs a value\n${usage}`);
  return value;
}

const command = argument("command", "mr");
const nodeBinary = path.resolve(argument("node", process.execPath));
const outDir = path.resolve(argument("out", path.join(appRoot, "src-tauri", "resources", "runtime")));

// A POSIX `#!/bin/sh` shim is the launcher; a Windows variant needs its own
// tested path rather than a guess about cmd.exe quoting.
if (process.platform === "win32") fail("Windows staging is not implemented yet");
if (!existsSync(path.join(distDir, "cli.js"))) {
  fail(`no built CLI at ${distDir}/cli.js — run \`pnpm build\` in ./cli first`);
}
if (!existsSync(nodeBinary)) fail(`node binary not found: ${nodeBinary}`);

// The external module list is the runtime's own release contract; importing it
// here stops the two copies from drifting apart silently.
const externalModules = (
  await import(path.join(runtimeRoot, "scripts", "lib", "cli-release.mjs"))
).cliExternalModules;

/** Copy `source` onto `target`, dereferencing symlinks so the copy stands
 *    alone (pnpm links workspace deps). Node does the traversal: a hand-rolled
 *    walk misclassifies symlinks that point at directories. */
function materialise(source, target, skip = []) {
  const excluded = new Set(skip);
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    force: true,
    filter: (entry) => !excluded.has(entry),
  });
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "bin"), { recursive: true });
mkdirSync(path.join(outDir, "vendor"), { recursive: true });

// 1. CLI payload. Only `metafile.json` is dropped — esbuild bookkeeping that
//    ./cli/scripts/package-cli-release.mjs also excludes. `package.json`
//    must stay: the bundle resolves its own version by reading `package.json`
//    next to `cli.js`, and it also carries `"type": "module"` for the ESM
//    chunks. The release packager rewrites that file rather than omitting it.
materialise(distDir, path.join(outDir, "lib"), [
  path.join(distDir, "metafile.json"),
]);

// 2. The modules the JS bundle deliberately leaves external. Resolve them the
//    way ./cli/scripts/package-cli-release.mjs does — probe the resolve
//    paths for the package directory — because packages such as
//    @vscode/ripgrep publish an `exports` map that hides ./package.json, so a
//    plain `require.resolve("<name>/package.json")` fails on an installed
//    module.
const requireFromRuntime = createRequire(path.join(runtimeRoot, "stage.js"));
const runtimeSearchPaths = requireFromRuntime.resolve.paths("placeholder") ?? [];

function installedPackage(moduleName) {
  for (const search of [path.join(runtimeRoot, "node_modules"), ...runtimeSearchPaths]) {
    const manifest = path.join(search, moduleName, "package.json");
    if (existsSync(manifest)) return manifest;
  }
  return undefined;
}

const stagedModules = {};
for (const moduleName of externalModules) {
  const manifestPath = installedPackage(moduleName);
  if (!manifestPath) {
    // @mariozechner/clipboard is an optionalDependency upstream; a missing
    // required module means the stage cannot run at all.
    if (moduleName === "@mariozechner/clipboard") {
      stagedModules[moduleName] = "not installed (optional)";
      continue;
    }
    fail(`required module ${moduleName} is not installed in ./cli`);
  }
  const target = path.join(outDir, "lib", "node_modules", moduleName);
  materialise(path.dirname(manifestPath), target);
  stagedModules[moduleName] = JSON.parse(readFileSync(manifestPath, "utf8")).version;
}

/**
 * Copy the transitive dependencies of the staged modules. pnpm hoists them to
 * ./cli/node_modules, so copying a module's own directory alone leaves a
 * broken tree — better-sqlite3 loads its .node via `require("bindings")`, and
 * without `bindings` the staged CLI dies at startup with
 * "Could not locate the bindings file".
 */
function stageDependencyClosure(roots) {
  const queue = [...roots];
  const seen = new Set(queue);
  const added = [];
  while (queue.length > 0) {
    const name = queue.shift();
    const manifest = installedPackage(name);
    if (!manifest) continue;
    const { dependencies = {} } = JSON.parse(readFileSync(manifest, "utf8"));
    for (const dependency of Object.keys(dependencies)) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      const source = installedPackage(dependency);
      if (!source) {
        // Optional peer/dependency that was never installed. Required ones
        // surface later as a module-not-found at runtime, which is why this
        // prints rather than stays silent.
        console.warn(`stage-runtime: dependency ${dependency} of ${name} is not installed; skipping`);
        continue;
      }
      materialise(path.dirname(source), path.join(outDir, "lib", "node_modules", dependency));
      stagedModules[dependency] = JSON.parse(readFileSync(source, "utf8")).version ?? "unknown";
      added.push(dependency);
      queue.push(dependency);
    }
  }
  return added;
}

for (const name of stageDependencyClosure(externalModules)) {
  console.log(`  + ${name}`);
}

// 3. The Node that runs it, then the launcher that finds it relative to itself
//    (AppImage mounts at a changing path; macOS moves the .app during update).
const nodeTarget = path.join(outDir, "vendor", "node");
cpSync(nodeBinary, nodeTarget, { dereference: true });
chmodSync(nodeTarget, 0o755);

const shimPath = path.join(outDir, "bin", command);
writeFileSync(
  shimPath,
  `#!/bin/sh
# Generated by scripts/stage-runtime.mjs — do not edit.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$DIR/../vendor/node" "$DIR/../lib/cli.js" "$@"
`,
  { mode: 0o755 },
);
chmodSync(shimPath, 0o755);

// 4. Provenance for later stages (update gates, signing inventory).
const runtimeManifest = JSON.parse(
  readFileSync(path.join(runtimeRoot, "package.json"), "utf8"),
);
writeFileSync(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify(
    {
      command,
      runtimeVersion: runtimeManifest.version,
      runtimeEngines: runtimeManifest.engines,
      cliSha256: sha256(path.join(outDir, "lib", "cli.js")),
      stagedAt: new Date().toISOString(),
      builtFor: `${process.platform}-${process.arch}`,
      node: { source: nodeBinary, version: process.version },
      externalModules: stagedModules,
    },
    null,
    2,
  )}\n`,
);

console.log(`staged ${command} -> ${outDir}`);
console.log(`  runtime ${runtimeManifest.version}  cli.js ${sha256(path.join(outDir, "lib", "cli.js")).slice(0, 12)}…`);
console.log(`  node ${process.version} from ${nodeBinary}`);
for (const [name, version] of Object.entries(stagedModules)) {
  console.log(`  ${name}@${version}`);
}
