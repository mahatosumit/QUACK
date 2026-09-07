import test from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, IGNORED_DIRECTORIES, IGNORED_EXTENSIONS } from "./language-detector.js";

test("detectLanguage returns correct language for common extensions", () => {
  assert.equal(detectLanguage("file.ts"), "typescript");
  assert.equal(detectLanguage("file.tsx"), "typescript");
  assert.equal(detectLanguage("file.js"), "javascript");
  assert.equal(detectLanguage("file.jsx"), "javascript");
  assert.equal(detectLanguage("file.py"), "python");
  assert.equal(detectLanguage("file.rs"), "rust");
  assert.equal(detectLanguage("file.go"), "go");
  assert.equal(detectLanguage("file.java"), "java");
  assert.equal(detectLanguage("file.c"), "c");
  assert.equal(detectLanguage("file.cpp"), "cpp");
  assert.equal(detectLanguage("file.h"), "c");
  assert.equal(detectLanguage("file.json"), "json");
  assert.equal(detectLanguage("file.md"), "markdown");
  assert.equal(detectLanguage("file.yaml"), "yaml");
  assert.equal(detectLanguage("file.yml"), "yaml");
  assert.equal(detectLanguage("file.html"), "html");
  assert.equal(detectLanguage("file.css"), "css");
  assert.equal(detectLanguage("file.scss"), "css");
  assert.equal(detectLanguage("file.sql"), "sql");
  assert.equal(detectLanguage("file.sh"), "shell");
  assert.equal(detectLanguage("file.unknown"), "unknown");
});

test("detectLanguage detects shebang scripts", () => {
  assert.equal(detectLanguage("script", `#!/usr/bin/env node\nconsole.log("hi")`), "javascript");
  assert.equal(detectLanguage("script", `#!/bin/bash\necho hi`), "shell");
  assert.equal(detectLanguage("script", `#!/usr/bin/env python3\nprint("hi")`), "python");
  assert.equal(detectLanguage("script", `#!/bin/sh\necho hi`), "shell");
});

test("detectLanguage handles no content", () => {
  assert.equal(detectLanguage("script"), "unknown");
  assert.equal(detectLanguage("script.ts"), "typescript");
});

test("IGNORED_DIRECTORIES contains common dirs", () => {
  assert.ok(IGNORED_DIRECTORIES.has("node_modules"));
  assert.ok(IGNORED_DIRECTORIES.has(".git"));
  assert.ok(IGNORED_DIRECTORIES.has("dist"));
  assert.ok(IGNORED_DIRECTORIES.has(".quack"));
});

test("IGNORED_EXTENSIONS contains binary/artifact exts", () => {
  assert.ok(IGNORED_EXTENSIONS.has(".exe"));
  assert.ok(IGNORED_EXTENSIONS.has(".dll"));
  assert.ok(IGNORED_EXTENSIONS.has(".wasm"));
});
