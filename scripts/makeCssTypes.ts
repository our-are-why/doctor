// Writes a declaration beside each CSS module in source/, so TypeScript checks
// every name a component takes from it: styles/App.module.css gets
// styles/App.module.d.css.ts, which tsconfig's allowArbitraryExtensions pairs
// with the stylesheet's import. Lightning CSS reads the names; Bun's own CSS
// modules are a port of it, so they're the names Bun's bundler exports.
//
// Usage: bun scripts/makeCssTypes.ts [--watch]
//   --watch  keeps running, and rewrites a stylesheet's declaration whenever
//            the stylesheet changes

import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import { basename } from "node:path";
import { transform } from "lightningcss";

const sourceDirectoryPath = "source";

// Run from the project root, wherever this script is called from
process.chdir(`${import.meta.dir}/..`);

await writeDeclarations();
if (Bun.argv.includes("--watch")) {
  watchStylesheets();
}

// every stylesheet's declaration, and no declaration whose stylesheet is gone
async function writeDeclarations() {
  for await (
    const somePath of new Bun.Glob("**/*.module.css").scan(sourceDirectoryPath)
  ) {
    await writeDeclaration(`${sourceDirectoryPath}/${somePath}`);
  }
  for await (
    const somePath of new Bun.Glob("**/*.module.d.css.ts").scan(
      sourceDirectoryPath,
    )
  ) {
    const declarationPath = `${sourceDirectoryPath}/${somePath}`;
    if (!(await Bun.file(toStylesheetPath(declarationPath)).exists())) {
      await rm(declarationPath);
    }
  }
}

// one stylesheet's declaration. One that would come out the same is left
// alone, so the editor and tsc see no change.
async function writeDeclaration(stylesheetPath: string) {
  const declarationPath = toDeclarationPath(stylesheetPath);
  const stylesheetFile = Bun.file(stylesheetPath);
  if (!(await stylesheetFile.exists())) {
    await rm(declarationPath, { force: true });
    return;
  }
  const transformResult = transform({
    filename: stylesheetPath,
    code: await stylesheetFile.bytes(),
    cssModules: true,
  });
  const declarationText = renderDeclaration(
    basename(stylesheetPath),
    transformResult.exports ? Object.keys(transformResult.exports) : [],
  );
  const declarationFile = Bun.file(declarationPath);
  if (
    (await declarationFile.exists()) &&
    (await declarationFile.text()) === declarationText
  ) {
    return;
  }
  await Bun.write(declarationPath, declarationText);
}

// the stylesheet's default export: an object that maps each name the
// stylesheet scopes (its classes and animations) to its unique identifier
function renderDeclaration(
  stylesheetFileName: string,
  exportedNames: Array<string>,
) {
  const memberLines = exportedNames
    .toSorted()
    .map((someName) => `  readonly ${JSON.stringify(someName)}: string;\n`)
    .join("");
  return (
    `// Written by scripts/makeCssTypes.ts from ${stylesheetFileName}; don't edit.\n` +
    `declare const styles: {\n${memberLines}};\n` +
    `export default styles;\n`
  );
}

// A stylesheet that doesn't parse is reported and skipped, and the watch goes
// on; the next save that parses writes its declaration.
function watchStylesheets() {
  watch(sourceDirectoryPath, { recursive: true }, (_eventType, fileName) => {
    if (fileName === null || !fileName.endsWith(".module.css")) return;
    writeDeclaration(`${sourceDirectoryPath}/${fileName}`).catch(
      (someError: unknown) => {
        console.error(someError);
      },
    );
  });
  console.log(`Watching ${sourceDirectoryPath}/ for CSS module changes`);
}

function toDeclarationPath(stylesheetPath: string) {
  return stylesheetPath.replace(/\.css$/, ".d.css.ts");
}

function toStylesheetPath(declarationPath: string) {
  return declarationPath.replace(/\.d\.css\.ts$/, ".css");
}
