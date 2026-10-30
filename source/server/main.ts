// doctor's server. For now it only serves the browser app in source/client/:
// in development (bun run startServer) Bun bundles the app as it's requested,
// again after its files change; bun run build bundles it ahead of time into
// the binary.

import app from "../client/index.html";

// Development only when the startServer script asks for it, so the compiled
// binary, run with nothing set up, always serves its prebuilt bundle
const isDevelopment = Bun.env["DOCTOR_DEVELOPMENT"] === "1";

const server = Bun.serve({
  // every interface, so the container's published port reaches it;
  // startContainer.sh publishes it on the Mac's 127.0.0.1 only
  hostname: "0.0.0.0",
  port: 3004,
  routes: { "/": app },
  // No HMR: in Bun 1.4.4 its bundle drops every CSS module's import, so the
  // page dies with "import_App_module is not defined". Without it the page
  // doesn't reload itself after an edit (refresh it), and the browser's
  // console no longer prints here, since both go through HMR's WebSocket.
  development: isDevelopment ? { hmr: false } : false,
});

console.log(`doctor is at http://localhost:${server.port}`);
