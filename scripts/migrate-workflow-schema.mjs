#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const TARGET_FILES = [
  "resources/workflows/three-image-branching.workflow.json",
  "resources/workflows/three-image-reference-video.workflow.json",
  "resources/workflows/fanout-image-derivatives.workflow.json",
];
const LEGACY_SCHEMA = ["dreamina", "workflow/v1alpha1"].join(".");

const replacements = [
  [LEGACY_SCHEMA, "workflow.document/v1alpha1"],
  ["dreamina-canvas-web", "workflow-studio-web"],
  [".dreamina-workflow.json", ".workflow.json"],
];

const checkOnly = process.argv.includes("--check");

async function migrateFile(relativePath) {
  const absolutePath = resolve(ROOT, relativePath);
  const original = await readFile(absolutePath, "utf8");
  const migrated = replacements.reduce((content, [from, to]) => content.split(from).join(to), original);
  const changed = migrated !== original;

  if (checkOnly) {
    return { relativePath, changed };
  }

  if (changed) {
    await writeFile(absolutePath, migrated, "utf8");
  }

  return { relativePath, changed };
}

const results = await Promise.all(TARGET_FILES.map(migrateFile));

if (checkOnly) {
  const changed = results.filter((result) => result.changed);
  if (changed.length > 0) {
    console.error("Schema migration required for:");
    changed.forEach((result) => console.error(`- ${result.relativePath}`));
    process.exit(1);
  }
  console.log("Schema migration check passed.");
  process.exit(0);
}

results.forEach((result) => {
  console.log(`${result.changed ? "updated" : "unchanged"} ${result.relativePath}`);
});
