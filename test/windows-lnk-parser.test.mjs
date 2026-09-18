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
//   - Round-4 minor 4: parseExtraData silently stopped on a truncated or
//     size-lying ExtraData block with no signal, degrading a corrupt file
//     into the same bucket an honest IDList-only shortcut lands in -- the
//     one bucket the benchmark's exit code does not gate on.
//   - Round-4 minor 5: expandEnvVars' per-process key-cache was populated
//     once and never refreshed, so a call made before the environment was
//     fully populated permanently and silently locked in an incomplete
//     keyset for the rest of the process's life.
//   - Round-7 major 2: CommonNetworkRelativeLink (the UNC path, including
//     the ANSI-vs-Unicode NetNameOffset fork at lnk-parser.mjs:262) shipped
//     as the primary resolution mechanism for UNC shortcuts with zero test
//     coverage -- no real sample on this machine, no synthetic fixture.
//     Two fixtures below exercise both forks; the Unicode-fork fixture uses
//     a deliberately-wrong ANSI value so the assertion discriminates
//     whether the fork actually executed, not just whether some candidate
//     was produced.
//   - Round-7 minor 3: no fixture in this file used a path containing a
//     space, despite task rule 5 naming that explicitly. The env-var
//     expansion test's target now does.
//   - Round-10 blocker 1: a Start Menu scan ROOT that does not exist was
//     silently swallowed identically to a directory that vanishes
//     mid-walk (both ENOENT, both previously "expected, skip silently"),
//     dropping up to a third of the corpus with zero signal and a clean
//     exit 0. walkLnkFiles now distinguishes the two: a missing ROOT is
//     recorded as `MISSING_SCAN_ROOT`; a directory that disappears
//     mid-walk stays benign and silent, exactly as before.
//   - Round-10 minor 3: the 113 lines of --write-canonical gate logic
//     (gitPorcelainStatusForPath, gitPathIsTracked, resolveReportPath,
//     isoForFilename) had zero automated coverage -- every branch was
//     verified only by hand. resolveReportPath now throws
//     `ReportPathRefusal` (with a machine-checkable `reason`) instead of
//     calling `process.exit(1)` directly, and accepts injectable
//     `isTracked`/`porcelainStatus`/`log`/`logError` deps, so its four
//     outcomes (tracked+clean, dirty, untracked, git-unreadable) are
//     testable in-process without spawning real git or killing the test
//     runner. The two git helpers are separately integration-tested
//     against real throwaway git repos.
//   - Round-10 blocker 1 ("preferably also" clause): resolveStartMenuRoots
//     and knownFolderFromRegistry -- the registry known-folder mechanism
//     the fix introduced to resolve the two Start Menu roots -- shipped
//     with zero automated coverage of the mechanism itself (only
//     MISSING_SCAN_ROOT, downstream of resolution, was guarded). Covered
//     via the existing `spawnImpl`/`regQuery` injection seams: REG_SZ
//     line parsing (embedded vs. trailing whitespace), REG_EXPAND_SZ/
//     non-zero status/empty stdout/ENOENT (`.error`)/a throwing
//     `spawnImpl` all resolving to null rather than a partial value, and
//     per-root independent fallback (one root registry-resolved, the
//     other env-var-reconstructed, in both directions).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseLnk, expandEnvVars } from '../measure/windows/lnk-parser.mjs';
import {
  compareTiered,
  walkLnkFiles,
  resolveReportPath,
  ReportPathRefusal,
  knownFolderFromRegistry,
  resolveStartMenuRoots,
  gitPorcelainStatusForPath,
  gitPathIsTracked,
  isoForFilename,
} from '../measure/windows/proof-03-lnk-benchmark.mjs';

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
const HAS_LINK_INFO = 1 << 1;
const CNRL_AND_PATH_SUFFIX = 1 << 1; // LinkInfoFlags.CommonNetworkRelativeLinkAndPathSuffix

/**
 * Builds a CommonNetworkRelativeLink structure (section 2.3.2) whose
 * NetNameOffset is exactly 0x14 -- the boundary value at which
 * lnk-parser.mjs's `hasUnicodeOffsets = netNameOffset > 0x14` fork (:262)
 * evaluates FALSE, so only the ANSI NetName field is present/read. No
 * device name (ValidDevice left unset).
 */
