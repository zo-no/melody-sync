import { build, context } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const srcRoot = path.join(here, "src");
const distRoot = path.join(here, "dist");
const entryFile = path.join(srcRoot, "main.jsx");
const manifestFile = path.join(distRoot, "manifest.json");

function createBuildOptions() {
  return {
    entryPoints: [entryFile],
    bundle: true,
    format: "iife",
    globalName: "MelodySyncReactBundle",
    platform: "browser",
    target: ["es2020"],
    jsx: "automatic",
    sourcemap: true,
    legalComments: "none",
    outdir: distRoot,
    entryNames: "melody-sync-react",
    assetNames: "assets/[name]-[hash]",
    loader: {
      ".css": "css",
      ".svg": "file",
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".webp": "file",
    },
    metafile: true,
    write: true,
    logLevel: "info",
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
    },
  };
}

function pickOutputs(metafile) {
  const outputs = Object.keys(metafile?.outputs || {});
  const jsOutput = outputs.find((output) => output.endsWith(".js")) || "";
  const cssOutput = outputs.find((output) => output.endsWith(".css")) || "";
  return {
    js: jsOutput ? path.relative(repoRoot, jsOutput).replaceAll(path.sep, "/") : "",
    css: cssOutput ? path.relative(repoRoot, cssOutput).replaceAll(path.sep, "/") : "",
  };
}

async function writeManifest(metafile) {
  const outputs = pickOutputs(metafile);
  const manifest = {
    name: "melody-sync-react",
    source: "frontend-src/react/src/main.jsx",
    mountSelectors: ["[data-melodysync-react-root]", "#melodysync-react-root"],
    bridgeGlobal: "MelodySyncReactBridge",
    bootstrapGlobal: "__MELODYSYNC_REACT_BOOTSTRAP__",
    outputs,
  };
  await mkdir(distRoot, { recursive: true });
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export async function buildReactApp() {
  await mkdir(distRoot, { recursive: true });
  const result = await build(createBuildOptions());
  return writeManifest(result.metafile);
}

export async function watchReactApp() {
  await mkdir(distRoot, { recursive: true });
  const ctx = await context(createBuildOptions());
  await ctx.watch();
  const result = await ctx.rebuild();
  await writeManifest(result.metafile);
  return {
    dispose: () => ctx.dispose(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildReactApp().catch((error) => {
    console.error("[react-app] build failed:", error);
    process.exitCode = 1;
  });
}
