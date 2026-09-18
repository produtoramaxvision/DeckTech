// measure/windows/lnk-parser.mjs
//
// Pure-Node binary reader for the Shell Link (.LNK) Binary File Format.
//
// Source of truth: [MS-SHLLINK] "Shell Link (.LNK) Binary File Format",
// Microsoft Open Specifications, protocol revision 10.0 (2025-11-21),
// sections 2.1 (ShellLinkHeader), 2.1.1 (LinkFlags), 2.2 (LinkTargetIDList),
// 2.3 (LinkInfo), 2.3.2 (CommonNetworkRelativeLink), 2.4 (StringData),
// 2.5 (ExtraData), 2.5.4 (EnvironmentVariableDataBlock). Fetched directly
// from https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-shllink/
// on 2026-09-17 for PROOF-03 (see .maxvision/REQUIREMENTS.md).
//
// Deliberate scope limits (stated up front, not discovered by the reader):
//
//   1. LinkTargetIDList (section 2.2) item IDs are SKIPPED, not decoded.
//      Resolving a SHITEMID chain to a path requires shell namespace
//      resolution (SHGetPathFromIDList / IShellFolder), which native COM
//      provides and a pure-Node reader does not have access to. This
//      parser only reads the size of that structure to skip past it.
//      Concretely: a shortcut whose ONLY path information lives in the
//      IDList (HasLinkTargetIDList set, HasLinkInfo NOT set) cannot be
//      resolved to a target path by this parser. Such a shortcut's
//      resolvedTargetPath is null and category.idListOnly is true.
//
//   2. DarwinDataBlock (MSI-advertised shortcuts, HasDarwinID flag) is
//      detected but not resolved. Resolving it requires calling the
//      Windows Installer API (MsiGetShortcutTarget), not a binary read.
//      category.msiAdvertised reports its presence; the path is not
//      produced by this parser.
//
//   3. ANSI (non-Unicode) strings are decoded as Latin-1, which is only an
//      approximation of "the system default code page" the spec actually
//      specifies. On a pt-BR Windows install the real code page is
//      Windows-1252, which differs from Latin-1 for a handful of code
//      points. The Unicode variant of every string is preferred whenever
//      present (which is effectively always: IsUnicode is the overwhelming
//      common case for anything written since Windows Vista). If a
//      mismatch against COM ever traces to an ANSI-only field with
//      accented characters, that is this approximation, not a wrong
//      target.
//
// This module has zero dependencies and does no I/O; callers pass in an
// already-read Buffer (see proof-03-lnk-benchmark.mjs).
//
// --- ROUND-2 REVIEW FIXES (see docs/adr/0003-proof-03-lnk-binary-parsing.md) ---
//
//   (a) The PRIMARY candidate (candidates[0], which becomes
//       `resolvedTargetPath`) for an environment-variable shortcut is now
//       the EXPANDED form ('env-expanded'/'env-expanded-ansi'), not the
//       raw '%VAR%' string. The raw form is still produced as a secondary
//       diagnostic candidate (kept for the benchmark's raw-vs-expanded
//       report and env-var snapshot), it just no longer outranks the
//       expanded form for what this parser actually resolves a shortcut
//       to. Blocker 1 in round 2 found 35 of 182 shortcuts where the
//       previous priority order made the un-expanded '%windir%\...' string
//       the parser's real output while the benchmark's comparator reported
//       "exact match" by scanning past it to the expanded candidate.
//
//   (b) Every multi-byte read past the ShellLinkHeader is now bounds-checked
//       against the buffer length before it happens. A truncated or
//       corrupt .lnk (or a structure whose self-reported size field lies
//       about the file's real length) returns a structured
//       {valid:false, rejectReason} that names the structure and the
//       offset/size involved, instead of letting Node's Buffer methods
//       throw an unqualified RangeError. Major finding 4 in round 2.
//
//   (c) expandEnvVars() no longer rebuilds a case-folded map of
//       process.env on every call (it was doing so inside the loop the
//       benchmark times). The map is now a lazily-initialized, per-process
//       singleton. Minor finding 10a.
//
//   (d) parseExtraData's ExtraData block-signature census
//       (`blockSignaturesSeen`) is no longer computed and discarded: it is
//       returned as `extraDataBlockSignatures` on the parse result so a
//       caller (the benchmark) can persist and use it, instead of being
//       dead code. Minor finding 10b.
//
// --- ROUND-3 REVIEW FIXES (see docs/adr/0003-proof-03-lnk-binary-parsing.md) ---
//
//   (e) `category.noUsablePathSource` was added alongside the existing,
//       narrower `category.idListOnly` (HasLinkTargetIDList &&
//       !HasLinkInfo). `idListOnly` does not account for ForceNoLinkInfo:
//       a shortcut with LinkInfo present but spec-mandated-ignored, and no
//       env-var fallback, produces zero candidates while still reading
//       idListOnly: false. `noUsablePathSource` is derived directly from
//       `candidates.length === 0`, the SAME array the candidate builder
//       above produces, so gap classification (in the benchmark) cannot
//       drift from what this parser actually resolved. Round-3 minor
//       finding 7.

