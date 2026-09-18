// test/windows-lnk-parser.test.mjs
//
// Regression guards for PROOF-03 round-2 review findings. Platform-
// independent by design: every .lnk buffer here is built synthetically in
// this file (not read from a real Start Menu shortcut), so this suite runs
// on any OS and needs no machine-specific fixture.
//
// Guarded defects (docs/adr/0003-proof-03-lnk-binary-parsing.md):
//
//   - Blocker 1: resolvedTargetPath for an environment-variable shortcut
//     must be the EXPANDED form, not the raw '%VAR%' string, and
//     compareTiered() must not report 'exact' when the only match is
//     found via a non-primary (secondary/diagnostic) candidate.
//   - Major 4: a truncated or size-lying .lnk must return a structured
//     {valid:false, rejectReason} naming the structure/offset involved,
//     never throw a raw RangeError.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLnk, expandEnvVars } from '../measure/windows/lnk-parser.mjs';
import { compareTiered } from '../measure/windows/proof-03-lnk-benchmark.mjs';

const LINK_CLSID_BYTES = [
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
];

/** Builds a minimal-but-valid 76-byte ShellLinkHeader. */
function buildHeader(flags = 0) {
  const buf = Buffer.alloc(0x4c);
  buf.writeUInt32LE(0x4c, 0); // HeaderSize
  Buffer.from(LINK_CLSID_BYTES).copy(buf, 4); // LinkCLSID
  buf.writeUInt32LE(flags, 20); // LinkFlags
  return buf;
}

/** Builds an EnvironmentVariableDataBlock (section 2.5.4): a full-size
 * (0x314-byte) ExtraData block carrying both the ANSI and Unicode target
 * strings, NUL-padded to their fixed field widths. */
function buildEnvBlock(ansiStr, unicodeStr) {
  const BLOCK_SIZE = 0x314;
  const buf = Buffer.alloc(BLOCK_SIZE);
  buf.writeUInt32LE(BLOCK_SIZE, 0); // BlockSize
  buf.writeUInt32LE(0xa0000001, 4); // BlockSignature (EnvironmentVariableDataBlock)
  Buffer.from(ansiStr, 'latin1').copy(buf, 8); // TargetAnsi, 260 bytes, NUL-padded
  Buffer.from(unicodeStr, 'utf16le').copy(buf, 8 + 260); // TargetUnicode, 520 bytes, NUL-padded
  return buf;
}

const HAS_EXP_STRING = 1 << 9;

test('resolvedTargetPath for an env-var shortcut is the EXPANDED form, not the raw %VAR% string', () => {
  process.env.DECKTECH_TEST_LNK_VAR = 'C:\\Fake\\Expanded\\Dir';
  try {
    const raw = '%DECKTECH_TEST_LNK_VAR%\\sub\\app.exe';
    const buf = Buffer.concat([buildHeader(HAS_EXP_STRING), buildEnvBlock(raw, raw)]);
    const parsed = parseLnk(buf);

    assert.equal(parsed.valid, true);
    assert.equal(parsed.category.envVar, true);
    assert.equal(
      parsed.resolvedTargetPath,
      'C:\\Fake\\Expanded\\Dir\\sub\\app.exe',
      'resolvedTargetPath must be the EXPANDED path (round-2 blocker 1) -- if this fails with the raw "%DECKTECH_TEST_LNK_VAR%\\..." string, env-raw is outranking env-expanded again',
    );
    assert.ok(!parsed.resolvedTargetPath.includes('%'), 'resolvedTargetPath must not contain an unexpanded %VAR%');

    // The raw form must still be PRESENT (as a diagnostic candidate,
    // round-2 fix note (a)) -- just not primary.
    assert.equal(parsed.candidates[0].source, 'env-expanded');
    assert.equal(parsed.candidates[0].value, 'C:\\Fake\\Expanded\\Dir\\sub\\app.exe');
    assert.equal(parsed.candidates[1].source, 'env-raw');
    assert.equal(parsed.candidates[1].value, raw);
  } finally {
    delete process.env.DECKTECH_TEST_LNK_VAR;
  }
});

