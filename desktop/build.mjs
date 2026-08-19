import { build } from "esbuild";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

await mkdir("dist/renderer", { recursive: true });

const shared = { bundle: true, format: "cjs", target: "node20", logLevel: "info" };

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main.js",
    platform: "node",
    external: ["electron"],
  }),
  build({
    ...shared,
    entryPoints: ["src/main/preload.ts"],
    outfile: "dist/preload.js",
    platform: "node",
    external: ["electron"],
  }),
  build({
    ...shared,
    entryPoints: ["src/renderer/renderer.ts"],
    outfile: "dist/renderer/renderer.js",
    platform: "browser",
    target: "es2022",
    // Browser script, not a CommonJS module — the shared `cjs` format emits a
    // `module.exports` reference that throws on load in the renderer.
    format: "iife",
  }),
]);

/**
 * The sign-in background. It ships beside the bundle for the same reason the
 * stylesheet does — the page's CSP grants `media-src 'self'`, and a file:// URL
 * one directory up is not "self".
 *
 * At ~27 MB it is the most expensive thing in the build, so it moves only when
 * it actually changed. A checkout without the asset still builds: the gate falls
 * back to a plain dark panel rather than failing the whole app.
 */
const BACKGROUND = "desktop-background.mp4";
const source = join("public", BACKGROUND);
const target = join("dist/renderer", BACKGROUND);

const [origin, existing] = await Promise.all([
  stat(source).catch(() => null),
  stat(target).catch(() => null),
]);

if (!origin) {
  console.warn(`[build] ${source} is missing — the sign-in screen will have no background.`);
} else if (!existing || existing.size !== origin.size || existing.mtimeMs < origin.mtimeMs) {
  await copyFile(source, target);
}

// The Dock and window icon, beside the bundle so one path works in dev and in a
// packaged app alike.
await copyFile(join("assets", "icon.png"), join("dist", "icon.png")).catch(() => {
  console.warn("[build] assets/icon.png is missing — run scripts/make-icons.py");
});

// The HTML and CSS ship alongside the bundle so every renderer asset resolves
// as a sibling. A script loaded from a parent directory is a cross-path
// file:// fetch, which the page's own CSP refuses.
await Promise.all(
  ["index.html", "styles.css"].map((name) =>
    copyFile(join("src/renderer", name), join("dist/renderer", name)),
  ),
);
