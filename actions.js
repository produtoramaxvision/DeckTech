import { execFile } from "node:child_process";

export function cliExec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => err ? reject(err) : resolve({ stdout }));
  });
}

/**
 * Erro tipado de ação (PLAT-06). `code` é o contrato estável que server.js
 * repassa ao companion — nunca `message`, que pode carregar argv/paths do
 * exec subjacente. Mesmo formato `{code, error}` já usado em server.js para
 * REVISION_CONFLICT/PIECE_NOT_FOUND etc.
 */
export class ActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

/**
 * Classifica a falha do `open -a <app>` do macOS. Quando o app não existe
 * mais no disco, o utilitário `open(1)` sai com erro descrevendo "não
 * encontrado" no texto (`err.message` inclui o stderr do processo — ver
 * `child_process.execFile`); qualquer outra falha (permissão, binário
 * corrompido, app trava ao abrir) não bate nesse padrão e vira LAUNCH_FAILED.
 * NOTA: o texto exato do stderr do `open -a` não foi verificado empiricamente
 * nesta máquina (Windows, sem Mac disponível) — sinalizado em unresolved[] da
 * tarefa PLAT-06; o padrão cobre as variações de texto conhecidas da doc do
 * utilitário e é o ponto a revalidar com uma execução real em macOS.
 */
function classifyOpenFailure(err) {
  const detail = String(err && err.message || "");
  if (/unable to find application|no application (was )?found|does not exist/i.test(detail)) {
    return "APP_NOT_FOUND";
  }
  return "LAUNCH_FAILED";
}

export async function openApp(name, tools = { exec: cliExec }) {
  try {
    await tools.exec("open", ["-a", name]);
  } catch (err) {
    throw new ActionError(classifyOpenFailure(err), `open failed for "${name}"`);
  }
}

/** Abre uma URL no navegador padrão sem interpretar a entrada como shell. */
export async function openWebsite(url, tools = { exec: cliExec }) {
  await tools.exec("/usr/bin/open", [url]);
}

export async function focusApp(name, pid, tools = { exec: cliExec }) {
  if (!(Number.isInteger(pid) && pid > 0)) return openApp(name, tools);
  const script = `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`;
  try {
    await tools.exec("osascript", ["-e", script]);
  } catch {
    // SetForegroundWindow (e o osascript equivalente no macOS) é restrito
    // quando quem chama não detém o foreground — PRD §15 aceita abrir uma
    // nova instância como fallback. A instância abre normalmente, mas o
    // companion precisa distinguir esse caminho de um "activate" limpo:
    // propaga FOCUS_RESTRICTED mesmo com o fallback tendo funcionado. Se o
    // fallback também falhar, o erro dele (APP_NOT_FOUND/LAUNCH_FAILED)
    // propaga no lugar — é a falha mais informativa das duas.
    await openApp(name, tools);
    throw new ActionError("FOCUS_RESTRICTED", `focus restricted for "${name}", opened new instance`);
  }
}

export async function activateApp(app, tools) {
  if (Number.isInteger(app.pid) && app.pid > 0) await focusApp(app.name, app.pid, tools);
  else await openApp(app.name, tools);
}
