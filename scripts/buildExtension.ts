// Builds the extension into build/extension/ (its code for VS Code's Node
// host, the webviews' code for the browser, and its manifest), then packs
// that folder as a .vsix for code-server to install.
//
// Usage: bun scripts/buildExtension.ts

import { cp, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import * as v from "valibot";
import { parse } from "../source/shared/parse.ts";

interface _Manifest_Extension_ {
  name: string;
  publisher: string;
  displayName: string;
  description: string;
  version: string;
  engines: { vscode: string };
}

const manifestSchema: v.GenericSchema<unknown, _Manifest_Extension_> = v.object({
  name: v.string(),
  publisher: v.string(),
  displayName: v.string(),
  description: v.string(),
  version: v.string(),
  engines: v.object({ vscode: v.string() }),
});

interface _Entry_Zip_ {
  name: string;
  bytes: Uint8Array;
}

const extensionDirectory = "build/extension";

async function bundle(config: Bun.BuildConfig): Promise<void> {
  const result = await Bun.build({ ...config, throw: false });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`bundling ${config.entrypoints.join(", ")} failed`);
  }
}

async function filesUnder(directory: string): Promise<Array<string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((someEntry) => someEntry.isFile())
    .map((someEntry) => join(someEntry.parentPath, someEntry.name))
    .toSorted();
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function packageManifest(manifest: _Manifest_Extension_): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(manifest.name)}" Version="${escapeXml(manifest.version)}" Publisher="${escapeXml(manifest.publisher)}" />
    <DisplayName>${escapeXml(manifest.displayName)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(manifest.description)}</Description>
    <Categories>Other</Categories>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(manifest.engines.vscode)}" /></Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" /></Assets>
</PackageManifest>`;
}

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".css" ContentType="text/css"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>`;

// a zip with stored, uncompressed entries: all a .vsix needs
function zip(entries: Array<_Entry_Zip_>): Blob {
  const encoder = new TextEncoder();
  const fileParts: Array<Uint8Array> = [];
  const directoryParts: Array<Uint8Array> = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = Bun.hash.crc32(entry.bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.bytes.length, true);
    local.setUint32(22, entry.bytes.length, true);
    local.setUint16(26, name.length, true);
    fileParts.push(new Uint8Array(local.buffer), name, entry.bytes);
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, entry.bytes.length, true);
    record.setUint32(24, entry.bytes.length, true);
    record.setUint16(28, name.length, true);
    record.setUint32(42, offset, true);
    directoryParts.push(new Uint8Array(record.buffer), name);
    offset += 30 + name.length + entry.bytes.length;
  }
  const directorySize = directoryParts.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...fileParts, ...directoryParts, new Uint8Array(end.buffer)]);
}

// builds and packs the extension, and returns the .vsix's path
export async function buildExtension(): Promise<string> {
  process.chdir(`${import.meta.dir}/..`);
  const parsed = parse(manifestSchema, await Bun.file("source/extension/manifest.json").json());
  if (parsed.kind === "rejected") {
    throw new Error(`source/extension/manifest.json: ${parsed.issues.join("; ")}`);
  }
  const manifest = parsed.value;

  await rm(extensionDirectory, { recursive: true, force: true });
  await bundle({
    entrypoints: ["source/extension/main.ts"],
    target: "node",
    format: "cjs",
    outdir: extensionDirectory,
    naming: "extension.js",
    // ws loads these native speedups only if they're installed
    external: ["vscode", "bufferutil", "utf-8-validate"],
  });
  // one build per webview, so each gets its own stylesheet even when they
  // share styles
  for (const webview of ["document", "dashboard"]) {
    await bundle({
      entrypoints: [`source/webview/entries/${webview}.tsx`],
      target: "browser",
      outdir: join(extensionDirectory, "webview"),
      naming: "[name].[ext]",
      minify: true,
    });
  }
  await cp("source/extension/manifest.json", join(extensionDirectory, "package.json"));

  const encoder = new TextEncoder();
  const entries: Array<_Entry_Zip_> = [
    { name: "[Content_Types].xml", bytes: encoder.encode(contentTypes) },
    { name: "extension.vsixmanifest", bytes: encoder.encode(packageManifest(manifest)) },
  ];
  for (const path of await filesUnder(extensionDirectory)) {
    entries.push({
      name: `extension/${relative(extensionDirectory, path)}`,
      bytes: await Bun.file(path).bytes(),
    });
  }
  const vsixPath = `build/${manifest.name}-${manifest.version}.vsix`;
  await Bun.write(vsixPath, zip(entries));
  console.log(`${vsixPath}: ${entries.map((someEntry) => someEntry.name).join(", ")}`);
  return vsixPath;
}

if (import.meta.main) {
  await buildExtension();
}