test('compareTiered does NOT report exact when the match is only via a secondary (non-primary) candidate', () => {
  // Reproduces the exact shape of round-2 blocker 1's defect: COM resolved
  // to the EXPANDED path, but the parser's primary candidate is the RAW
  // (unexpanded) one -- i.e. what this benchmark would have seen before
  // the lnk-parser.mjs fix.
  const candidates = [
    { source: 'env-raw', value: '%windir%\\system32\\psr.exe' },
    { source: 'env-expanded', value: 'C:\\Windows\\system32\\psr.exe' },
  ];
  const cmp = compareTiered('C:\\Windows\\system32\\psr.exe', candidates);

  assert.notEqual(cmp.tier, 'exact', 'a match found only in a secondary candidate must not be reported as exact');
  assert.equal(cmp.tier, 'matched-only-via-secondary-candidate');
  assert.equal(cmp.matchedVia, 'env-expanded');
  assert.equal(cmp.secondaryMatchTier, 'exact');
});

test('compareTiered DOES report exact when the PRIMARY candidate matches COM directly', () => {
  const candidates = [
    { source: 'env-expanded', value: 'C:\\Windows\\system32\\psr.exe' },
    { source: 'env-raw', value: '%windir%\\system32\\psr.exe' },
  ];
  const cmp = compareTiered('C:\\Windows\\system32\\psr.exe', candidates);
  assert.equal(cmp.tier, 'exact');
  assert.equal(cmp.matchedVia, 'env-expanded');
});

test('a .lnk truncated mid-header (0x4c) is rejected structurally, not thrown', () => {
  const full = buildHeader(0);
  const truncated = full.subarray(0, 0x30); // shorter than the 0x4c header itself
  const parsed = parseLnk(truncated);
  assert.equal(parsed.valid, false);
  assert.match(parsed.rejectReason, /smaller than the 76-byte ShellLinkHeader/);
});

test('a .lnk whose LinkTargetIDList claims a size larger than the file is rejected structurally, not thrown', () => {
  const HAS_LINK_TARGET_IDLIST = 1 << 0;
  const header = buildHeader(HAS_LINK_TARGET_IDLIST);
  // IDListSize (u16) claims 0xFFFE (65534) bytes right after the header,
  // but the buffer ends a handful of bytes later -- the exact scenario
  // round-2 major finding 4 reproduced against a real Start Menu shortcut.
  const idListSizeField = Buffer.alloc(2);
  idListSizeField.writeUInt16LE(0xfffe, 0);
  const buf = Buffer.concat([header, idListSizeField, Buffer.alloc(4)]);

  let parsed;
  assert.doesNotThrow(() => {
    parsed = parseLnk(buf);
  }, 'parseLnk must never throw a raw RangeError for a corrupt/lying size field');

  assert.equal(parsed.valid, false);
  assert.match(parsed.rejectReason, /LinkTargetIDList/);
  assert.match(parsed.rejectReason, /0xfffe|65534/);
});

test('a .lnk truncated right after the header (HasLinkInfo set, no LinkInfo bytes present) is rejected structurally, not thrown', () => {
  const HAS_LINK_INFO = 1 << 1;
  const buf = buildHeader(HAS_LINK_INFO); // exactly 0x4c bytes -- LinkInfo.LinkInfoSize itself is unreadable
  let parsed;
  assert.doesNotThrow(() => {
    parsed = parseLnk(buf);
  });
  assert.equal(parsed.valid, false);
  assert.match(parsed.rejectReason, /LinkInfo/);
});

test('expandEnvVars is case-insensitive and leaves unknown %VAR% references untouched', () => {
  process.env.DECKTECH_TEST_LNK_VAR = 'C:\\Fake';
  try {
    assert.equal(expandEnvVars('%decktech_test_lnk_var%\\x'), 'C:\\Fake\\x');
    assert.equal(expandEnvVars('%DECKTECH_DOES_NOT_EXIST%\\x'), '%DECKTECH_DOES_NOT_EXIST%\\x');
  } finally {
    delete process.env.DECKTECH_TEST_LNK_VAR;
  }
});