/** HeaderSize (section 2.1): ShellLinkHeader.HeaderSize MUST be this value. */
const HEADER_SIZE = 0x0000004c;

/**
 * LinkCLSID (section 2.1): ShellLinkHeader.LinkCLSID MUST be
 * 00021401-0000-0000-C000-000000000046, encoded as a little-endian GUID
 * (Data1 LE, Data2 LE, Data3 LE, Data4 as-is).
 */
const LINK_CLSID = Buffer.from([
  0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
]);

/** LinkFlags bit positions (section 2.1.1), bit 0 = least significant. */
const LINK_FLAGS = {
  HasLinkTargetIDList: 1 << 0,
  HasLinkInfo: 1 << 1,
  HasName: 1 << 2,
  HasRelativePath: 1 << 3,
  HasWorkingDir: 1 << 4,
  HasArguments: 1 << 5,
  HasIconLocation: 1 << 6,
  IsUnicode: 1 << 7,
  ForceNoLinkInfo: 1 << 8,
  HasExpString: 1 << 9,
  RunInSeparateProcess: 1 << 10,
  // bit 11 (Unused1) intentionally omitted -- MUST be ignored per spec.
  HasDarwinID: 1 << 12,
  RunAsUser: 1 << 13,
  HasExpIcon: 1 << 14,
  NoPidlAlias: 1 << 15,
  // bit 16 (Unused2) intentionally omitted -- MUST be ignored per spec.
  RunWithShimLayer: 1 << 17,
  ForceNoLinkTrack: 1 << 18,
  EnableTargetMetadata: 1 << 19,
  DisableLinkPathTracking: 1 << 20,
  DisableKnownFolderTracking: 1 << 21,
  DisableKnownFolderAlias: 1 << 22,
  AllowLinkToLink: 1 << 23,
  UnaliasOnSave: 1 << 24,
  PreferEnvironmentPath: 1 << 25,
  KeepLocalIDListForUNCTarget: 1 << 26,
};

/** LinkInfoFlags bit positions (section 2.3). */
const LINK_INFO_FLAGS = {
  VolumeIDAndLocalBasePath: 1 << 0,
  CommonNetworkRelativeLinkAndPathSuffix: 1 << 1,
};

/** CommonNetworkRelativeLinkFlags bit positions (section 2.3.2). */
const CNRL_FLAGS = {
  ValidDevice: 1 << 0,
  ValidNetType: 1 << 1,
};

/** ExtraData block signatures (section 2.5) relevant to target resolution. */
const BLOCK_SIGNATURE_ENVIRONMENT_VARIABLE = 0xa0000001; // section 2.5.4

/** EnvironmentVariableDataBlock.BlockSize MUST be this value (section 2.5.4). */
const ENV_BLOCK_SIZE = 0x00000314;