function buildCnrlAnsiOnly(netNameAnsi) {
  const FIXED_HEADER_SIZE = 0x14; // Size, Flags, NetNameOffset, DeviceNameOffset, NetworkProviderType
  const netNameBytes = Buffer.from(`${netNameAnsi}\0`, 'latin1');
  const size = FIXED_HEADER_SIZE + netNameBytes.length;
  const buf = Buffer.alloc(size);
  buf.writeUInt32LE(size, 0); // Size
  buf.writeUInt32LE(0, 4); // Flags: ValidDevice not set
  buf.writeUInt32LE(FIXED_HEADER_SIZE, 8); // NetNameOffset == 0x14 -- NOT > 0x14, ANSI-only fork
  buf.writeUInt32LE(0, 12); // DeviceNameOffset (unused, ValidDevice unset)
  buf.writeUInt32LE(0, 16); // NetworkProviderType (not read by lnk-parser.mjs)
  netNameBytes.copy(buf, FIXED_HEADER_SIZE);
  return buf;
}

/**
 * Builds a CommonNetworkRelativeLink structure whose NetNameOffset is 0x1c
 * (> 0x14), so lnk-parser.mjs's `hasUnicodeOffsets` fork (:262) evaluates
 * TRUE and NetNameOffsetUnicode/DeviceNameOffsetUnicode are read (:266-267)
 * and the Unicode NetName is what the parser actually uses (:276-277).
 *
 * The ANSI NetName field is populated with a DELIBERATELY WRONG value
 * (`netNameAnsiWrong`) distinct from the correct Unicode value: if the
 * parser's Unicode-offset fork were dead code (e.g. `netNameUnicode ??
 * netName` silently fell through to the ANSI field), this fixture would
 * still resolve to a path, but to the WRONG one -- making the assertion
 * below actually discriminate whether :262-277 executed, not just whether
 * SOME candidate was produced.
 */
function buildCnrlWithUnicodeOffsets(netNameAnsiWrong, netNameUnicode) {
  const FIXED_HEADER_SIZE = 0x1c; // Size, Flags, NetNameOffset, DeviceNameOffset, NetworkProviderType, NetNameOffsetUnicode, DeviceNameOffsetUnicode
  const ansiBytes = Buffer.from(`${netNameAnsiWrong}\0`, 'latin1');
  const netNameOffsetUnicode = FIXED_HEADER_SIZE + ansiBytes.length;
  const unicodeBytes = Buffer.from(`${netNameUnicode}\0`, 'utf16le');
  const size = netNameOffsetUnicode + unicodeBytes.length;
  const buf = Buffer.alloc(size);
  buf.writeUInt32LE(size, 0); // Size
  buf.writeUInt32LE(0, 4); // Flags: ValidDevice not set
  buf.writeUInt32LE(FIXED_HEADER_SIZE, 8); // NetNameOffset == 0x1c -- > 0x14, Unicode-offset fork
  buf.writeUInt32LE(0, 12); // DeviceNameOffset (unused)
  buf.writeUInt32LE(0, 16); // NetworkProviderType (not read by lnk-parser.mjs)
  buf.writeUInt32LE(netNameOffsetUnicode, 20); // NetNameOffsetUnicode
  buf.writeUInt32LE(0, 24); // DeviceNameOffsetUnicode (unused)
  ansiBytes.copy(buf, FIXED_HEADER_SIZE);
  unicodeBytes.copy(buf, netNameOffsetUnicode);
  return buf;
}

/**
 * Builds a LinkInfo structure (section 2.3) carrying ONLY a
 * CommonNetworkRelativeLink (VolumeIDAndLocalBasePath left unset, so
 * `resolvedLocal` is null and `linkinfo-unc` is the ONLY -- hence primary
 * -- candidate this LinkInfo can produce). `commonPathSuffix` is prefixed
 * with its own leading separator: lnk-parser.mjs concatenates
 * `netFull + suffix` with NO separator inserted between them (:342), so the
 * separator must live inside the suffix string, exactly as a real .lnk
 * written by Explorer stores it.
 */
function buildLinkInfoWithCnrl(cnrlBuf, commonPathSuffix) {
  const FIXED_HEADER_SIZE = 0x1c; // LinkInfoHeaderSize < 0x24 -- Unicode local-base-path offset fields absent
  const cnrlOffset = FIXED_HEADER_SIZE;
  const suffixOffset = cnrlOffset + cnrlBuf.length;
  const suffixBytes = Buffer.from(`${commonPathSuffix}\0`, 'latin1');
  const size = suffixOffset + suffixBytes.length;
  const buf = Buffer.alloc(size);
  buf.writeUInt32LE(size, 0); // LinkInfoSize
  buf.writeUInt32LE(FIXED_HEADER_SIZE, 4); // LinkInfoHeaderSize
  buf.writeUInt32LE(CNRL_AND_PATH_SUFFIX, 8); // LinkInfoFlags: CNRL present, VolumeIDAndLocalBasePath NOT set
  buf.writeUInt32LE(0, 12); // VolumeIDOffset (unused)
  buf.writeUInt32LE(0, 16); // LocalBasePathOffset (unused -- VolumeIDAndLocalBasePath unset)
  buf.writeUInt32LE(cnrlOffset, 20); // CommonNetworkRelativeLinkOffset
  buf.writeUInt32LE(suffixOffset, 24); // CommonPathSuffixOffset
  cnrlBuf.copy(buf, cnrlOffset);
  suffixBytes.copy(buf, suffixOffset);
  return buf;
}

