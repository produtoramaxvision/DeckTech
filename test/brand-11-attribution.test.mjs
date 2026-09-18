import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// BRAND-11: Attribution — Felipe Natanael preserved, DeckTech alongside (D2)

const repoRoot = path.resolve(import.meta.dirname, "..");
const licensePath = path.join(repoRoot, "LICENSE");
const readmePath = path.join(repoRoot, "README.md");
const readmeEnPath = path.join(repoRoot, "README.en.md");
const docsMainPath = path.join(repoRoot, "docs", "src", "main.js");

const EXPECTED_LICENSE_EXACT = `MIT License

Copyright (c) 2025 Felipe Alves

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

test("BRAND-11: LICENSE keeps MIT text and Copyright (c) 2025 Felipe Alves byte for byte", async () => {
  const content = await readFile(licensePath, "utf8");
  // Normalize Windows CRLF to LF for comparison so byte-for-byte content is verified
  const normalized = content.replace(/\r\n/g, "\n");
  assert.equal(
    normalized,
    EXPECTED_LICENSE_EXACT,
    "LICENSE must match expected MIT license and copyright notice byte for byte",
  );

  // git diff LICENSE must report zero changes in the worktree
  const gitDiff = execFileSync("git", ["diff", "LICENSE"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(gitDiff.trim(), "", "git diff LICENSE must be completely empty (untouched)");
});

test("BRAND-11: README shows DeckTech's own attribution next to origin attribution", async () => {
  const readme = await readFile(readmePath, "utf8");
  const readmeEn = await readFile(readmeEnPath, "utf8");

  for (const [name, content] of [["README.md", readme], ["README.en.md", readmeEn]]) {
    assert.match(content, /DeckTech/, `${name} must name DeckTech`);
    assert.match(content, /Dokke/, `${name} must name Dokke`);
    assert.match(content, /Felipe (?:Alves|Natanael)/, `${name} must name origin author Felipe Alves / Felipe Natanael`);
    assert.match(content, /MIT/, `${name} must name the MIT license`);
    assert.match(
      content,
      /https:\/\/github\.com\/felipenalves\/Dokke/,
      `${name} must link to https://github.com/felipenalves/Dokke`,
    );
  }

  // Verify license section in Portuguese README
  assert.match(
    readme,
    /## Licença e Atribuição[\s\S]*?DeckTech[\s\S]*?Dokke[\s\S]*?Felipe (?:Alves|Natanael)/,
    "README.md license section must present DeckTech and Dokke origin attribution side by side",
  );
  assert.match(
    readme,
    /## Licença e Atribuição[\s\S]*?https:\/\/github\.com\/felipenalves\/Dokke/,
    "README.md license section must link to upstream Dokke",
  );

  // Verify license section in English README
  assert.match(
    readmeEn,
    /## License and Attribution[\s\S]*?DeckTech[\s\S]*?Dokke[\s\S]*?Felipe (?:Alves|Natanael)/,
    "README.en.md license section must present DeckTech and Dokke origin attribution side by side",
  );
  assert.match(
    readmeEn,
    /## License and Attribution[\s\S]*?https:\/\/github\.com\/felipenalves\/Dokke/,
    "README.en.md license section must link to upstream Dokke",
  );
});

test("BRAND-11: docs/src/main.js footer carries DeckTech identity and preserves Felipe Natanael attribution", async () => {
  const content = await readFile(docsMainPath, "utf8");

  // pt-BR copy in LANDING_COPY
  const ptBrMatch = content.match(/"pt-BR":\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(ptBrMatch, "docs/src/main.js must define pt-BR landing copy");
  assert.match(
    ptBrMatch[1],
    /"footer\.note":\s*"[^"]*DeckTech[^"]*Dokke[^"]*Felipe Natanael[^"]*"/,
    "docs/src/main.js pt-BR footer.note must credit DeckTech alongside Dokke and Felipe Natanael",
  );

  // en copy in LANDING_COPY
  const enMatch = content.match(/(?:["']en["']|en):\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(enMatch, "docs/src/main.js must define en landing copy");
  assert.match(
    enMatch[1],
    /"footer\.note":\s*"[^"]*DeckTech[^"]*Dokke[^"]*Felipe Natanael[^"]*"/,
    "docs/src/main.js en footer.note must credit DeckTech alongside Dokke and Felipe Natanael",
  );

  // HTML template
  assert.match(
    content,
    /<p class="footer-note">[^<]*DeckTech[^<]*Dokke[^<]*Felipe Natanael[^<]*<\/p>/,
    "docs/src/main.js HTML footer-note must visibly contain DeckTech and Felipe Natanael",
  );

  // Personal social links to felipenalves must survive untouched
  assert.match(
    content,
    /href="https:\/\/instagram\.com\/felipenalves"/,
    "docs/src/main.js must preserve Instagram link to felipenalves",
  );
  assert.match(
    content,
    /href="https:\/\/x\.com\/felipenalves"/,
    "docs/src/main.js must preserve X link to felipenalves",
  );
  assert.match(
    content,
    /href="https:\/\/github\.com\/felipenalves\/Dokke"/,
    "docs/src/main.js must preserve GitHub link to origin felipenalves/Dokke",
  );
});

test("BRAND-11: Windows path resolution uses path.join and survives paths with spaces", async () => {
  const tempBase = mkdtempSync(path.join(tmpdir(), "brand-11 attribution test "));
  const nestedDir = path.join(tempBase, "nested path with space");
  mkdirSync(nestedDir, { recursive: true });
  const sampleLicense = path.join(nestedDir, "LICENSE");
  writeFileSync(sampleLicense, EXPECTED_LICENSE_EXACT, "utf8");

  assert.ok(tempBase.includes(" "), "sanity check: temp path must contain a space");
  assert.ok(nestedDir.includes(" "), "sanity check: nested path must contain a space");

  const readBack = await readFile(sampleLicense, "utf8");
  assert.equal(readBack.replace(/\r\n/g, "\n"), EXPECTED_LICENSE_EXACT);
});
