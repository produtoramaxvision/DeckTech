// design/section7-fixture.mjs
//
// TEST-01 (Phase 6, .maxvision/ROADMAP.md success criterion 5a;
// requirement text .maxvision/REQUIREMENTS.md:137) — the single shared
// fixture for PRD §7 ("Contrato visual obrigatório",
// docs/plans/2026-08-18-dokke-windows-host-prd.md:78-96).
//
// Today the Mac tests (test/mac-app-slides-ui.test.mjs,
// test/mac-connection-ui.test.mjs) and the PWA test (test/ui.test.mjs)
// each hand-encode the same §7 invariants in their own regex dialect. A
// third hand-written copy for Windows (Phase 7 has no UI yet) is exactly
// the drift §7 exists to prevent. This file is the fixture all three
// surfaces' §7-scoped tests import instead:
//   - test/section7-mac.test.mjs
//   - test/section7-pwa.test.mjs
//   - test/section7-windows.test.mjs (Phase 7 has no UI to read yet — this
//     is the acceptance contract Phase 7's real UI test will extend, not a
//     placeholder; see the file for how it stays a real, breakable test.)
//
// Two decisions this file must NOT get wrong, both from .maxvision/REQUIREMENTS.md:
//   - D4: the shipped sidebar string is "Slots", not "Apps". The PRD §7
//     bullet ("sidebar com Apps e Conectar", line 83) is stale on this
//     point — shipped code (mac/Sources/ContentView.swift:7, v0.2.8) beats
//     an unshipped PRD dated 2026-08-18. `sidebar.items` below encodes
//     "Slots", and `sidebar.prdStale` records why, so nobody "fixes" it
//     back to "Apps" by reading the PRD literally.
//   - D13: DeckTech implements a REAL empty state; the Mac does not.
//     mac/Sources/DockGridView.swift:49-58 (`pages`, the computed property
//     that lays out each page's 8 tiles) turns every position with no
//     piece into `.add(index)` — there is no "this dock has zero apps"
//     branch, just 40 add-tiles. `emptyState` below is scoped to
//     `surfaces: ["windows"]` and `emptyState.macHasRealEmptyState = false`
//     precisely so no consumer of this fixture can assert the Mac's
//     ABSENCE of an empty state as if it were the shared §7 contract.
//
// Every citation below was re-read from the live source during this task,
// not copied from ROADMAP.md's prose (which cites slightly different line
// numbers for the D13 region — files drift; this fixture cites what the
// source says today, per "regra zero — nunca afirmar sem validar").
//
// TEST-02 (Phase 9) scope guard: about half of the §7 Conectar bullet
// (copy URL, open URL, device count, PIN regeneration) has no UI test on
// ANY surface today — this fixture enumerates those sub-items and tags
// them `status: "deferred"` with `deferredTo: "TEST-02"` rather than
// inventing new Mac/PWA assertions for them. TEST-01 is extraction of
// EXISTING invariants into one source, not new coverage; adding new
// assertions for deferred items belongs to TEST-02, in Phase 9.

/**
 * @typedef {"mac"|"pwa"|"windows"} Surface
 */

/**
 * @typedef {Object} Bullet
 * @property {string} id
 * @property {string} text - paraphrase of the §7 bullet this covers
 * @property {Surface[]} surfaces - which surfaces this bullet applies to
 * @property {"asserted"|"partial"|"deferred"} status
 * @property {string} [deferredTo] - roadmap item covering what's missing
 * @property {string} [note] - D4/D13-style caveat, only when one applies
 */

export const PRD_SOURCE = "docs/plans/2026-08-18-dokke-windows-host-prd.md:78-96";