test('resolvedTargetPath for an env-var shortcut is the EXPANDED form, not the raw %VAR% string -- expansion target contains a space (round-7 minor finding 3)', () => {
  // The expansion target deliberately contains a space
  // ('Program Files'-shaped), per task rule 5 ("test with a path containing
  // a space") -- round-7 minor finding 3 found every synthetic fixture in
  // this file was space-free even though task rule 5 names spaces
  // explicitly. This is the right fixture to carry that coverage: %VAR%
  // expansion into a spaced path is where a naive split/quote/trim bug
  // would surface, and this test already asserts the exact expanded string.
  process.env.DECKTECH_TEST_LNK_VAR = 'C:\\Fake\\Program Files\\Dir';
  try {
    const raw = '%DECKTECH_TEST_LNK_VAR%\\sub\\app.exe';
    const buf = Buffer.concat([buildHeader(HAS_EXP_STRING), buildEnvBlock(raw, raw)]);
    const parsed = parseLnk(buf);

    assert.equal(parsed.valid, true);
    assert.equal(parsed.category.envVar, true);
    assert.equal(
      parsed.resolvedTargetPath,
      'C:\\Fake\\Program Files\\Dir\\sub\\app.exe',
      'resolvedTargetPath must be the EXPANDED path (round-2 blocker 1) -- if this fails with the raw "%DECKTECH_TEST_LNK_VAR%\\..." string, env-raw is outranking env-expanded again',
    );
    assert.ok(!parsed.resolvedTargetPath.includes('%'), 'resolvedTargetPath must not contain an unexpanded %VAR%');

    // The raw form must still be PRESENT (as a diagnostic candidate,
    // round-2 fix note (a)) -- just not primary.
    assert.equal(parsed.candidates[0].source, 'env-expanded');
    assert.equal(parsed.candidates[0].value, 'C:\\Fake\\Program Files\\Dir\\sub\\app.exe');
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

test('a UNC shortcut (CommonNetworkRelativeLink, ANSI NetName offset fork) resolves to the reconstructed \\\\server\\share path as the PRIMARY candidate -- round-7 major finding 2', () => {
  // The CommonNetworkRelativeLink / UNC path -- the most intricate offset
  // arithmetic in the parser, including the ANSI-vs-Unicode offset fork at
  // lnk-parser.mjs:262 -- shipped in round 6 with zero test coverage of any
  // kind (no real sample on this machine, no synthetic fixture), even
  // though this file already builds synthetic fixtures for other branches
  // real files never reach (the ANSI env-var fallback, the truncated
  // ExtraData block). This fixture exercises the NetNameOffset == 0x14
  // (NOT > 0x14) ANSI-only fork.
  const cnrl = buildCnrlAnsiOnly('\\\\server\\share');
  const linkInfo = buildLinkInfoWithCnrl(cnrl, '\\sub\\app.exe');
  const buf = Buffer.concat([buildHeader(HAS_LINK_INFO), linkInfo]);
  const parsed = parseLnk(buf);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.flags.HasLinkInfo, true);
  assert.equal(parsed.linkInfo.hasCommonNetworkRelativeLink, true);
  assert.equal(parsed.category.unc, true);
  assert.equal(
    parsed.linkInfo.commonNetworkRelativeLink.netNameUnicode,
    null,
    'NetNameOffset == 0x14 must NOT trigger the Unicode-offset fork (lnk-parser.mjs:262, hasUnicodeOffsets = netNameOffset > 0x14)',
  );
  assert.equal(
    parsed.candidates[0].source,
    'linkinfo-unc',
    'with VolumeIDAndLocalBasePath unset, linkinfo-unc must be the ONLY (hence primary) candidate',
  );
  assert.equal(parsed.candidates[0].value, '\\\\server\\share\\sub\\app.exe');
  assert.equal(parsed.resolvedTargetPath, '\\\\server\\share\\sub\\app.exe');
});

test('a UNC shortcut (CommonNetworkRelativeLink, Unicode NetName offset fork) resolves via the Unicode field, not the deliberately-wrong ANSI one -- round-7 major finding 2', () => {
  // NetNameOffset == 0x1c (> 0x14) so hasUnicodeOffsets is TRUE and
  // lnk-parser.mjs:266-277 -- the branch round 6 shipped with zero
  // coverage -- is the code path that actually executes. The ANSI NetName
  // field is deliberately WRONG ('\\server\WRONG-ANSI'); if the
  // Unicode-offset fork were dead code and the reconstruction silently fell
  // back to the ANSI field (or if `netNameUnicode ?? netName` were flipped
  // to `netName ?? netNameUnicode`), this assertion would catch it by
  // resolving to the wrong share name instead of just failing to resolve.
  const cnrl = buildCnrlWithUnicodeOffsets('\\\\server\\WRONG-ANSI', '\\\\server\\share');
  const linkInfo = buildLinkInfoWithCnrl(cnrl, '\\sub\\app.exe');
  const buf = Buffer.concat([buildHeader(HAS_LINK_INFO), linkInfo]);
  const parsed = parseLnk(buf);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.linkInfo.hasCommonNetworkRelativeLink, true);
  assert.equal(parsed.category.unc, true);
  assert.equal(
    parsed.linkInfo.commonNetworkRelativeLink.netName,
    '\\\\server\\WRONG-ANSI',
    'sanity check: the deliberately-wrong ANSI field must actually be present and readable (it must be the Unicode fork, not an absent field, that makes the assertion below pass)',
  );
  assert.equal(
    parsed.linkInfo.commonNetworkRelativeLink.netNameUnicode,
    '\\\\server\\share',
    'NetNameOffset == 0x1c (> 0x14) must trigger the Unicode-offset fork (lnk-parser.mjs:262-267)',
  );
  assert.equal(parsed.candidates[0].source, 'linkinfo-unc');
  assert.equal(
    parsed.candidates[0].value,
    '\\\\server\\share\\sub\\app.exe',
    'resolvedUnc must be built from netNameUnicode (the correct value), not netName (the deliberately-wrong ANSI value) -- if this reads "\\\\server\\WRONG-ANSI\\sub\\app.exe", the Unicode-offset fork at lnk-parser.mjs:262-277 is dead code or the ?? precedence at :341 was flipped',
  );
  assert.equal(parsed.resolvedTargetPath, '\\\\server\\share\\sub\\app.exe');
});

test('a .lnk with a truncated/size-lying ExtraData block sets extraDataTruncated, not silently a plain zero-candidate result -- round-4 minor finding 4', () => {
  // No LinkTargetIDList, no LinkInfo, no StringData -- ExtraData starts
  // immediately after the 0x4c-byte header. The block claims the full
  // EnvironmentVariableDataBlock size (0x314) via BlockSize, but only 20
  // bytes actually follow -- far short of what BlockSize promises. This is
  // the "size field lies about the file's real length" shape, the same
  // defect class round-2 major finding 4 guarded for LinkInfo/IDList, now
  // guarded for ExtraData.
  const claimedBlockSize = 0x314;
  const extraDataOffset = 0x4c; // right after the header, flags = 0
  const truncatedBlock = Buffer.alloc(20);
  truncatedBlock.writeUInt32LE(claimedBlockSize, 0); // BlockSize: claims 0x314...
  truncatedBlock.writeUInt32LE(0xa0000001, 4); // BlockSignature: EnvironmentVariableDataBlock
  // ...but only 20 bytes total are actually present (12 bytes of "data"
  // follow the 8-byte block header here, nowhere near 0x314).

  const buf = Buffer.concat([buildHeader(0), truncatedBlock]);
  let parsed;
  assert.doesNotThrow(() => {
    parsed = parseLnk(buf);
  }, 'a truncated ExtraData block must never throw a raw RangeError');

  assert.equal(parsed.valid, true, 'a truncated ExtraData block does not invalidate the whole .lnk -- everything read before it (header, in this case) is still valid');
  assert.ok(parsed.extraDataTruncated, 'extraDataTruncated must be set (non-null) when a block\'s claimed size does not fit the remaining buffer');
  assert.equal(parsed.extraDataTruncated.offset, extraDataOffset);
  assert.equal(parsed.extraDataTruncated.claimedBlockSize, claimedBlockSize);
  assert.equal(parsed.extraDataTruncated.bufLength, buf.length);
  assert.equal(parsed.envBlock, null, 'the truncated block must not be decoded as a usable env block');
  assert.equal(parsed.candidates.length, 0);
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

test('expandEnvVars picks up a process.env var set AFTER an earlier call -- round-4 minor finding 5 (stale per-process cache regression guard)', () => {
  // This is the exact regression round-2 minor finding 10a's cache
  // introduced and round-4 minor finding 5 reverted: a call made BEFORE a
  // variable is set must not permanently poison every later expansion of
  // that same variable. If expandEnvVars ever re-gains a cache populated
  // once and never refreshed, this call (before the var exists) locks in
  // the miss and the second call (after the var exists) would still
  // return the raw '%...%' string.
  const name = 'DECKTECH_TEST_LNK_VAR_LATE';
  delete process.env[name];
  try {
    // First call: the variable does not exist yet -- must fall through to
    // the raw string, same as any genuinely-unknown %VAR%.
    assert.equal(expandEnvVars(`%${name}%\\x`), `%${name}%\\x`);

    // Variable appears AFTER that first call (e.g. a long-lived server
    // finishing startup, dotenv running late, PATH being extended).
    process.env[name] = 'C:\\Late\\Value';

    assert.equal(
      expandEnvVars(`%${name}%\\x`),
      'C:\\Late\\Value\\x',
      'a second call after the env var appears must expand it -- if this still reads the raw %VAR% string, the key-cache from the first call was reused instead of rebuilt',
    );
  } finally {
    delete process.env[name];
  }
});

// --- Round-10 blocker finding 1: walkLnkFiles root-vs-mid-walk ENOENT ---

test('walkLnkFiles: a scan ROOT that does not exist is recorded as MISSING_SCAN_ROOT, not silently skipped -- round-10 blocker finding 1', () => {
  const dirErrors = [];
  // A path containing a space, per task rule 5.
  const files = walkLnkFiles('C:\\Definitely Not A Real Path\\Sub Dir 42', dirErrors);

  assert.deepEqual(files, []);
  assert.equal(dirErrors.length, 1);
  assert.equal(dirErrors[0].code, 'MISSING_SCAN_ROOT');
  assert.match(dirErrors[0].message, /never expected to be missing/);
});

test('walkLnkFiles: a directory that disappears MID-WALK (ENOENT below the root) stays silent -- no dirErrors entry -- round-10 blocker finding 1', () => {
  const dirErrors = [];
  const seen = [];
  // Injected readdirImpl: the ROOT resolves fine and reports one
  // subdirectory; that subdirectory itself throws ENOENT when walked --
  // simulating a directory that vanished between the root's own
  // readdirSync call and the recursive one for 'sub', without racing a
  // real filesystem deletion.
  const fakeReaddir = (dir) => {
    seen.push(dir);
    if (dir === 'C:\\root') {
      return [{ name: 'sub', isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }];
    }
    if (dir === 'C:\\root\\sub') {
      const err = new Error('simulated: directory vanished mid-walk');
      err.code = 'ENOENT';
      throw err;
    }
    throw new Error(`unexpected dir in fake readdir: ${dir}`);
  };

  const files = walkLnkFiles('C:\\root', dirErrors, { readdirImpl: fakeReaddir });

  assert.deepEqual(files, []);
  assert.deepEqual(dirErrors, [], 'a mid-walk ENOENT must stay benign -- no MISSING_SCAN_ROOT, no entry at all');
  assert.deepEqual(seen, ['C:\\root', 'C:\\root\\sub'], 'sanity: the recursive call into the vanished subdirectory must actually have happened');
});

test('walkLnkFiles: a non-ENOENT error at the ROOT (e.g. EACCES) is recorded with its real code, not MISSING_SCAN_ROOT', () => {
  const dirErrors = [];
  const fakeReaddir = () => {
    const err = new Error('simulated: permission denied');
    err.code = 'EACCES';
    throw err;
  };
  const files = walkLnkFiles('C:\\root', dirErrors, { readdirImpl: fakeReaddir });

  assert.deepEqual(files, []);
  assert.equal(dirErrors.length, 1);
  assert.equal(dirErrors[0].code, 'EACCES', 'a real permission error at the root must keep its own code, not be relabeled MISSING_SCAN_ROOT');
});

// --- Round-10 blocker finding 1 ("preferably also" clause): registry
// known-folder resolution (knownFolderFromRegistry/resolveStartMenuRoots)
// shipped with the fix but with zero automated coverage of the mechanism
// itself -- every scenario below uses the `spawnImpl`/`regQuery` seams the
// functions already expose, no new seam added. ---

test('knownFolderFromRegistry: a stubbed REG_SZ line parses to the exact path -- embedded space kept, trailing padding stripped', () => {
  // Shaped like real `reg query <key> /v <name>` column output: the value
  // token is padded with trailing spaces before the CRLF, and the path
  // itself contains an embedded space ("Test User") that must NOT be
  // collapsed or truncated by the parser (the docblock's "does not
  // split-and-rejoin on whitespace" claim).
  const stdout = '\r\n'
    + 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders\r\n'
    + '    Programs    REG_SZ    C:\\Users\\Test User\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs   \r\n'
    + '\r\n';
  const spawnImpl = () => ({ error: null, status: 0, stdout, stderr: '' });

  const result = knownFolderFromRegistry('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'Programs', { spawnImpl });

  assert.equal(result, 'C:\\Users\\Test User\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs');
});

test('knownFolderFromRegistry: a REG_EXPAND_SZ line (not REG_SZ) is not treated as the value -- returns null, never the unexpanded %VAR% string', () => {
  // `Shell Folders` (unlike `User Shell Folders`) is documented to always
  // hold a resolved REG_SZ. If this machine's key somehow returned
  // REG_EXPAND_SZ instead, the function must not silently hand back an
  // unexpanded '%VAR%'-shaped string as if it were resolved.
  const stdout = '\r\nHKEY_CURRENT_USER\\...\\Shell Folders\r\n    Programs    REG_EXPAND_SZ    %APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\r\n\r\n';
  const spawnImpl = () => ({ error: null, status: 0, stdout, stderr: '' });

  const result = knownFolderFromRegistry('HKCU\\...\\Shell Folders', 'Programs', { spawnImpl });

  assert.equal(result, null);
});

test('knownFolderFromRegistry: a non-zero reg.exe exit status returns null even though stdout is non-empty and REG_SZ-shaped -- discriminates the status guard from the empty-stdout guard', () => {
  // stdout is deliberately populated with a well-formed REG_SZ line so
  // this can only return non-null if the `proc.status !== 0` check is
  // skipped -- an empty-stdout stub would let a weaker implementation
  // (one missing only the status check) pass by accident.
  const stdout = '\r\nHKEY_CURRENT_USER\\...\\Shell Folders\r\n    Programs    REG_SZ    C:\\Users\\bob\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\r\n\r\n';
  const spawnImpl = () => ({ error: null, status: 1, stdout, stderr: 'ERROR: The system was unable to find the specified registry key or value.\r\n' });

  const result = knownFolderFromRegistry('HKCU\\...\\Shell Folders', 'Programs', { spawnImpl });

  assert.equal(result, null);
});

test('knownFolderFromRegistry: empty stdout (status 0) returns null', () => {
  const spawnImpl = () => ({ error: null, status: 0, stdout: '', stderr: '' });

  const result = knownFolderFromRegistry('HKCU\\...\\Shell Folders', 'Programs', { spawnImpl });

  assert.equal(result, null);
});

test('knownFolderFromRegistry: reg.exe missing from PATH (spawnSync sets .error, ENOENT) returns null -- the docblock\'s "reg.exe not found" case', () => {
  // Per Node's spawnSync contract, a command that cannot be launched at
  // all (e.g. not found on PATH) reports the failure via `.error` (an
  // ErrnoException) with `.status` left null and no stdout -- distinct
  // from a command that ran and exited non-zero.
  const enoent = new Error('spawnSync reg ENOENT');
  enoent.code = 'ENOENT';
  const spawnImpl = () => ({ error: enoent, status: null, stdout: undefined, stderr: undefined });

  const result = knownFolderFromRegistry('HKCU\\...\\Shell Folders', 'Programs', { spawnImpl });

  assert.equal(result, null);
});

test('knownFolderFromRegistry: a throwing spawnImpl is caught -- returns null, never propagates', () => {
  const spawnImpl = () => { throw new Error('simulated: spawnSync itself threw (e.g. EPERM on the sandbox)'); };

  const result = knownFolderFromRegistry('HKCU\\...\\Shell Folders', 'Programs', { spawnImpl });

  assert.equal(result, null);
});

test('resolveStartMenuRoots: per-root independent fallback -- Common (HKLM) resolves from the registry while User (HKCU) falls back to %APPDATA%, verified independently', () => {
  const savedProgramData = process.env.ProgramData;
  const savedAppData = process.env.APPDATA;
  // A space in the fallback fixture doubles as coverage for task rule 5
  // (path.join over hardcoded separators, exercised with a space).
  process.env.ProgramData = 'C:\\Unused ProgramData';
  process.env.APPDATA = 'C:\\Users\\Test User\\AppData\\Roaming';
  try {
    const calls = [];
    const regQuery = (key, valueName) => {
      calls.push({ key, valueName });
      if (key.startsWith('HKLM')) return 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs';
      return null; // HKCU (User) lookup fails -- must fall back independently
    };

    const roots = resolveStartMenuRoots([], { regQuery });

    assert.deepEqual(roots[0], { path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs', source: 'registry-known-folder' });
    assert.deepEqual(roots[1], {
      path: join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      source: 'env-var-reconstruction-fallback',
    });
    assert.equal(calls.length, 2);
    assert.ok(calls.some((c) => c.key.startsWith('HKLM') && c.valueName === 'Common Programs'), 'the all-users root must be queried under HKLM with value name "Common Programs"');
    assert.ok(calls.some((c) => c.key.startsWith('HKCU') && c.valueName === 'Programs'), 'the per-user root must be queried under HKCU with value name "Programs"');
  } finally {
    if (savedProgramData === undefined) delete process.env.ProgramData; else process.env.ProgramData = savedProgramData;
    if (savedAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = savedAppData;
  }
});

test('resolveStartMenuRoots: per-root independent fallback -- the OPPOSITE root falls back this time, proving the decision is not shared between the two', () => {
  const savedProgramData = process.env.ProgramData;
  const savedAppData = process.env.APPDATA;
  process.env.ProgramData = 'C:\\Test ProgramData';
  process.env.APPDATA = 'C:\\Unused AppData';
  try {
    const regQuery = (key) => {
      if (key.startsWith('HKCU')) return 'C:\\Users\\bob\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs';
      return null; // HKLM (Common) lookup fails this time
    };

    const roots = resolveStartMenuRoots([], { regQuery });

    assert.deepEqual(roots[0], {
      path: join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      source: 'env-var-reconstruction-fallback',
    });
    assert.deepEqual(roots[1], { path: 'C:\\Users\\bob\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs', source: 'registry-known-folder' });
  } finally {
    if (savedProgramData === undefined) delete process.env.ProgramData; else process.env.ProgramData = savedProgramData;
    if (savedAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = savedAppData;
  }
});

// --- Round-10 minor finding 3: --write-canonical gate coverage ---

test('isoForFilename never produces a ":" -- Windows basenames cannot contain it', () => {
  const name = isoForFilename(new Date('2026-09-18T12:34:56.789Z'));
  assert.ok(!name.includes(':'), `isoForFilename output must not contain ':': got "${name}"`);
  assert.equal(name, '2026-09-18T12-34-56.789Z');
});

test('resolveReportPath: default (no --write-canonical) returns an untracked timestamped path and never touches git', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'decktech-proof03-test-'));
  try {
    let isTrackedCalls = 0;
    let porcelainCalls = 0;
    const logs = [];
    const path = resolveReportPath([], tmp, {
      isTracked: () => { isTrackedCalls += 1; return true; },
      porcelainStatus: () => { porcelainCalls += 1; return ''; },
      log: (...a) => logs.push(a.join(' ')),
      logError: () => { throw new Error('logError must not be called on the default path'); },
    });
    assert.match(path, /proof-03-results-.*\.json$/);
    assert.ok(path.includes(join(tmp, 'out')));
    assert.equal(isTrackedCalls, 0, 'the default (no --write-canonical) branch must never call the git helpers');
    assert.equal(porcelainCalls, 0);
    assert.ok(logs.some((l) => l.includes('untracked, timestamped')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveReportPath: --write-canonical with a tracked, clean path returns the canonical path', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'decktech-proof03-test-'));
  try {
    const path = resolveReportPath(['--write-canonical'], tmp, {
      isTracked: () => true,
      porcelainStatus: () => '', // empty porcelain output == clean
      log: () => {},
      logError: () => { throw new Error('logError must not be called on the clean/tracked path'); },
    });
    assert.equal(path, join(tmp, 'proof-03-results.json'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveReportPath: --write-canonical on a DIRTY tracked path refuses with reason "dirty"', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'decktech-proof03-test-'));
  try {
    const errors = [];
    assert.throws(
      () => resolveReportPath(['--write-canonical'], tmp, {
        isTracked: () => true,
        porcelainStatus: () => ' M measure/windows/proof-03-results.json\n',
        log: () => {},
        logError: (...a) => errors.push(a.join(' ')),
      }),
      (err) => {
        assert.ok(err instanceof ReportPathRefusal);
        assert.equal(err.reason, 'dirty');
        return true;
      },
    );
    assert.ok(errors.some((l) => l.includes('uncommitted diff')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveReportPath: --write-canonical on an UNTRACKED path refuses with reason "untracked"', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'decktech-proof03-test-'));
  try {
    assert.throws(
      () => resolveReportPath(['--write-canonical'], tmp, {
        isTracked: () => false,
        porcelainStatus: () => '', // git ran fine, path just isn't tracked
        log: () => {},
        logError: () => {},
      }),
      (err) => {
        assert.ok(err instanceof ReportPathRefusal);
        assert.equal(err.reason, 'untracked');
        return true;
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveReportPath: --write-canonical when git itself is unreadable refuses with reason "git-unreadable", NOT "untracked" -- git-unreadable must win the precedence -- round-10 minor finding 3', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'decktech-proof03-test-'));
  try {
    // With git unreachable, `ls-files` would independently fail too --
    // isTracked returning false here models that correctly (this state,
    // where git is gone but isTracked still claims "true", cannot occur
    // in reality and is deliberately NOT what this test injects).
    assert.throws(
      () => resolveReportPath(['--write-canonical'], tmp, {
        isTracked: () => false,
        porcelainStatus: () => null, // git status/ls-files could not be run at all
        log: () => {},
        logError: () => {},
      }),
      (err) => {
        assert.ok(err instanceof ReportPathRefusal);
        assert.equal(err.reason, 'git-unreadable', 'statusOutput === null must be diagnosed as git-unreadable, not misreported as untracked');
        return true;
      },
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Round-10 minor finding 3: gitPorcelainStatusForPath / gitPathIsTracked
// integration-tested against REAL throwaway git repos (not mocks), so the
// actual `git status --porcelain`/`git ls-files --error-unmatch` subprocess
// interaction is verified, not just resolveReportPath's branching on top
// of it. ---

function initThrowawayRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'decktech-proof03-gitrepo-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'decktech-test',
    GIT_AUTHOR_EMAIL: 'decktech-test@example.invalid',
    GIT_COMMITTER_NAME: 'decktech-test',
    GIT_COMMITTER_EMAIL: 'decktech-test@example.invalid',
  };
  const run = (args) => {
    const proc = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env });
    if (proc.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${proc.stderr}`);
    return proc.stdout;
  };
  run(['init', '--quiet']);
  run(['config', 'commit.gpgsign', 'false']);
  return { dir, run };
}

test('gitPathIsTracked / gitPorcelainStatusForPath: a committed, unmodified file is tracked and clean', () => {
  const { dir, run } = initThrowawayRepo();
  try {
    const filePath = join(dir, 'tracked-clean.txt');
    writeFileSync(filePath, 'hello\n', 'utf8');
    run(['add', 'tracked-clean.txt']);
    run(['commit', '--quiet', '-m', 'add tracked-clean.txt']);

    assert.equal(gitPathIsTracked(dir, filePath), true);
    assert.equal(gitPorcelainStatusForPath(dir, filePath), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitPathIsTracked / gitPorcelainStatusForPath: a committed file with an uncommitted edit is tracked but dirty', () => {
  const { dir, run } = initThrowawayRepo();
  try {
    const filePath = join(dir, 'tracked-dirty.txt');
    writeFileSync(filePath, 'hello\n', 'utf8');
    run(['add', 'tracked-dirty.txt']);
    run(['commit', '--quiet', '-m', 'add tracked-dirty.txt']);
    writeFileSync(filePath, 'hello, modified\n', 'utf8');

    assert.equal(gitPathIsTracked(dir, filePath), true);
    const status = gitPorcelainStatusForPath(dir, filePath);
    assert.notEqual(status, '');
    assert.notEqual(status, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitPathIsTracked / gitPorcelainStatusForPath: a file that was never `git add`-ed is untracked', () => {
  const { dir, run } = initThrowawayRepo();
  try {
    // Repo needs at least one commit for `git status` to behave normally
    // on an otherwise-empty repo.
    writeFileSync(join(dir, 'seed.txt'), 'seed\n', 'utf8');
    run(['add', 'seed.txt']);
    run(['commit', '--quiet', '-m', 'seed']);

    const filePath = join(dir, 'never-added.txt');
    writeFileSync(filePath, 'orphan\n', 'utf8');

    assert.equal(gitPathIsTracked(dir, filePath), false);
    const status = gitPorcelainStatusForPath(dir, filePath);
    assert.notEqual(status, null, 'git ran fine here -- an untracked file is a valid (non-null) porcelain result, distinct from git being unreachable');
    assert.match(status, /^\?\? /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gitPathIsTracked / gitPorcelainStatusForPath: outside any git repo, both fail closed (false / null), never a false "clean"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'decktech-proof03-nonrepo-'));
  try {
    const filePath = join(dir, 'whatever.txt');
    writeFileSync(filePath, 'x\n', 'utf8');

    assert.equal(gitPathIsTracked(dir, filePath), false);
    assert.equal(gitPorcelainStatusForPath(dir, filePath), null, 'outside a repo, status must be null (unknown), never empty-string (which resolveReportPath reads as clean)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
