import { Dashboard } from "../Dashboard.tsx";
import { mount } from "../mount.tsx";

mount((config) =>
  config.kind === "dashboard" ? <Dashboard config={config} /> : <p>this view expected the dashboard</p>,
);
