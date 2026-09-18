// test/windows-lnk-parser.test.mjs
//
// Regression guards for PROOF-03 round-2 and round-3 review findings.
// Platform-independent by design: every .lnk buffer here is built
// synthetically in this file (not read from a real Start Menu shortcut),
// so this suite runs on any OS and needs no machine-specific fixture.
//
// Guarded defects (docs/adr/0003-proof-03-lnk-binary-parsing.md):
//
//   - Round-2 blocker 1: resolvedTargetPath for an environment-variable
//     shortcut must be the EXPANDED form, not the raw '%VAR%' string, and
//     compareTiered() must not report 'exact' when the only match is
//     found via a non-primary (secondary/diagnostic) candidate.
//   - Round-2 major 4: a truncated or size-lying .lnk must return a
//     structured {valid:false, rejectReason} naming the structure/offset
//     involved, never throw a raw RangeError.
//   - Round-3 minor 4: the ANSI half of the blocker-1 fix (env-expanded-ansi
//     ranked ahead of env-raw-ansi) was untested -- every existing env-var
//     test always populates targetUnicode, so the Unicode branch always won
//     and lines 486-487 of lnk-parser.mjs never executed in this suite.
//   - Round-3 minor 7: category.idListOnly did not account for
//     ForceNoLinkInfo, so a shortcut with LinkInfo present-but-ignored and
//     no env-var fallback produced zero candidates while still reading
//     idListOnly: false -- silently landing in unexpectedParserEmptyGapCount
//     instead of the accepted coverage-gap bucket.

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

test('resolvedTargetPath for an env-var shortcut falls back to the ANSI form when the Unicode field is empty (all-NUL) -- round-3 minor finding 4', () => {
  // buildEnvBlock always populates BOTH the ANSI and Unicode fields, so it
  // always exercises lnk-parser.mjs's `if (envBlock.targetUnicode)` branch
  // (line 482) and never the `else if (envBlock.targetAnsi)` branch (lines
  // 486-487) -- the exact defect class round-2 blocker 1 was about, left
  // untested in its ANSI twin. This builds a full-size (0x314) block whose
  // TargetUnicode field is left all-NUL (Buffer.alloc default), so
  // readNulTerminatedUtf16 returns '' (falsy) and the ANSI branch must win.
  process.env.DECKTECH_TEST_LNK_VAR = 'C:\\Fake\\Ansi\\Dir';
  try {
    const raw = '%DECKTECH_TEST_LNK_VAR%\\sub\\app.exe';
    const BLOCK_SIZE = 0x314;
    const envBlockBuf = Buffer.alloc(BLOCK_SIZE);
    envBlockBuf.writeUInt32LE(BLOCK_SIZE, 0); // BlockSize
    envBlockBuf.writeUInt32LE(0xa0000001, 4); // BlockSignature (EnvironmentVariableDataBlock)
    Buffer.from(raw, 'latin1').copy(envBlockBuf, 8); // TargetAnsi only -- TargetUnicode (offset 268) stays all-NUL
    const buf = Buffer.concat([buildHeader(HAS_EXP_STRING), envBlockBuf]);
    const parsed = parseLnk(buf);

    assert.equal(parsed.valid, true);
    assert.equal(parsed.category.envVar, true);
    assert.equal(
      parsed.candidates[0].source,
      'env-expanded-ansi',
      'the ANSI branch (lnk-parser.mjs:486-487) must produce the PRIMARY candidate when TargetUnicode is empty -- if this reads "env-raw-ansi", the two push() calls were swapped back',
    );
    assert.equal(parsed.candidates[0].value, 'C:\\Fake\\Ansi\\Dir\\sub\\app.exe');
    assert.equal(
      parsed.resolvedTargetPath,
      'C:\\Fake\\Ansi\\Dir\\sub\\app.exe',
      'resolvedTargetPath must be the EXPANDED ansi form, not the raw %VAR% string',
    );
    assert.equal(parsed.candidates[1].source, 'env-raw-ansi');
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

test('a shortcut with LinkInfo present but ForceNoLinkInfo set, no env block, has zero candidates and is classified noUsablePathSource, NOT idListOnly -- round-3 minor finding 7', () => {
  const HAS_LINK_TARGET_IDLIST = 1 << 0;
  const HAS_LINK_INFO = 1 << 1;
  const FORCE_NO_LINK_INFO = 1 << 8;
  const flags = HAS_LINK_TARGET_IDLIST | HAS_LINK_INFO | FORCE_NO_LINK_INFO;

  // Empty LinkTargetIDList (IDListSize = 0) -- just needs to be
  // structurally present so HasLinkTargetIDList is meaningfully true.
  const idListSizeField = Buffer.alloc(2);
  idListSizeField.writeUInt16LE(0, 0);

  // Minimal 0x1c-byte LinkInfo header (LinkInfoHeaderSize < 0x24, so the
  // Unicode offset fields are never read) with every offset zeroed --
  // content is irrelevant here because ForceNoLinkInfo makes the candidate
  // builder ignore this structure entirely regardless of what it contains.
  const linkInfo = Buffer.alloc(0x1c);
  linkInfo.writeUInt32LE(0x1c, 0); // LinkInfoSize
  linkInfo.writeUInt32LE(0x1c, 4); // LinkInfoHeaderSize
  linkInfo.writeUInt32LE(0, 8); // LinkInfoFlags: no VolumeIDAndLocalBasePath, no CNRL
  linkInfo.writeUInt32LE(0, 12); // VolumeIDOffset
  linkInfo.writeUInt32LE(0, 16); // LocalBasePathOffset
  linkInfo.writeUInt32LE(0, 20); // CommonNetworkRelativeLinkOffset
  linkInfo.writeUInt32LE(0, 24); // CommonPathSuffixOffset

  const buf = Buffer.concat([buildHeader(flags), idListSizeField, linkInfo]);
  const parsed = parseLnk(buf);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.flags.HasLinkTargetIDList, true);
  assert.equal(parsed.flags.HasLinkInfo, true);
  assert.equal(parsed.flags.ForceNoLinkInfo, true);
  assert.equal(
    parsed.candidates.length,
    0,
    'ForceNoLinkInfo must make LinkInfo unusable, and there is no env block to fall back to -- zero candidates',
  );
  assert.equal(parsed.resolvedTargetPath, null);
  assert.equal(
    parsed.category.idListOnly,
    false,
    'HasLinkInfo is true, so the narrower structural idListOnly predicate (HasLinkTargetIDList && !HasLinkInfo) must stay false -- this is precisely the drift case round-3 finding 7 identified',
  );
  assert.equal(
    parsed.category.noUsablePathSource,
    true,
    'candidates.length === 0 despite HasLinkInfo being true (ForceNoLinkInfo strips it) -- this row must be classified into the honest coverage-gap bucket, not fall through into unexpectedParserEmptyGapCount',
  );
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
