import { mount } from "../mount.tsx";
import { TextEditor } from "../TextEditor.tsx";

// Monaco's worker is bundled beside this script; it's fetched and run from a
// blob, since a webview can't start a worker from its own resource URLs
self.MonacoEnvironment = {
  getWorker: async () => {
    const response = await fetch(new URL("textWorker.js", import.meta.url));
    const source = new Blob([await response.text()], { type: "text/javascript" });
    return new Worker(URL.createObjectURL(source));
  },
};

mount((config) => (config.kind === "text" ? <TextEditor config={config} /> : <p>this view expected a document</p>));
