/**
 * Launcher.
 *
 * VS Code's integrated terminal exports ELECTRON_RUN_AS_NODE=1 for its own
 * tooling, and a child Electron inherits it — which makes `require("electron")`
 * resolve to the executable's path string instead of the API object, so the
 * app dies on `app.whenReady()` with a confusing "cannot read properties of
 * undefined". Strip it before spawning rather than making every contributor
 * rediscover that.
 */

import { spawn } from "node:child_process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], { env, stdio: "inherit" });
child.on("close", (code) => process.exit(code ?? 0));
