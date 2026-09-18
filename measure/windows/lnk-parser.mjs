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
function readStringDataItem(buf, offset, isUnicode) {
  const count = buf.readUInt16LE(offset);
  const byteLen = count * (isUnicode ? 2 : 1);
  const strStart = offset + 2;
  const strEnd = strStart + byteLen;
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
  const size = buf.readUInt32LE(cnrlBase + 0);
  const flags = buf.readUInt32LE(cnrlBase + 4);
  const validDevice = (flags & CNRL_FLAGS.ValidDevice) !== 0;
  const netNameOffset = buf.readUInt32LE(cnrlBase + 8);
  const deviceNameOffset = buf.readUInt32LE(cnrlBase + 12);

  // NetNameOffsetUnicode/DeviceNameOffsetUnicode are present iff
  // NetNameOffset > 0x14 (section 2.3.2).
  const hasUnicodeOffsets = netNameOffset > 0x14;
  let netNameOffsetUnicode = 0;
  let deviceNameOffsetUnicode = 0;
  if (hasUnicodeOffsets) {
    netNameOffsetUnicode = buf.readUInt32LE(cnrlBase + 20);
    deviceNameOffsetUnicode = buf.readUInt32LE(cnrlBase + 24);
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
  const linkInfoSize = buf.readUInt32LE(base + 0);
  const linkInfoHeaderSize = buf.readUInt32LE(base + 4);
  const linkInfoFlags = buf.readUInt32LE(base + 8);
  const hasVolumeIdAndLocalBasePath = (linkInfoFlags & LINK_INFO_FLAGS.VolumeIDAndLocalBasePath) !== 0;
  const hasCommonNetworkRelativeLink = (linkInfoFlags & LINK_INFO_FLAGS.CommonNetworkRelativeLinkAndPathSuffix) !== 0;

  const localBasePathOffset = buf.readUInt32LE(base + 16);
  const commonNetworkRelativeLinkOffset = buf.readUInt32LE(base + 20);
  const commonPathSuffixOffset = buf.readUInt32LE(base + 24);

  // LocalBasePathOffsetUnicode / CommonPathSuffixOffsetUnicode are present
  // only when LinkInfoHeaderSize >= 0x24 (section 2.3).
  let localBasePathOffsetUnicode = 0;
  let commonPathSuffixOffsetUnicode = 0;
  if (linkInfoHeaderSize >= 0x24) {
    localBasePathOffsetUnicode = buf.readUInt32LE(base + 28);
    commonPathSuffixOffsetUnicode = buf.readUInt32LE(base + 32);
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
 */
function parseExtraData(buf, startOffset) {
  let offset = startOffset;
  let envBlock = null;
  const blockSignaturesSeen = [];

  while (offset + 4 <= buf.length) {
    const blockSize = buf.readUInt32LE(offset);
    if (blockSize < 4) break; // TerminalBlock
    if (offset + blockSize > buf.length || offset + 8 > buf.length) break; // truncated/corrupt -- stop defensively

    const blockSignature = buf.readUInt32LE(offset + 4);
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
 */
export function expandEnvVars(str) {
  if (str == null) return str;
  const envKeysByLower = new Map();
  for (const key of Object.keys(process.env)) envKeysByLower.set(key.toLowerCase(), key);
  return str.replace(/%([^%]+)%/g, (whole, name) => {
    const realKey = envKeysByLower.get(name.toLowerCase());
    return realKey !== undefined ? process.env[realKey] : whole;
  });
}

/**
 * Parses a .lnk file's bytes per [MS-SHLLINK] and returns the fields
 * relevant to target-path resolution and category classification.
 *
 * @param {Buffer} buf
 * @returns {{
 *   valid: boolean,
 *   rejectReason: string|null,
 *   flags: Record<string, boolean>,
 *   linkInfo: object|null,
 *   strings: Record<string, string>,
 *   envBlock: {targetAnsi: string, targetUnicode: string|null}|null,
 *   candidates: Array<{source: string, value: string}>,
 *   resolvedTargetPath: string|null,
 *   category: {envVar: boolean, unc: boolean, msiAdvertised: boolean, idListOnly: boolean},
 * }}
 */
export function parseLnk(buf) {
  if (buf.length < HEADER_SIZE) {
    return {
      valid: false,
      rejectReason: `file is ${buf.length} bytes, smaller than the ${HEADER_SIZE}-byte ShellLinkHeader`,
      flags: {}, linkInfo: null, strings: {}, envBlock: null, candidates: [],
      resolvedTargetPath: null,
      category: { envVar: false, unc: false, msiAdvertised: false, idListOnly: false },
    };
  }

  const headerSize = buf.readUInt32LE(0);
  const clsid = buf.subarray(4, 20);
  if (headerSize !== HEADER_SIZE || !clsid.equals(LINK_CLSID)) {
    return {
      valid: false,
      rejectReason: `HeaderSize=0x${headerSize.toString(16)} CLSID=${clsid.toString('hex')} -- does not match the ShellLinkHeader signature`,
      flags: {}, linkInfo: null, strings: {}, envBlock: null, candidates: [],
      resolvedTargetPath: null,
      category: { envVar: false, unc: false, msiAdvertised: false, idListOnly: false },
    };
  }

  const rawLinkFlags = buf.readUInt32LE(20);
  const flags = {};
  for (const [name, bit] of Object.entries(LINK_FLAGS)) flags[name] = (rawLinkFlags & bit) !== 0;

  let offset = HEADER_SIZE;

  if (flags.HasLinkTargetIDList) {
    const idListSize = buf.readUInt16LE(offset);
    offset += 2 + idListSize; // deliberately not decoding IDList contents -- see module header, limitation 1
  }

  let linkInfo = null;
  if (flags.HasLinkInfo) {
    const linkInfoSize = buf.readUInt32LE(offset);
    linkInfo = parseLinkInfo(buf, offset);
    offset += linkInfoSize;
  }

  const strings = {};
  const isUnicode = flags.IsUnicode;
  if (flags.HasName) { const r = readStringDataItem(buf, offset, isUnicode); strings.name = r.value; offset = r.nextOffset; }
  if (flags.HasRelativePath) { const r = readStringDataItem(buf, offset, isUnicode); strings.relativePath = r.value; offset = r.nextOffset; }
  if (flags.HasWorkingDir) { const r = readStringDataItem(buf, offset, isUnicode); strings.workingDir = r.value; offset = r.nextOffset; }
  if (flags.HasArguments) { const r = readStringDataItem(buf, offset, isUnicode); strings.arguments = r.value; offset = r.nextOffset; }
  if (flags.HasIconLocation) { const r = readStringDataItem(buf, offset, isUnicode); strings.iconLocation = r.value; offset = r.nextOffset; }

  const { envBlock } = parseExtraData(buf, offset);

  // Candidate target paths, in priority order. ForceNoLinkInfo (bit 8)
  // means LinkInfo MUST be ignored per spec -- honored here, not just
  // parsed for display.
  const candidates = [];
  const linkInfoUsable = linkInfo && !flags.ForceNoLinkInfo;
  if (linkInfoUsable && linkInfo.resolvedLocal) {
    candidates.push({ source: 'linkinfo-local', value: linkInfo.resolvedLocal });
  }
  if (linkInfoUsable && linkInfo.resolvedUnc) {
    candidates.push({ source: 'linkinfo-unc', value: linkInfo.resolvedUnc });
  }
  if (envBlock) {
    if (envBlock.targetUnicode) {
      candidates.push({ source: 'env-raw', value: envBlock.targetUnicode });
      candidates.push({ source: 'env-expanded', value: expandEnvVars(envBlock.targetUnicode) });
    } else if (envBlock.targetAnsi) {
      candidates.push({ source: 'env-raw-ansi', value: envBlock.targetAnsi });
      candidates.push({ source: 'env-expanded-ansi', value: expandEnvVars(envBlock.targetAnsi) });
    }
  }

  const resolvedTargetPath = candidates.length > 0 ? candidates[0].value : null;

  const category = {
    envVar: flags.HasExpString,
    unc: !!(linkInfo && linkInfo.resolvedUnc),
    msiAdvertised: flags.HasDarwinID,
    idListOnly: flags.HasLinkTargetIDList && !flags.HasLinkInfo,
  };

  return {
    valid: true,
    rejectReason: null,
    flags,
    linkInfo,
    strings,
    envBlock,
    candidates,
    resolvedTargetPath,
    category,
  };
}
