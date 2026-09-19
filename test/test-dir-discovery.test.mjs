import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

// Node's default test-file discovery matches ANY .js/.mjs/.cjs file that
// lives inside a directory named `test` — not only `*.test.mjs`. That rule
// is easy to forget and it bit this repo:
//
// `tools/fg-harness.mjs` (the PLAT-05 foreground measurement harness) was
// merged in as `test/scratch/fg-harness.mjs`. Every `node --test` run
// therefore SPAWNED it. It survived only because it carries a self-guard
//
//     if (process.execArgv.some((a) => a.startsWith("--test"))) process.exit(0);
//
// and an exit(0) with no assertions is reported by the runner as a PASSING
// test. So the suite grew a green line that checked nothing, and a file whose
// real job is to spawn throwaway windows and steal the OS foreground sat one
// fragile execArgv check away from running in the middle of every suite run.
// A suite failure was observed once around that time and never identified
// (.maxvision/STATE.md) — not proven to be this, but this is exactly the
// shape of defect that produces it.
//
// The harness now lives in `tools/`. This test stops the category from coming
// back: anything under `test/` must be a real test file.

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RUNNABLE = /\.(?:js|mjs|cjs)$/;
// Node also auto-discovers these name shapes; a helper must not use them.
const DISCOVERED_NAME = /(?:^|[._-])test(?:[._-]|\.[^.]+$)|^test\.[^.]+$/;

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

test("todo arquivo executável sob test/ é um *.test.mjs de verdade — helpers e harnesses moram fora", async () => {
  const files = await walk(TEST_DIR);
  // `.test.js` conta: test/android-companion.spec.test.js e um teste de
  // verdade (6 `test(...)`, importa node:test e ../server.js), so nao usa
  // .mjs. A regra aqui e "e um arquivo de teste", nao "usa a extensao que
  // eu prefiro" -- apertar isso transformaria o guarda num pedido de
  // renomeacao sem defeito por tras.
  const offenders = files
    .filter((f) => RUNNABLE.test(f))
    .map((f) => relative(TEST_DIR, f))
    .filter((rel) => !/\.test\.(?:mjs|js|cjs)$/.test(rel));

  assert.deepEqual(
    offenders,
    [],
    "Node roda QUALQUER .js/.mjs/.cjs dentro de um diretório chamado `test`, não só *.test.mjs. " +
      "Um arquivo aqui que não seja teste é executado pelo runner a cada `node --test`; se ele " +
      "sair com 0 sem afirmar nada, vira uma linha verde que não verifica coisa alguma. " +
      "Mova para `tools/` (ou outro diretório fora de test/). Encontrados: " +
      offenders.join(", "),
  );
});

test("nenhum subdiretório de test/ esconde arquivo executável — a regra vale recursivamente", async () => {
  const files = await walk(TEST_DIR);
  // Subdiretorio e proibido mesmo pra arquivo de teste legitimo: o ponto e
  // que `test/<algo>/qualquer.mjs` tambem e descoberto, entao um helper
  // escondido num subdiretorio passa pelo primeiro teste se alguem o
  // nomear *.test.mjs sem que ele afirme nada. Plano: test/ e raso.
  const nested = files
    .map((f) => relative(TEST_DIR, f))
    .filter((rel) => rel.includes(sep) && RUNNABLE.test(rel));

  assert.deepEqual(
    nested,
    [],
    "A descoberta do Node desce em subdiretórios: `test/scratch/qualquer.mjs` é executado igual. " +
      "Foi exatamente assim que a harness de foreground entrou na suíte. Encontrados: " + nested.join(", "),
  );
});

test("a harness de foreground do PLAT-05 está em tools/, fora do alcance do runner", async () => {
  const tools = await readdir(join(TEST_DIR, "..", "tools"));
  assert.ok(
    tools.includes("fg-harness.mjs"),
    "tools/fg-harness.mjs é a evidência medida que sustenta a decisão do AttachThreadInput " +
      "(docs e .maxvision/STATE.md citam os números dela) — ela não pode sumir, só não pode " +
      "morar sob test/",
  );
});