/**
 * Thrown when a read (fixed-size field or a variable-length structure whose
 * self-reported size is checked against the buffer) would run past the end
 * of the buffer. Always caught centrally in parseLnk and converted into a
 * structured {valid:false, rejectReason} result -- never allowed to surface
 * as a raw RangeError to a caller. See round-2 major finding 4.
 */
class LnkBoundsError extends Error {
  constructor(structName, offset, size, bufLength) {
    super(`${structName} needs ${size} byte(s) at 0x${offset.toString(16)} but the file is ${bufLength} bytes`);
    this.name = 'LnkBoundsError';
    this.structName = structName;
    this.offset = offset;
    this.size = size;
    this.bufLength = bufLength;
  }
}

/** Throws LnkBoundsError if [offset, offset+size) is not entirely within buf. */
function need(buf, offset, size, structName) {
  if (offset < 0 || size < 0 || offset + size > buf.length) {
    throw new LnkBoundsError(structName, offset, size, buf.length);
  }
}

function readU16(buf, offset, structName) {
  need(buf, offset, 2, structName);
  return buf.readUInt16LE(offset);
}

function readU32(buf, offset, structName) {
  need(buf, offset, 4, structName);
  return buf.readUInt32LE(offset);
}

function readNulTerminatedAnsi(buf, start, maxEnd) {
  let end = start;
  while (end < maxEnd && end < buf.length && buf[end] !== 0x00) end += 1;
  return buf.toString('latin1', start, end); // see limitation (3) above
}

function readNulTerminatedUtf16(buf, start, maxEnd) {
  let end = start;
  while (end + 1 < maxEnd && end + 1 < buf.length && !(buf[end] === 0x00 && buf[end + 1] === 0x00)) {
    end += 2;
  }
  return buf.toString('utf16le', start, end);
}

/**
 * Reads a StringData item (section 2.4): a 2-byte CountCharacters field
 * followed by exactly CountCharacters characters, NOT NUL-terminated.
 * Byte width per character is 2 (UTF-16LE) if isUnicode, else 1 (ANSI).
 */
function readStringDataItem(buf, offset, isUnicode, fieldName) {
  const count = readU16(buf, offset, `${fieldName}.CountCharacters`);
  const byteLen = count * (isUnicode ? 2 : 1);
  const strStart = offset + 2;
  const strEnd = strStart + byteLen;
  need(buf, strStart, byteLen, `${fieldName}.String`);
  const value = isUnicode
    ? buf.toString('utf16le', strStart, strEnd)
    : buf.toString('latin1', strStart, strEnd); // see limitation (3)
  return { value, nextOffset: strEnd };
}

/**
 * Parses the CommonNetworkRelativeLink structure (section 2.3.2), used
 * when a shortcut targets a UNC share. `cnrlBase` is the absolute file
 * offset where the structure starts.
 */
function parseCommonNetworkRelativeLink(buf, cnrlBase) {
  const size = readU32(buf, cnrlBase + 0, 'CommonNetworkRelativeLink.Size');
  need(buf, cnrlBase, size, 'CommonNetworkRelativeLink');
  const flags = readU32(buf, cnrlBase + 4, 'CommonNetworkRelativeLink.Flags');
  const validDevice = (flags & CNRL_FLAGS.ValidDevice) !== 0;
  const netNameOffset = readU32(buf, cnrlBase + 8, 'CommonNetworkRelativeLink.NetNameOffset');
  const deviceNameOffset = readU32(buf, cnrlBase + 12, 'CommonNetworkRelativeLink.DeviceNameOffset');

  // NetNameOffsetUnicode/DeviceNameOffsetUnicode are present iff
  // NetNameOffset > 0x14 (section 2.3.2).
  const hasUnicodeOffsets = netNameOffset > 0x14;
  let netNameOffsetUnicode = 0;
  let deviceNameOffsetUnicode = 0;
  if (hasUnicodeOffsets) {
    netNameOffsetUnicode = readU32(buf, cnrlBase + 20, 'CommonNetworkRelativeLink.NetNameOffsetUnicode');
    deviceNameOffsetUnicode = readU32(buf, cnrlBase + 24, 'CommonNetworkRelativeLink.DeviceNameOffsetUnicode');
  }

  const netName = netNameOffset
    ? readNulTerminatedAnsi(buf, cnrlBase + netNameOffset, cnrlBase + size)
    : null;
  const deviceName = validDevice && deviceNameOffset
    ? readNulTerminatedAnsi(buf, cnrlBase + deviceNameOffset, cnrlBase + size)
    : null;
  const netNameUnicode = hasUnicodeOffsets && netNameOffsetUnicode
    ? readNulTerminatedUtf16(buf, cnrlBase + netNameOffsetUnicode, cnrlBase + size)
    : null;
  const deviceNameUnicode = hasUnicodeOffsets && validDevice && deviceNameOffsetUnicode
    ? readNulTerminatedUtf16(buf, cnrlBase + deviceNameOffsetUnicode, cnrlBase + size)
    : null;

  return { size, validDevice, netName, deviceName, netNameUnicode, deviceNameUnicode };
}

