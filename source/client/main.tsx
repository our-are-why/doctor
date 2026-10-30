// The browser app's entry, which index.html loads: renders App into #root

import { render } from "preact";
import { App } from "./App.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("index.html has no #root element");
render(<App />, rootElement);
