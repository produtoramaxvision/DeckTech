/**
 * Logging estruturado do core (OBS-01). Zero-dependency de propósito: o
 * projeto sustenta UMA dependência de produção (ws) por decisão deliberada
 * (ver .maxvision/REQUIREMENTS.md), e pino — a alternativa consultada via
 * context7 (/pinojs/pino, docs/redaction.md) — exige enumerar cada path
 * sensível estaticamente (`redact: { paths: [...] }`); um call site que
 * passa um objeto ad hoc (ex.: o corpo inteiro do POST /api/auth) exigiria
 * atualizar essa lista de paths toda vez que o formato do corpo mudar. A
 * redação por NOME de chave abaixo é mais segura pra esse padrão: qualquer
 * campo chamado "pin"/"cookie"/etc. some do log não importa em que
 * profundidade apareça, sem lista de paths pra manter sincronizada.
 *
 * O sink em arquivo (OBS-02, Fase 5) é responsabilidade de outro módulo —
 * este aqui só produz o registro e entrega pro sink injetado. Sink padrão é
 * `process.stderr`, nunca stdout: `server.js` imprime a linha de boot
 * ("Dokke ouvindo em http://...") em stdout e scripts de smoke/measure
 * fazem parse dela — misturar log estruturado ali quebraria esse parse.
 */

export const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const DEFAULT_LEVEL = "warn";

/**
 * Chaves que NUNCA aparecem no log, mesmo se um call site passar o objeto
 * inteiro (ex.: corpo do POST /api/auth, que carrega `pin`; ou o header
 * `Cookie`, que carrega o token de sessão). Comparação é por NOME exato de
 * chave (case-insensitive) — não substring — pra não redigir campos
 * legítimos como "pinned" ou "sessionCount" por engano.
 */
const SENSITIVE_KEYS = new Set([
  "pin",
  "cookie",
  "set-cookie",
  "authorization",
  "password",
  "secret",
  "token",
  "session",
  "j5_pin",
  "j5_session",
]);
const REDACTED = "[REDACTED]";

function levelFromEnv(env = process.env) {
  const raw = String(env?.DECKTECH_LOG_LEVEL ?? env?.DOKKE_LOG_LEVEL ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, raw) ? raw : DEFAULT_LEVEL;
}

/**
 * `seen` marca apenas a cadeia de ANCESTRAIS em descida (não "todo objeto já
 * visitado"): entra no nó antes de descer, sai do nó depois. Isso distingue
 * um ciclo real (objeto reaparece na própria cadeia de ancestrais) de uma
 * referência compartilhada não-circular (ex.: `{a: shared, b: shared}`) —
 * sem o `delete` no fim, a segunda ocorrência de `shared` seria marcada
 * "[Circular]" por engano e um campo de diagnóstico legítimo desapareceria
 * do log calado (round 2, achado 2).
 */
function redact(value, seen) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.map(v => redact(v, seen));
  } else {
    out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(String(key).toLowerCase()) ? REDACTED : redact(v, seen);
    }
  }
  seen.delete(value);
  return out;
}

function defaultSink(line) {
  try { process.stderr.write(line + "\n"); } catch {}
}

/**
 * Cria um logger independente do singleton do módulo. Usado por `deps.log`
 * em `server.js`/`apps.js` (injeção igual a `obs`/`iconService`/`actions`) e
 * por testes que precisam capturar registros (sink injetado) ou fixar nível
 * e relógio pra asserções determinísticas.
 */
export function createLogger({ level, sink = defaultSink, now = () => new Date().toISOString() } = {}) {
  const resolvedLevel = level && Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : levelFromEnv();
  const threshold = LEVELS[resolvedLevel];

  function emit(lvl, event, fields) {
    if (LEVELS[lvl] > threshold) return;
    let record;
    try {
      record = JSON.stringify({ ts: now(), level: lvl, event, ...redact(fields || {}, new WeakSet()) });
    } catch {
      // Serialização nunca pode derrubar o caminho que está sendo logado
      // (ex.: referência circular fora do que `redact` já trata, BigInt).
      record = JSON.stringify({ ts: now(), level: lvl, event, note: "campos não serializáveis descartados" });
    }
    sink(record);
  }

  return {
    level: resolvedLevel,
    error: (event, fields) => emit("error", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    info: (event, fields) => emit("info", event, fields),
    debug: (event, fields) => emit("debug", event, fields),
    /** Logger derivado que injeta campos fixos (ex.: requestId) em todo registro. */
    child(defaults = {}) {
      return {
        level: resolvedLevel,
        error: (event, fields) => emit("error", event, { ...defaults, ...fields }),
        warn: (event, fields) => emit("warn", event, { ...defaults, ...fields }),
        info: (event, fields) => emit("info", event, { ...defaults, ...fields }),
        debug: (event, fields) => emit("debug", event, { ...defaults, ...fields }),
      };
    },
  };
}

/** Logger padrão do processo — nível vem de DECKTECH_LOG_LEVEL/DOKKE_LOG_LEVEL,
 *  quieto (warn) por padrão. Toda superfície aceita substituí-lo via `deps.log`. */
export const log = createLogger();