/**
 * Parses the LinkInfo structure (section 2.3). `base` is the absolute
 * file offset where LinkInfo starts (LinkInfoSize is its first field).
 */
function parseLinkInfo(buf, base) {
  const linkInfoSize = readU32(buf, base + 0, 'LinkInfo.LinkInfoSize');
  need(buf, base, linkInfoSize, 'LinkInfo');
  const linkInfoHeaderSize = readU32(buf, base + 4, 'LinkInfo.LinkInfoHeaderSize');
  const linkInfoFlags = readU32(buf, base + 8, 'LinkInfo.LinkInfoFlags');
  const hasVolumeIdAndLocalBasePath = (linkInfoFlags & LINK_INFO_FLAGS.VolumeIDAndLocalBasePath) !== 0;
  const hasCommonNetworkRelativeLink = (linkInfoFlags & LINK_INFO_FLAGS.CommonNetworkRelativeLinkAndPathSuffix) !== 0;

  const localBasePathOffset = readU32(buf, base + 16, 'LinkInfo.LocalBasePathOffset');
  const commonNetworkRelativeLinkOffset = readU32(buf, base + 20, 'LinkInfo.CommonNetworkRelativeLinkOffset');
  const commonPathSuffixOffset = readU32(buf, base + 24, 'LinkInfo.CommonPathSuffixOffset');

  // LocalBasePathOffsetUnicode / CommonPathSuffixOffsetUnicode are present
  // only when LinkInfoHeaderSize >= 0x24 (section 2.3).
  let localBasePathOffsetUnicode = 0;
  let commonPathSuffixOffsetUnicode = 0;
  if (linkInfoHeaderSize >= 0x24) {
    localBasePathOffsetUnicode = readU32(buf, base + 28, 'LinkInfo.LocalBasePathOffsetUnicode');
    commonPathSuffixOffsetUnicode = readU32(buf, base + 32, 'LinkInfo.CommonPathSuffixOffsetUnicode');
  }

  const end = base + linkInfoSize;

  const localBasePath = hasVolumeIdAndLocalBasePath && localBasePathOffset
    ? readNulTerminatedAnsi(buf, base + localBasePathOffset, end)
    : null;
  const localBasePathUnicode = hasVolumeIdAndLocalBasePath && localBasePathOffsetUnicode
    ? readNulTerminatedUtf16(buf, base + localBasePathOffsetUnicode, end)
    : null;
  const commonPathSuffix = commonPathSuffixOffset
    ? readNulTerminatedAnsi(buf, base + commonPathSuffixOffset, end)
    : '';
  const commonPathSuffixUnicode = commonPathSuffixOffsetUnicode
    ? readNulTerminatedUtf16(buf, base + commonPathSuffixOffsetUnicode, end)
    : null;

  let commonNetworkRelativeLink = null;
  if (hasCommonNetworkRelativeLink && commonNetworkRelativeLinkOffset) {
    commonNetworkRelativeLink = parseCommonNetworkRelativeLink(buf, base + commonNetworkRelativeLinkOffset);
  }

  // Full path = LocalBasePath + CommonPathSuffix, concatenated directly
  // (no separator inserted -- the spec's own wording is "constructed by
  // appending"; real-world .lnk files store the separator, if any,
  // inside one of the two strings already).
  const suffix = commonPathSuffixUnicode ?? commonPathSuffix;
  const localFull = localBasePathUnicode ?? localBasePath;
  const resolvedLocal = localFull != null ? localFull + suffix : null;

  let resolvedUnc = null;
  if (commonNetworkRelativeLink) {
    const netFull = commonNetworkRelativeLink.netNameUnicode ?? commonNetworkRelativeLink.netName;
    resolvedUnc = netFull != null ? netFull + suffix : null;
  }

  return {
    linkInfoSize,
    hasVolumeIdAndLocalBasePath,
    hasCommonNetworkRelativeLink,
    resolvedLocal,
    resolvedUnc,
    commonNetworkRelativeLink,
  };
}

