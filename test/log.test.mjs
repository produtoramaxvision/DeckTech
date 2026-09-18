import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../log.js";

function capture(opts = {}) {
  const lines = [];
  const logger = createLogger({ sink: line => lines.push(line), now: () => "2026-09-18T00:00:00.000Z", ...opts });
  return { logger, lines, records: () => lines.map(l => JSON.parse(l)) };
}

test("nível padrão é warn: debug/info não emitem, warn/error emitem", () => {
  const { logger, records } = capture();
  logger.debug("d", {});
  logger.info("i", {});
  logger.warn("w", {});
  logger.error("e", {});
  assert.deepEqual(records().map(r => r.event), ["w", "e"]);
});

test("nível debug explícito emite tudo, com ts/level/event/campos", () => {
  const { logger, records } = capture({ level: "debug" });
  logger.debug("d1", { a: 1 });
  logger.info("i1", {});
  const [d, i] = records();
  assert.equal(d.event, "d1");
  assert.equal(d.level, "debug");
  assert.equal(d.a, 1);
  assert.equal(d.ts, "2026-09-18T00:00:00.000Z");
  assert.equal(i.level, "info");
});

test("nível inválido cai pro default (warn), não trava", () => {
  const { logger } = capture({ level: "nonsense-level" });
  assert.equal(logger.level, "warn");
});

test("redação: pin, cookie, password, token e afins somem por NOME de chave, em qualquer profundidade", () => {
  const { logger, records } = capture({ level: "debug" });
  logger.debug("evt", {
    pin: "4321",
    cookie: "j5_session=abc",
    nested: { password: "hunter2", ok: "fica" },
    list: [{ token: "t1" }, { fine: "yes" }],
  });
  const [r] = records();
  assert.equal(r.pin, "[REDACTED]");
  assert.equal(r.cookie, "[REDACTED]");
  assert.equal(r.nested.password, "[REDACTED]");
  assert.equal(r.nested.ok, "fica");
  assert.equal(r.list[0].token, "[REDACTED]");
  assert.equal(r.list[1].fine, "yes");
});

test("redação é por nome exato, não substring: 'pinned' e 'sessionCount' sobrevivem intactos", () => {
  const { logger, records } = capture({ level: "debug" });
  logger.debug("evt", { pinned: ["a", "b"], sessionCount: 3 });
  const [r] = records();
  assert.deepEqual(r.pinned, ["a", "b"]);
  assert.equal(r.sessionCount, 3);
});

test("redação é case-insensitive no nome da chave (Cookie, PIN, Set-Cookie)", () => {
  const { logger, records } = capture({ level: "debug" });
  logger.debug("evt", { Cookie: "x", PIN: "1234", "Set-Cookie": "y" });
  const [r] = records();
  assert.equal(r.Cookie, "[REDACTED]");
  assert.equal(r.PIN, "[REDACTED]");
  assert.equal(r["Set-Cookie"], "[REDACTED]");
});

test("child() injeta campos fixos (ex.: requestId) em todo registro derivado", () => {
  const { logger, records } = capture({ level: "debug" });
  const child = logger.child({ requestId: "abc123" });
  child.debug("evt1", { x: 1 });
  child.warn("evt2", {});
  const [a, b] = records();
  assert.equal(a.requestId, "abc123");
  assert.equal(a.x, 1);
  assert.equal(b.requestId, "abc123");
});

test("sink recebe string JSON parseável, uma linha por chamada", () => {
  const { logger, lines } = capture({ level: "debug" });
  logger.debug("only", { v: 1 });
  assert.equal(lines.length, 1);
  assert.doesNotThrow(() => JSON.parse(lines[0]));
});
