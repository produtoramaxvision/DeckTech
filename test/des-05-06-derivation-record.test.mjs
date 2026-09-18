import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, describe } from "node:test";
import { NOT_TRANSCRIBED, findNotTranscribed } from "../design/not-transcribed.mjs";

// DES-05 + DES-06 (Phase 6, .maxvision/ROADMAP.md success criterion 5) —
// "the derivation record: name what was deliberately NOT transcribed, and
// why". This suite guards two different things about design/not-transcribed.mjs:
//
//   1. Content guards: every symbol ROADMAP.md criterion 5 requires by name
//      (`.quaternary`, `.accentColor`, `customTrafficLights`,
//      `sidebarChromeRadius=20`, `DockIcon.cornerRadius=20`) — plus the two
//      more the requirement text also calls out (`filteredInstalled`,
//      `filter`) — is present with a non-empty reason, and the two
//      "unsamplable-semantic" entries carry NO hex/rgb literal anywhere in
//      their fields. This is the guard against someone later "helpfully"
//      filling in a sampled/guessed value for `.quaternary` or
//      `.accentColor` — exactly the failure DES-06 exists to prevent.
//
//   2. Source-drift guards: the record's claims about mac/Sources/*.swift
//      are re-checked against a COPY of the live source files, so the
//      record fails loudly instead of silently going stale if the Mac app
//      changes underneath it. The copy is made into a temp directory whose
//      name contains a space, joined with path.join, so this also exercises
//      a path-with-a-space per this task's path-handling requirement.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function copyMacSourcesToSpacedTempDir() {
  const base = mkdtempSync(path.join(tmpdir(), "des-05-06 derivation record "));
  assert.ok(base.includes(" "), "sanity check: the temp base path must actually contain a space");
  const sourcesDir = path.join(base, "mac Sources copy");
  mkdirSync(sourcesDir, { recursive: true });

  for (const file of ["ContentView.swift", "DockStore.swift", "DockIcon.swift", "AppPickerSheet.swift"]) {
    copyFileSync(
      path.join(repoRoot, "mac", "Sources", file),
      path.join(sourcesDir, file),
    );
  }
  return sourcesDir;
}