/**
 * Parses ExtraData (section 2.5): a sequence of BlockSize(4)+
 * BlockSignature(4)+data blocks, terminated by a block whose BlockSize is
 * < 4. Only EnvironmentVariableDataBlock (section 2.5.4) is decoded; every
 * other block type is skipped by its BlockSize without being interpreted.
 * `blockSignaturesSeen` is returned (not discarded) so a caller can record
 * which ExtraData block types this .lnk actually carries.
 */
function parseExtraData(buf, startOffset) {
  let offset = startOffset;
  let envBlock = null;
  const blockSignaturesSeen = [];

  while (offset + 4 <= buf.length) {
    const blockSize = readU32(buf, offset, 'ExtraData.BlockSize');
    if (blockSize < 4) break; // TerminalBlock
    if (offset + blockSize > buf.length || offset + 8 > buf.length) break; // truncated/corrupt -- stop defensively, not a hard reject

    const blockSignature = readU32(buf, offset + 4, 'ExtraData.BlockSignature');
    blockSignaturesSeen.push(`0x${blockSignature.toString(16)}`);

    if (blockSignature === BLOCK_SIGNATURE_ENVIRONMENT_VARIABLE) {
      const ansiStart = offset + 8;
      const targetAnsi = readNulTerminatedAnsi(buf, ansiStart, ansiStart + 260);
      let targetUnicode = null;
      if (blockSize >= ENV_BLOCK_SIZE) {
        const uniStart = ansiStart + 260;
        targetUnicode = readNulTerminatedUtf16(buf, uniStart, uniStart + 520);
      }
      envBlock = { targetAnsi, targetUnicode };
    }

    offset += blockSize;
  }

  return { envBlock, blockSignaturesSeen };
}

/**
 * Expands %VAR%-style environment variable references using the CURRENT
 * process's environment. Windows environment variable names are
 * case-insensitive; process.env keys are looked up case-insensitively
 * here to match that.
 *
 * The case-folded key map is a lazily-initialized, per-process singleton
 * (round-2 minor finding 10a): building it fresh on every call rebuilt the
 * entire process.env keyset inside the loop the benchmark times. It is
 * built lazily rather than at module load so a test can still observe a
 * process.env mutation made before the first call.
 */
let envKeysByLowerCache = null;
function getEnvKeysByLower() {
  if (envKeysByLowerCache === null) {
    envKeysByLowerCache = new Map();
    for (const key of Object.keys(process.env)) envKeysByLowerCache.set(key.toLowerCase(), key);
  }
  return envKeysByLowerCache;
}

export function expandEnvVars(str) {
  if (str == null) return str;
  const envKeysByLower = getEnvKeysByLower();
  return str.replace(/%([^%]+)%/g, (whole, name) => {
    const realKey = envKeysByLower.get(name.toLowerCase());
    return realKey !== undefined ? process.env[realKey] : whole;
  });
}

function invalidResult(rejectReason) {
  return {
    valid: false,
    rejectReason,
    flags: {},
    linkInfo: null,
    strings: {},
    envBlock: null,
    extraDataBlockSignatures: [],
    candidates: [],
    resolvedTargetPath: null,
    category: { envVar: false, unc: false, msiAdvertised: false, idListOnly: false, noUsablePathSource: false },
  };
}

