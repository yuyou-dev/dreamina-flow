#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const bin = process.env.DREAMINA_BIN || process.env.DREAMINA_CLI || "dreamina";

const commands = [
  { name: "root", args: ["-h"] },
  { name: "text2image", args: ["text2image", "-h"] },
  { name: "image2image", args: ["image2image", "-h"] },
  { name: "login", args: ["login", "-h"] },
  { name: "relogin", args: ["relogin", "-h"] },
  { name: "user_credit", args: ["user_credit", "-h"] },
  { name: "multimodal2video", args: ["multimodal2video", "-h"] },
  { name: "image2video", args: ["image2video", "-h"] },
];

const outputs = new Map();
const failures = [];

function runHelp(name, args) {
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combined = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n");

  outputs.set(name, combined);

  if (result.error) {
    failures.push({
      name,
      kind: "command-error",
      message: `${bin} ${args.join(" ")} failed to start: ${result.error.message}`,
      excerpt: combined || result.error.message,
    });
    return;
  }

  if (result.status !== 0) {
    failures.push({
      name,
      kind: "non-zero-exit",
      message: `${bin} ${args.join(" ")} exited with code ${result.status}`,
      excerpt: combined || "<no output>",
    });
  }
}

function linesAround(text, needle, radius = 2, fallbackLines = 20) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.toLowerCase().includes(needle.toLowerCase()));
  if (index === -1) {
    return lines.slice(0, fallbackLines).join("\n");
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join("\n");
}

function hasStandaloneLab(text) {
  return /\blab\b/i.test(text);
}

function assertContains(name, expected, text, label = expected) {
  if (!text.includes(expected)) {
    failures.push({
      name,
      kind: "missing-pattern",
      message: `expected ${name} help to contain ${JSON.stringify(label)}`,
      excerpt: linesAround(text, expected),
    });
  }
}

function assertNotContains(name, forbidden, text, label = forbidden) {
  if (forbidden === "lab") {
    if (hasStandaloneLab(text)) {
      failures.push({
        name,
        kind: "forbidden-pattern",
        message: `expected ${name} help to avoid standalone ${JSON.stringify(label)}`,
        excerpt: linesAround(text, forbidden),
      });
    }
    return;
  }

  if (text.includes(forbidden)) {
    failures.push({
      name,
      kind: "forbidden-pattern",
      message: `expected ${name} help to avoid ${JSON.stringify(label)}`,
      excerpt: linesAround(text, forbidden),
    });
  }
}

for (const command of commands) {
  runHelp(command.name, command.args);
}

const root = outputs.get("root") || "";
const text2image = outputs.get("text2image") || "";
const image2image = outputs.get("image2image") || "";
const login = outputs.get("login") || "";
const relogin = outputs.get("relogin") || "";
const userCredit = outputs.get("user_credit") || "";
const multimodal2video = outputs.get("multimodal2video") || "";
const image2video = outputs.get("image2video") || "";

assertNotContains("text2image", "lab", text2image, "lab");
assertNotContains("image2image", "lab", image2image, "lab");
assertContains("image2image", "1 to 10", image2image, "1 to 10");
assertContains("login", "--headless", login, "--headless");
assertContains("login", "QR code", login, "QR code");
assertContains("relogin", "--headless", relogin, "--headless");
assertContains("relogin", "QR code", relogin, "QR code");
assertContains("user_credit", "remaining Dreamina credits", userCredit, "remaining Dreamina credits");
assertContains(
  "root/multimodal2video",
  "全能参考 / formerly ref2video",
  `${root}\n${multimodal2video}`,
  "全能参考 / formerly ref2video",
);
assertContains("image2video", "3.0_fast", image2video, "3.0_fast");
assertContains("image2video", "3.0_pro", image2video, "3.0_pro");
assertContains("image2video", "3.5_pro", image2video, "3.5_pro");

if (failures.length === 0) {
  console.log(`cli help audit passed (${commands.length} commands checked)`);
  process.exit(0);
}

console.error(`cli help audit failed (${failures.length} issue${failures.length === 1 ? "" : "s"})`);
for (const [index, failure] of failures.entries()) {
  console.error("");
  console.error(`${index + 1}. [${failure.name}] ${failure.message}`);
  if (failure.excerpt) {
    console.error(indentBlock("   ", failure.excerpt));
  }
}

process.exit(1);

function indentBlock(prefix, text) {
  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