/** @type {Bullet[]} */
export const BULLETS = [
  {
    id: "window-title",
    text: "janela principal com título Dokke",
    surfaces: ["mac", "windows"],
    status: "asserted",
  },
  {
    id: "sidebar-nav",
    text: 'sidebar com "Apps" e "Conectar"',
    surfaces: ["mac", "windows"],
    status: "asserted",
    note:
      'D4: the shipped string is "Slots", not "Apps" — see SIDEBAR.items ' +
      "and SIDEBAR.prdStale below. Encode what ships.",
  },
  {
    id: "sidebar-selection",
    text: "item selecionado com o tratamento visual do app Mac",
    surfaces: ["mac", "windows"],
    status: "asserted",
  },
  {
    id: "grid-4x2",
    text: "dock em grid de 4 colunas por 2 linhas, páginas, peek lateral e indicadores de página",
    surfaces: ["mac", "pwa", "windows"],
    status: "asserted",
  },
  {
    id: "add-module",
    text: "módulo para adicionar app",
    surfaces: ["mac", "windows"],
    status: "asserted",
  },
  {
    id: "reorder-mode",
    text: "modo explícito para reordenar itens",
    surfaces: ["mac", "windows"],
    status: "asserted",
  },
  {
    id: "app-picker",
    text: 'app picker com busca, ícone, estado "Adicionado" e ação "Adicionar"',
    surfaces: ["mac", "windows"],
    status: "asserted",
  },
  {
    id: "connect-pin-url-qr",
    text: "tela Conectar exibe PIN, URL e QR Code",
    surfaces: ["mac", "windows"],
    status: "asserted",
  },
  {
    id: "connect-copy-open",
    text: "tela Conectar permite copiar URL e abrir URL",
    surfaces: ["mac", "windows"],
    status: "deferred",
    deferredTo: "TEST-02",
  },
  {
    id: "connect-server-status",
    text: "tela Conectar mostra status do servidor (online/offline)",
    surfaces: ["mac", "windows"],
    status: "asserted",
  },
  {
    id: "connect-device-count",
    text: "tela Conectar mostra número de dispositivos",
    surfaces: ["mac", "windows"],
    status: "deferred",
    deferredTo: "TEST-02",
  },
  {
    id: "connect-pin-regenerate",
    text: "tela Conectar permite regenerar o PIN",
    surfaces: ["mac", "windows"],
    status: "deferred",
    deferredTo: "TEST-02",
  },
  {
    id: "empty-state",
    text: "estado vazio real (ilustração, título, explicação, uma chamada 'Adicionar app')",
    surfaces: ["windows"],
    status: "asserted",
    note:
      "D13: the Mac has NO real empty state — every free slot becomes " +
      "`.add`, see EMPTY_STATE.macSource. This bullet is windows-only.",
  },
];

// ---------------------------------------------------------------------------
// GRID — the one structural invariant literally hardcoded, matching, on
// BOTH shipped surfaces today. This is the fixture's cross-surface anchor:
// mutate GRID.pageSize (or .columns/.rows) and all three §7 test files
// break, each against its own independent ground truth (Mac reads real
// Swift source, PWA reads real HTML/JS source, Windows compares against an
// independently-authored ratified contract in the same style as
// test/platform-protocol-snapshot.test.mjs's EXPECTED_ROUTES).
// ---------------------------------------------------------------------------
export const GRID = {
  columns: 4,
  rows: 2,
  get pageSize() {
    return this.columns * this.rows;
  },
  source: {
    mac:
      "mac/Sources/DockGridView.swift:14 (`private let pageSize = 8`), " +
      ":211 (`GridItem(...), count: 4` — 4 columns; 8/4 = 2 rows)",
    pwa:
      "public/index.html:1093 (`function pageSize(){ return 8; }`), " +
      ":494-495 (`grid-template-columns: repeat(4, ...)`, " +
      "`grid-template-rows: repeat(2, ...)`)",
  },
};

// ---------------------------------------------------------------------------
// SIDEBAR — D4.
// ---------------------------------------------------------------------------
export const SIDEBAR = {
  items: ["Slots", "Conectar"],
  source: 'mac/Sources/ContentView.swift:7-8 (`case apps = "Slots"`, `case about = "Conectar"`)',
  prdStale: {
    field: "Apps",
    reason:
      'PRD §7 (line 83) says "Apps"; D4 (.maxvision/REQUIREMENTS.md:22) ' +
      "rules shipped code v0.2.8 wins over the 2026-08-18 PRD. Encode " +
      '"Slots", not "Apps".',
  },
};

// ---------------------------------------------------------------------------
// PICKER — i18n keys the picker bullet is anchored to.
// ---------------------------------------------------------------------------
export const PICKER = {
  searchKey: "picker.search",
  addedKey: "picker.added",
  addKey: "picker.add",
  source:
    "mac/Sources/AppPickerSheet.swift:99 (search field), " +
    ":238/:386 (added-state label/accessibility), " +
    "mac/Sources/LanguageStore.swift:78 (pt-BR i18n table)",
};

// ---------------------------------------------------------------------------
// CONNECT — i18n keys the (asserted, non-deferred) Conectar bullets anchor to.
// ---------------------------------------------------------------------------
export const CONNECT = {
  onlineKey: "connect.online",
  offlineKey: "connect.offline",
  copyURLKey: "connect.copyURL",
  openKey: "connect.open",
  regenerateKey: "confirm.newCodeAction",
  devicesKey: "connect.devices",
  source: "mac/Sources/LanguageStore.swift:70-71 (pt-BR i18n table)",
};

// ---------------------------------------------------------------------------
// EMPTY_STATE — D13.
// ---------------------------------------------------------------------------
export const EMPTY_STATE = {
  real: true,
  macHasRealEmptyState: false,
  macSource: "mac/Sources/DockGridView.swift:49-58 (`pages`: every unfilled position becomes `.add(index)`)",
  reason:
    "D13 (.maxvision/REQUIREMENTS.md:31) — DeckTech implements a real " +
    "empty state; the Mac does not. Never assert the Mac's absence of one " +
    "as if it were the §7 contract.",
};

/**
 * @param {Surface} surface
 * @returns {Bullet[]}
 */
export function bulletsFor(surface) {
  return BULLETS.filter((b) => b.surfaces.includes(surface));
}