/**
 * Parses a .lnk file's bytes per [MS-SHLLINK] and returns the fields
 * relevant to target-path resolution and category classification. Never
 * throws for a truncated/corrupt/malicious-size .lnk -- every read past
 * the fixed ShellLinkHeader is bounds-checked, and any bounds failure
 * comes back as a structured {valid:false, rejectReason} naming the
 * structure and offset involved (round-2 major finding 4).
 *
 * @param {Buffer} buf
 * @returns {{
 *   valid: boolean,
 *   rejectReason: string|null,
 *   flags: Record<string, boolean>,
 *   linkInfo: object|null,
 *   strings: Record<string, string>,
 *   envBlock: {targetAnsi: string, targetUnicode: string|null}|null,
 *   extraDataBlockSignatures: string[],
 *   candidates: Array<{source: string, value: string}>,
 *   resolvedTargetPath: string|null,
 *   category: {envVar: boolean, unc: boolean, msiAdvertised: boolean, idListOnly: boolean, noUsablePathSource: boolean},
 * }}
 */
export function parseLnk(buf) {
  if (buf.length < HEADER_SIZE) {
    return invalidResult(`file is ${buf.length} bytes, smaller than the ${HEADER_SIZE}-byte ShellLinkHeader`);
  }

  const headerSize = buf.readUInt32LE(0);
  const clsid = buf.subarray(4, 20);
  if (headerSize !== HEADER_SIZE || !clsid.equals(LINK_CLSID)) {
    return invalidResult(`HeaderSize=0x${headerSize.toString(16)} CLSID=${clsid.toString('hex')} -- does not match the ShellLinkHeader signature`);
  }

  try {
    const rawLinkFlags = readU32(buf, 20, 'ShellLinkHeader.LinkFlags');
    const flags = {};
    for (const [name, bit] of Object.entries(LINK_FLAGS)) flags[name] = (rawLinkFlags & bit) !== 0;

    let offset = HEADER_SIZE;

    if (flags.HasLinkTargetIDList) {
      const idListSize = readU16(buf, offset, 'LinkTargetIDList.IDListSize');
      need(buf, offset + 2, idListSize, 'LinkTargetIDList (ItemIDList data)');
      offset += 2 + idListSize; // deliberately not decoding IDList contents -- see module header, limitation 1
    }

    let linkInfo = null;
    if (flags.HasLinkInfo) {
      linkInfo = parseLinkInfo(buf, offset);
      offset += linkInfo.linkInfoSize;
    }

    const strings = {};
    const isUnicode = flags.IsUnicode;
    if (flags.HasName) { const r = readStringDataItem(buf, offset, isUnicode, 'StringData.NAME_STRING'); strings.name = r.value; offset = r.nextOffset; }
    if (flags.HasRelativePath) { const r = readStringDataItem(buf, offset, isUnicode, 'StringData.RELATIVE_PATH'); strings.relativePath = r.value; offset = r.nextOffset; }
    if (flags.HasWorkingDir) { const r = readStringDataItem(buf, offset, isUnicode, 'StringData.WORKING_DIR'); strings.workingDir = r.value; offset = r.nextOffset; }
    if (flags.HasArguments) { const r = readStringDataItem(buf, offset, isUnicode, 'StringData.COMMAND_LINE_ARGUMENTS'); strings.arguments = r.value; offset = r.nextOffset; }
    if (flags.HasIconLocation) { const r = readStringDataItem(buf, offset, isUnicode, 'StringData.ICON_LOCATION'); strings.iconLocation = r.value; offset = r.nextOffset; }

    const { envBlock, blockSignaturesSeen } = parseExtraData(buf, offset);

    // Candidate target paths, in priority order -- the FIRST candidate
    // becomes `resolvedTargetPath`, i.e. what this parser actually
    // resolves the shortcut to. ForceNoLinkInfo (bit 8) means LinkInfo
    // MUST be ignored per spec -- honored here, not just parsed for
    // display.
    const candidates = [];
    const linkInfoUsable = linkInfo && !flags.ForceNoLinkInfo;
    if (linkInfoUsable && linkInfo.resolvedLocal) {
      candidates.push({ source: 'linkinfo-local', value: linkInfo.resolvedLocal });
    }
    if (linkInfoUsable && linkInfo.resolvedUnc) {
      candidates.push({ source: 'linkinfo-unc', value: linkInfo.resolvedUnc });
    }
    if (envBlock) {
      // The EXPANDED form is the primary candidate (round-2 blocker 1):
      // COM's TargetPath is always an expanded, usable path, never a raw
      // '%VAR%' string, so a parser whose actual output is the raw form
      // disagrees with COM even when a secondary candidate happens to
      // match. The raw form is kept as a lower-priority diagnostic
      // candidate -- still available to callers that want it (the
      // benchmark's raw-vs-expanded report, the env-var snapshot) -- it
      // simply no longer outranks the expanded form for what this parser
      // resolves the shortcut to.
      if (envBlock.targetUnicode) {
        candidates.push({ source: 'env-expanded', value: expandEnvVars(envBlock.targetUnicode) });
        candidates.push({ source: 'env-raw', value: envBlock.targetUnicode });
      } else if (envBlock.targetAnsi) {
        candidates.push({ source: 'env-expanded-ansi', value: expandEnvVars(envBlock.targetAnsi) });
        candidates.push({ source: 'env-raw-ansi', value: envBlock.targetAnsi });
      }
    }

    const resolvedTargetPath = candidates.length > 0 ? candidates[0].value : null;

    const category = {
      envVar: flags.HasExpString,
      unc: !!(linkInfo && linkInfo.resolvedUnc),
      msiAdvertised: flags.HasDarwinID,
      // Structural shape only: HasLinkTargetIDList set, HasLinkInfo NOT
      // set at all. This does NOT account for ForceNoLinkInfo (LinkInfo
      // present but spec-mandated-ignored) -- round-3 minor finding 7
      // found this predicate disagreed with the candidate builder above
      // (which correctly gates on `linkInfo && !flags.ForceNoLinkInfo`),
      // so a shortcut with LinkInfo present-but-ignored and no env block
      // would produce zero candidates while still reading idListOnly:
      // false. Kept as-is (rather than folded into noUsablePathSource
      // below) because it names a specific, narrower structural shape
      // that the ADR's category table and shortcut list already describe
      // by this exact name; gap CLASSIFICATION now uses the field below
      // instead, so the two cannot drift again.
      idListOnly: flags.HasLinkTargetIDList && !flags.HasLinkInfo,
      // Derived from the SAME array the candidate builder above produced
      // (candidates.length), so this can never disagree with what the
      // parser actually resolved -- by construction, not by keeping two
      // predicates in sync by hand. True whenever this shortcut carries a
      // shell-namespace IDList but produced zero usable candidates,
      // whether because LinkInfo is entirely absent (idListOnly above) OR
      // present-but-ForceNoLinkInfo'd with no env-var fallback (the
      // drifted case round-3 finding 7 identified). This is the field the
      // benchmark's gap classification (idListOnlyGapCount /
      // unexpectedParserEmptyGapCount) filters on.
      noUsablePathSource: flags.HasLinkTargetIDList && candidates.length === 0,
    };

    return {
      valid: true,
      rejectReason: null,
      flags,
      linkInfo,
      strings,
      envBlock,
      extraDataBlockSignatures: blockSignaturesSeen,
      candidates,
      resolvedTargetPath,
      category,
    };
  } catch (err) {
    if (err instanceof LnkBoundsError) {
      return invalidResult(err.message);
    }
    // Not a bounds issue -- an actual bug in this parser. Do not hide it
    // behind a generic rejectReason; let it propagate so the caller (the
    // benchmark) can record it as a parser exception, distinct from both
    // an I/O failure and a structurally-rejected file (round-2 finding 4).
    throw err;
  }
}
