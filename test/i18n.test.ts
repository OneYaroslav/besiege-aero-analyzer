import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const namespaces = [
  "common",
  "analysis",
  "plotlab",
  "whatif",
  "snapshots",
  "viewer3d",
  "tutorial",
] as const;

function readLocale(language: "en" | "ru", namespace: (typeof namespaces)[number]): Record<string, unknown> {
  const path = new URL(`../locales/${language}/${namespace}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child !== null && typeof child === "object" && !Array.isArray(child)
      ? keys(child as Record<string, unknown>, path)
      : [path];
  }).sort();
}

test("English locale exposes every planned UI namespace", () => {
  for (const namespace of namespaces) {
    const resource = readLocale("en", namespace);
    assert.equal(typeof resource, "object", namespace);
    assert.notEqual(resource, null, namespace);
  }
});

test("common locale contains the shared action labels", () => {
  const common = readLocale("en", "common") as {
    actions: Record<string, string>;
  };

  for (const action of ["save", "cancel", "import", "export", "reset", "delete", "apply", "close"]) {
    assert.equal(typeof common.actions[action], "string", action);
  }
});

test("Russian locale matches every English translation key", () => {
  for (const namespace of namespaces) {
    assert.deepEqual(keys(readLocale("ru", namespace)), keys(readLocale("en", namespace)), namespace);
  }
});