function countOccurrences(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

describe("DES-05+06: derivation record content", () => {
  const requiredByRoadmapCriterion5 = [
    ".quaternary",
    ".accentColor",
    "customTrafficLights",
    "sidebarChromeRadius",
    "DockIcon.cornerRadius",
  ];
  const requiredByRequirementText = ["filteredInstalled", "filter"];

  for (const symbol of [...requiredByRoadmapCriterion5, ...requiredByRequirementText]) {
    test(`names "${symbol}" as not-transcribed, with a non-empty reason and source citation`, () => {
      const entry = findNotTranscribed(symbol);
      assert.ok(entry, `expected an entry whose symbol includes "${symbol}"`);
      assert.ok(entry.reason && entry.reason.length > 40, "reason must be a real explanation, not a stub");
      assert.ok(entry.source && /:\d+/.test(entry.source), "source must cite a path:line");
    });
  }

  test("sidebarChromeRadius entry records literal 20 as the value NOT to transcribe", () => {
    const entry = findNotTranscribed("sidebarChromeRadius");
    assert.equal(entry.literal, 20);
  });

  test("DockIcon.cornerRadius entry records literal 20 as the value NOT to transcribe, and its reason names 28 as the real visible-card radius", () => {
    const entry = findNotTranscribed("DockIcon.cornerRadius");
    assert.equal(entry.literal, 20);
    assert.match(entry.reason, /\b28\b/, "reason must name 28 — the radius that actually draws the visible card");
  });

  test("filteredInstalled and filter entries are both kind dead-code (filter is a transitive dependency of the dead filteredInstalled)", () => {
    assert.equal(findNotTranscribed("DockStore.filteredInstalled").kind, "dead-code");
    assert.equal(findNotTranscribed("DockStore.filter").kind, "dead-code");
  });

  test('.quaternary and .accentColor entries carry literal: null and NO hex/rgb color value anywhere in their fields — the non-invention guard', () => {
    for (const symbol of [".quaternary", ".accentColor"]) {
      const entry = findNotTranscribed(symbol);
      assert.equal(entry.literal, null, `${symbol} entry must not carry a literal value`);
      const serialized = JSON.stringify(entry);
      assert.doesNotMatch(
        serialized,
        /#[0-9a-fA-F]{3,8}\b/,
        `${symbol} entry must not contain a hex color anywhere (found one — this is exactly the invented-value failure DES-06 exists to prevent)`,
      );
      assert.doesNotMatch(
        serialized,
        /rgba?\(/i,
        `${symbol} entry must not contain an rgb()/rgba() literal anywhere`,
      );
    }
  });

  test("every NOT_TRANSCRIBED entry has kind one of the three documented failure modes", () => {
    const validKinds = new Set(["dead-code", "wrong-scope", "unsamplable-semantic"]);
    for (const entry of NOT_TRANSCRIBED) {
      assert.ok(validKinds.has(entry.kind), `unexpected kind "${entry.kind}" on ${entry.symbol}`);
    }
  });
});

describe("DES-05+06: record claims re-checked against a live copy of mac/Sources", () => {
  const sourcesDir = copyMacSourcesToSpacedTempDir();
  const contentView = readFileSync(path.join(sourcesDir, "ContentView.swift"), "utf8");
  const dockStore = readFileSync(path.join(sourcesDir, "DockStore.swift"), "utf8");
  const dockIcon = readFileSync(path.join(sourcesDir, "DockIcon.swift"), "utf8");
  const appPicker = readFileSync(path.join(sourcesDir, "AppPickerSheet.swift"), "utf8");

  test("sidebarChromeRadius: declared exactly once, read nowhere in ContentView.swift", () => {
    assert.equal(
      countOccurrences(contentView, /sidebarChromeRadius/g),
      1,
      "sidebarChromeRadius must appear exactly once (the declaration) — a second occurrence would mean it started being read somewhere, invalidating the dead-value claim",
    );
  });

  test("the sidebar chrome hardcodes literal cornerRadius 18 in four places, never reading sidebarChromeRadius", () => {
    assert.equal(
      countOccurrences(contentView, /cornerRadius:\s*18\b/g),
      4,
      "expected exactly 4 literal `cornerRadius: 18` occurrences drawing the sidebar chrome",
    );
  });

  test("customTrafficLights: declared exactly once (zero call sites) in ContentView.swift", () => {
    assert.equal(
      countOccurrences(contentView, /customTrafficLights/g),
      1,
      "customTrafficLights must appear exactly once (the declaration) — any additional occurrence would mean it is now referenced by body and is no longer dead code",
    );
  });

  test("filteredInstalled: declared exactly once (zero call sites) in DockStore.swift", () => {
    assert.equal(
      countOccurrences(dockStore, /filteredInstalled/g),
      1,
      "filteredInstalled must appear exactly once (the declaration) — a second occurrence would mean something now calls it",
    );
  });

  test("DockIcon.cornerRadius: declared as 20 and used at the inner-image clip sites; the visible card independently hardcodes 28 at least 5 times", () => {
    assert.match(dockIcon, /private let cornerRadius: CGFloat = 20/, "expected the live cornerRadius=20 declaration");
    assert.ok(
      countOccurrences(dockIcon, /cornerRadius:\s*28\b/g) >= 5,
      "expected the visible card surfaces to hardcode 28 independently of `cornerRadius`",
    );
  });

  test("no AccentColor asset override and no .tint() modifier anywhere in the copied mac/Sources files — .accentColor genuinely tracks the user's system preference", () => {
    for (const src of [contentView, dockStore, dockIcon, appPicker]) {
      assert.doesNotMatch(src, /\.tint\(/, "a .tint() override would mean .accentColor is no longer the relevant, unoverridden symbol");
    }
  });
});
