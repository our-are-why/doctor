// Builds the extension and installs it into this container's code-server.
// The window then needs reloading (Developer: Reload Window) to run it.
//
// Usage: bun scripts/installExtension.ts

import { buildExtension } from "./buildExtension.ts";

const vsixPath = await buildExtension();
const install = Bun.spawnSync(["code-server", "--install-extension", vsixPath, "--force"], {
  stdout: "inherit",
  stderr: "inherit",
});
if (install.exitCode !== 0) {
  process.exit(install.exitCode);
}
console.log("installed: reload the window (Developer: Reload Window) to run it");
