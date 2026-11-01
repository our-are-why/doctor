import { DocumentEditor } from "../DocumentEditor.tsx";
import { mount } from "../mount.tsx";

mount((config) =>
  config.kind === "document" ? <DocumentEditor config={config} /> : <p>this view expected a document</p>,
);
