import test from "node:test";
import assert from "node:assert/strict";
import { openApp, openWebsite, focusApp, activateApp, ActionError } from "../actions.js";

test("@spec:AC-312 openWebsite usa /usr/bin/open com URL em argumento isolado", async () => {
  const calls = [];
  await openWebsite("https://example.com/a?b=1", {
    exec: async (cmd, args) => { calls.push([cmd, args]); return { stdout: "" }; },
  });
  assert.deepEqual(calls, [["/usr/bin/open", ["https://example.com/a?b=1"]]]);
});

test("openApp roda open -a e focus roda osascript", async () => {
  const cmds = [];
  const tools = {
    exec: async (cmd, args) => { cmds.push([cmd, args]); return { stdout: "" }; },
  };
  await openApp("Chrome", tools);
  await focusApp("Chrome", 1234, tools);
  assert(cmds.some(c => c[0] === "open" && c[1].includes("-a")));
  assert(cmds.some(c => c[0] === "osascript" && c[1].join(" ").includes("1234")));
});

test("PLAT-06: focusApp cai pro open -a quando osascript falha, mas propaga FOCUS_RESTRICTED (PRD §15: nova instância é fallback aceito, não sucesso silencioso)", async () => {
  const cmds = [];
  const tools = {
    exec: async (cmd, args) => {
      cmds.push([cmd, args]);
      if (cmd === "osascript") throw new Error("sem permissão de acessibilidade");
      return { stdout: "" };
    },
  };
  await assert.rejects(focusApp("Notes", 55, tools), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "FOCUS_RESTRICTED");
    return true;
  });
  // o fallback (open) ainda roda e "abre a nova instância" de fato — só o
  // sucesso silencioso é que muda, não o comportamento aceito pelo PRD §15.
  assert.deepEqual(cmds.map(c => c[0]), ["osascript", "open"]);
});

test("activateApp decide: com pid foca, sem pid abre", async () => {
  const cmds = [];
  const tools = {
    exec: async (cmd, args) => { cmds.push([cmd, args]); return { stdout: "" }; },
  };
  await activateApp({ name: "Chrome", pid: 1234 }, tools);
  await activateApp({ name: "Notes", pid: null }, tools);
  assert(cmds.some(c => c[0] === "osascript" && c[1].join(" ").includes("1234")));
  assert(cmds.some(c => c[0] === "open" && c[1].join(" ").includes("Notes")));
});

test("focusApp rejeita pid nao inteiro (defesa em profundidade) e abre", async () => {
  const cmds = [];
  const tools = {
    exec: async (cmd, args) => { cmds.push([cmd, args]); return { stdout: "" }; },
  };
  await focusApp("Chrome", "5; do shell script \"touch /tmp/x\"", tools);
  assert.deepEqual(cmds.map(c => c[0]), ["open"]);
});

test("PLAT-06: openApp tipa APP_NOT_FOUND quando o `open -a` reporta app inexistente", async () => {
  const tools = {
    exec: async () => { throw new Error("Unable to find application named 'Ghost App'"); },
  };
  await assert.rejects(openApp("Ghost App", tools), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "APP_NOT_FOUND");
    // nunca vaza o texto bruto do stderr do processo filho na mensagem tipada
    assert.doesNotMatch(err.message, /Unable to find/);
    return true;
  });
});

test("PLAT-06: openApp tipa LAUNCH_FAILED para qualquer outra falha do `open -a` (app existe mas não abre)", async () => {
  const tools = {
    exec: async () => { throw new Error("Command failed: open -a Chrome\noperation not permitted"); },
  };
  await assert.rejects(openApp("Chrome", tools), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "LAUNCH_FAILED");
    return true;
  });
});

test("PLAT-06: openApp com nome de app contendo espaço propaga o mesmo código tipado", async () => {
  // Constraint da tarefa: exercitar um valor com espaço através do fluxo —
  // aqui não há path.join (não há filesystem path nesta rota), o análogo
  // honesto é o nome do app, que atravessa route param (encode/decodeURIComponent)
  // no server.js antes de chegar aqui.
  const tools = {
    exec: async () => { throw new Error("Unable to find application named 'Google Chrome'"); },
  };
  await assert.rejects(openApp("Google Chrome", tools), (err) => {
    assert.equal(err.code, "APP_NOT_FOUND");
    return true;
  });
});
