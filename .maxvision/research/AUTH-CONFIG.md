# AUTH-CONFIG — Análise de autenticação, configuração e persistência

Surface: `auth.js`, `config.js`, `config.json` (seed) + todo ponto de `server.js` que os toca.
Repo: `decktech` (fork de Dokke v0.2.8). Todas as citações são `path:linha` de arquivos lidos
diretamente nesta sessão.

---

## 1. Esquema do PIN, ponta a ponta

### Geração
- `newPin()` — [auth.js:21-23](auth.js) — `String(randomInt(0, 10000)).padStart(4, "0")`.
  `randomInt` é CSPRNG (`node:crypto`), uniforme, sem viés de módulo (intervalo é potência exata
  do range pedido). Correto como gerador.
- **Entropia real: 4 dígitos = 10.000 valores ≈ 13,29 bits.** Isso é o parâmetro que define toda
  a análise de força de força bruta abaixo — não é defeito do gerador, é o espaço de chaves
  escolhido pro produto (PIN de kiosk, não senha).

### Armazenamento
- Persistido em texto puro em `.j5-pin`, um dígito por linha — [auth.js:37-43](auth.js) —
  `writeFile(file, pin + "\n", { mode: 0o600 })` seguido de `chmod(file, 0o600)` explícito (o
  comentário em [auth.js:41](auth.js) explica que `mode` só vale na criação, então o `chmod`
  corrige arquivos legados 0644). Correto no design **para POSIX**; ver §5 pra por que o `0o600`
  não significa nada no Windows.
- `ensurePin()` — [auth.js:46-56](auth.js) — lê o PIN existente e corrige a permissão a cada boot,
  ou gera um novo se não existir/for inválido (`PIN_RE = /^\d{4}$/` — [auth.js:6](auth.js)).

### Comparação
- `safeEqual(a, b)` — [auth.js:100-104](auth.js) — faz `sha256(a)` e `sha256(b)` e usa
  `timingSafeEqual` nos digests, não nos valores crus. Isso evita tanto vazamento de tamanho
  (digest tem tamanho fixo) quanto short-circuit por byte — correto.
- Uso: `safeEqual(given, auth.getPin())` em [server.js:419](server.js). O PIN vem do body JSON
  em `POST /api/auth` — [server.js:408](server.js).

### Timing
- A comparação em si é constant-time (acima). Mas o *caminho* até ela não é: `pinLocks.isLocked`
  é checado antes ([server.js:414](server.js)), e só se não estiver locked é que `safeEqual` roda —
  isso é uma branch de timing observável (locked vs. não-locked), mas não vaza informação sobre o
  PIN certo, só sobre o estado do rate limit. Não é uma vulnerabilidade de timing prática.

### Regeneração
- `POST /api/pin` — [server.js:451-456](server.js) — gera PIN novo (`newPin()`), grava via
  `auth.setPin(p)`. `setPin` — [server.js:961-966](server.js) — grava o arquivo e **revoga todas as
  sessões** (`sessionStore.revokeAll()`), efetivamente deslogando todo companion pareado. Design
  correto: rotação de PIN = novo pareamento.
- Gate: só loopback pode ler ou regenerar (`GET`/`POST /api/pin`) — [server.js:446-450](server.js).
  Um atacante na LAN nunca descobre o PIN por essa rota. **Mas** ver §4 — o gate de loopback é o
  ponto mais frágil da superfície inteira num host multiusuário.

### Rate limiting / anti-bruteforce
- `createPinLocks({ maxFails: 5, lockMs: 60_000 })` — [auth.js:172-202](auth.js), instanciado uma
  vez como singleton de módulo em [server.js:57](server.js) (compartilhado por **toda** instância
  de `makeApp()` no processo — não é por-servidor, é por-processo Node).
- Chave do lock: **IP de origem apenas** (`req.socket.remoteAddress`, [server.js:397](server.js)),
  nunca uma janela global. `register()` conta falhas por IP; ao atingir 5 falhas na mesma janela de
  60s, tranca aquele IP por mais 60s ([auth.js:187-197](auth.js)).
- **Isso é o achado central de segurança desta superfície.** Rodando os números: 5
  tentativas/60s/IP contra um espaço de 10.000 PINs dá ~33h pra esgotar sequencialmente *um único
  IP*. Mas numa LAN o atacante controla a variável que o lock usa como chave: basta rodar de duas
  máquinas, usar múltiplos endereços IPv6 temporários da própria NIC, ou (em Wi-Fi) trocar de IP
  via DHCP renew — cada IP novo reseta o contador a zero. Não há limite global de tentativas por
  processo, nem CAPTCHA, nem notificação/alerta ao dono quando um lock dispara. O rate limit
  degrada de "impraticável" pra "inconveniente" assim que o atacante paraleliza a origem.
- `prune()` só roda dentro de `register()` — [auth.js:176-181,188](auth.js) — ou seja, o `Map` de
  locks só é podado quando alguém erra o PIN de novo; entradas de IPs que erraram uma vez e nunca
  mais voltaram ficam permanentemente na memória (vazamento de memória lento, não crítico, mas
  real num processo de vida longa como um kiosk server).

### Sessão / token
- Cookie de sessão nunca carrega o PIN — carrega um token opaco de 32 bytes aleatórios em
  base64url ([auth.js:145](auth.js)). No disco só fica `sha256(token)` + timestamp de expiração
  ([auth.js:146](auth.js), [createSessionStore](auth.js:111-166)) — arquivo roubado não dá login.
  **Design correto e vale destacar como ponto positivo genuíno.**
- TTL: 180 dias ([auth.js:12](auth.js), comentado como "sessão longa de kiosk"). Sem idle timeout,
  sem rotação no uso (o mesmo token vale pelos 180 dias inteiros, não é renovado a cada request).
  Um cookie de sessão roubado (ex.: captura de tráfego HTTP em claro, §3) é válido de qualquer
  lugar por até 6 meses; a única forma de revogação é `setPin()` derrubando tudo
  ([server.js:965](server.js)) — não existe logout individual nem lista de sessões pra o dono
  revisar/revogar uma por uma.
- `check(token)` — [auth.js:155-159](auth.js) — valida `typeof === "string" && length >= 20` antes
  de hashear; não valida formato do token em si (não que precise, já que é hash-lookup).
- `maxSessions = 64` (padrão) — [auth.js:13,111](auth.js) — ao exceder, evicta silenciosamente a
  sessão de expiração mais próxima (loop linear procurando o menor `exp`,
  [auth.js:147-151](auth.js)). Num ambiente com muitos companions pareados isso desloga o kiosk
  mais antigo sem aviso nenhum a ele nem ao dono.
- Carga do arquivo de sessões na inicialização é síncrona (`readFileSync` dentro de
  `createSessionStore`, [auth.js:118](auth.js)) — comentário justifica corretamente: `check()`
  precisa funcionar já na primeira request. Válida entradas com
  `h.length === 64 && Number.isFinite(expNum) && expNum > now()` ([auth.js:122](auth.js)) mas
  **não valida que `h` é hex** — uma chave de 64 chars não-hex entraria no Map e nunca faria match
  com um `hashToken()` real; inofensivo (só lixo morto), não é vulnerabilidade.
- `j5-sessions.json` **não tem campo de versão/schema**. Qualquer mudança futura de formato cai no
  `catch {}` mudo de [auth.js:127](auth.js) e o efeito é logout silencioso de toda a base de
  sessões — sem log, sem erro, sem sinalização pro operador.
- Persistência é atômica via tmp+rename com fallback pra write direto se o rename falhar
  ([auth.js:129-141](auth.js)) — comportamento correto e defensivo. Comparar com `config.js`, que
  **não tem esse fallback** (§5).

### Cookies
- `pinCookie`/`clearLegacyPinCookie` ([auth.js:64-68,84-86](auth.js)) — cookie legado que antes
  carregava o PIN cru é explicitamente apagado a cada login bem-sucedido
  ([server.js:429](server.js)) — boa prática de migração de versões antigas que guardavam o PIN
  no cookie.
- `sessionCookie` ([auth.js:77-81](auth.js)) — `HttpOnly`, `SameSite=Strict`, `Max-Age` = TTL em
  segundos. `Secure` só é adicionado se `req.socket.encrypted` for true
  ([server.js:428](server.js)) — logicamente correto (não seta `Secure` numa conexão HTTP, o que
  quebraria o cookie), mas isso significa que **por padrão** (sem `HTTPS_CERT`/`HTTPS_KEY`, ver
  §3) o cookie de sessão trafega sem `Secure`.

---

## 2. Onde o estado é escrito em disco e como sobrevive à reinstalação

- `userDataDir()` — [server.js:928-933](server.js) — já resolve por plataforma:
  - Windows: `process.env.APPDATA` + `"Dokke"` → tipicamente `%APPDATA%\Dokke`
    (`C:\Users\<user>\AppData\Roaming\Dokke`).
  - macOS: `~/Library/Application Support/Dokke`.
  - Linux/outros: `$XDG_CONFIG_HOME` ou `~/.config` + `"dokke"` (minúsculo — inconsistência de
    case com o `"Dokke"` do Windows/macOS; irrelevante no Windows por case-insensitivity do NTFS
    default, mas real em Linux se algum script comparar strings).
- Arquivos gravados nesse diretório: `config.json`, `.j5-pin`, `j5-sessions.json`.
- Fica **fora do diretório da aplicação/bundle**, então sobrevive a reinstalação/atualização por
  construção — isso já satisfaz o requisito do PRD linha 211-213 ("a configuração deve ficar em
  diretório de dados do usuário, não dentro da [bundle]").
- Migração automática do config: se `%dataDir%/config.json` não existe, tenta semear a partir do
  `config.json` do bundle (`import.meta.dirname`) — [server.js:939-946](server.js) — nunca
  sobrescreve um `userConfig` existente.
- Migração automática do PIN: se `.j5-pin` não existe no `pinRoot`, copia de
  `import.meta.dirname/.j5-pin` (localização legada, dentro do bundle) —
  [server.js:950-954](server.js). **Implicação:** versões antigas do produto gravavam o PIN
  *dentro* do diretório da aplicação — pra quem tem esse arquivo legado, ele é copiado (não
  movido) pro novo local; o original permanece no bundle antigo até ser apagado por uma
  reinstalação/limpeza.
- `mkdirSync(dataDir, { recursive: true })` — [server.js:935](server.js) — erro é silenciosamente
  engolido (`catch (e) {}`). Se `%APPDATA%` estiver redirecionado por política de grupo ou negado
  por permissão, toda escrita subsequente falha sem diagnóstico nenhum pro operador.

---

## 3. Config schema, defaults, migração/versionamento

- `config.json` (seed do bundle) hoje é `{"pinned": []}` — [config.json:1-3](config.json) — **sem**
  `schemaVersion` nem `pieces`, isto é, o próprio arquivo seed do repo já está no formato legado
  v1.
- `normalizeConfig(raw)` — [config.js:177-187](config.js) — é o único ponto de entrada de leitura:
  converte `pinned` legado (lista de strings) em `pieces` do tipo `app`
  ([config.js:179](config.js)), funde com `pieces` novo se presente, e **sempre** retorna
  `schemaVersion: 2` fixo ([config.js:182](config.js)) — não existe um `switch(source.schemaVersion)`
  em lugar nenhum do código (`grep -n schemaVersion *.js` confirma: só é escrito, nunca lido pra
  decidir um caminho de migração). Isso significa que o campo `schemaVersion` **hoje é decorativo**
  — ele documenta a versão mas não dirige lógica nenhuma; se aparecer uma v3 amanhã, este código a
  lê, força pra v2 e regrava — perda silenciosa de qualquer campo novo que a v3 tivesse introduzido
  e que `normalizeConfig` não reconheça (ele só extrai `pieces`/`pinned`/`revision`, tudo o mais é
  descartado).
- `DEFAULT` — [config.js:5](config.js) — `{ schemaVersion: 2, revision: 0, pieces: [], pinned: [] }`
  é o fallback de `loadConfig` em qualquer erro de leitura/parse (`catch { return
  structuredClone(DEFAULT); }`, [config.js:192](config.js)) — um `config.json` corrompido nunca
  quebra o boot, apenas volta pro estado vazio. Correto como estratégia defensiva, mas silenciosa:
  não há log distinguindo "arquivo não existe" de "arquivo corrompido", ambos caem no mesmo catch.
- `revision` é de fato usado como controle de concorrência otimista, não é decorativo: incrementado
  em pelo menos 6 pontos de mutação (`server.js:515,556,590,638,697,703,731`), e o cliente precisa
  mandar a revisão esperada em operações de reorder ([server.js:656,663,719,726](server.js)) — um
  mismatch dispara `rejectRevision` → `409 REVISION_CONFLICT` ([server.js:345-349](server.js)).
  Mecanismo de concorrência real e funcional.
- Escrita: `saveConfig` — [config.js:195-201](config.js) — sempre passa por `normalizeConfig`
  antes de gravar (nunca persiste um objeto cru fora do formato canônico), e usa tmp+rename
  (`${file}.${pid}.${randomHex}.tmp` → rename) pra atomicidade e pra evitar colisão entre
  escritores concorrentes (kiosk + app Mac editando ao mesmo tempo, conforme comentário em
  [config.js:197](config.js)). **Diferença notável de `auth.js`: aqui não existe fallback se o
  `rename` falhar** — comparar com [auth.js:135-138](auth.js), que tenta um `writeFile` direto se o
  `rename` falha. Em `config.js` uma falha de `rename` propaga a exceção pra cima e o `.tmp` fica
  órfão no diretório. Isso importa concretamente no Windows — ver §5.

---

## 4. Avaliação como revisor de segurança — a superfície bind numa interface LAN e aceita comandos que abrem aplicativos locais

Ordenado por severidade real:

1. **Confiança de loopback é uma decisão de single-user, e o host Windows quebra essa premissa.**
   `trustLoopback` é `true` por padrão ([server.js:395,970](server.js)); `isLoopback()` —
   [auth.js:59-62](auth.js) — confia em qualquer peer cujo IP de socket seja `127.0.0.1`/`::1`. O
   comentário no próprio código admite a premissa: *"Loopback ... = dono do Mac, confiável"*
   ([auth.js:58](auth.js)). Em macOS single-user isso é razoável. Em Windows, loopback não implica
   "o dono do app": qualquer outro **usuário interativo local** (fast user switching), qualquer
   sessão **RDP/Terminal Services** que aterrisse no mesmo host, ou qualquer **processo
   não-privilegiado** rodando como outro usuário na mesma máquina também bate em `127.0.0.1` com o
   mesmo direito de loopback. Isso dá acesso *total* a `/api/*` sem PIN — incluindo
   `GET /api/pin`, que devolve o PIN em texto puro pra qualquer chamador loopback
   ([server.js:458](server.js)) — numa superfície cujo propósito explícito é **lançar aplicativos
   locais** (`activateApp`/`openWebsite`, importados em [server.js:27](server.js)). Este é o
   achado que mais muda de severidade entre macOS e Windows: no host original o modelo de ameaça é
   "outro dispositivo na LAN"; no host Windows PRD, "outro usuário local/RDP" também precisa entrar
   no modelo, e hoje não entra.
2. **Rate limit de PIN é contornável por rotação de IP** (detalhado em §1) — janela real de ataque
   depende só de quantos IPs o atacante consegue apresentar, não do limite de 5/60s.
3. **PIN e cookie de sessão trafegam em claro por padrão.** `makeServer()` —
   [server.js:14-25](server.js) — só sobe HTTPS se `HTTPS_CERT` e `HTTPS_KEY` estiverem setados via
   env; por padrão é HTTP puro. Captura passiva na mesma rede Wi-Fi/LAN vê o body de
   `POST /api/auth` (PIN em claro) e o `Set-Cookie` de sessão. Os atributos do cookie (`HttpOnly`,
   `SameSite=Strict`) protegem contra XSS/CSRF, não contra sniffing de rede — a superfície de
   ameaça declarada (LAN) inclui exatamente esse vetor.
4. **`opts.root` é overloaded entre "raiz de arquivos estáticos" e "raiz do PIN", e isso é um
   footgun latente, não ativo.** Em `makeApp`, `root` é o diretório servido publicamente
   ([server.js:294](server.js), default `public/`). Em `startServer`, `pinRoot = opts.root ??
   dataDir` ([server.js:949](server.js)) — o **mesmo campo `opts.root`** decide onde o `.j5-pin`
   é gravado. Hoje, em produção, ninguém passa `opts.root`, então `pinRoot` cai em `dataDir`
   (`%APPDATA%\Dokke`, fora do `public/` servido) e não há problema. Mas se qualquer chamador
   futuro (ex.: o shell Electron do PRD, que precisa gerenciar o ciclo de vida do servidor e
   plausivelmente passar caminhos customizados) setar `opts.root` pra apontar pro mesmo lugar
   servido estaticamente, o `.j5-pin` passa a existir dentro da árvore servida por HTTP. O handler
   estático não tem allowlist de extensão nem bloqueio de dotfile — só um guard de path traversal
   (`resolve(p).startsWith(resolve(root))`, [server.js:891-893](server.js)) — e arquivos estáticos
   não passam pelo wall de auth, que só cobre `/api/*` ([server.js:462](server.js)). Nesse cenário,
   `GET /.j5-pin` serviria o PIN em texto puro pra qualquer host da LAN sem autenticação nenhuma.
   Não há teste hoje que exercite `startServer` com `opts.root` custom (`grep` em `test/*.mjs` não
   encontra nenhum), então é uma armadilha de acoplamento a evitar no shell Windows, não uma
   vulnerabilidade confirmada em produção.
5. **`/api/probe` fica fora do wall de auth e loga parâmetros arbitrários do atacante** —
   [server.js:378-382](server.js) — `console.log("[probe]", ...flags)` com `flags` vindo direto de
   `url.searchParams` de qualquer host da LAN. `JSON.stringify` neutraliza injeção de newline no
   log, então o risco real é crescimento não limitado do log, não forjamento de log.
6. **Pontos corretos, citados uma vez cada:** `safeEqual` constant-time (§1); CSRF coberto por
   `sameOrigin` em métodos de mutação ([server.js:325](server.js)) — a permissão de `Origin`
   ausente ([server.js:67-68](server.js)) é uma concessão deliberada pra clientes nativos (app
   Android/Mac sem header `Origin`), documentada no comentário, não um descuido; guard de path
   traversal no static handler ([server.js:891-893](server.js)) correto; formato de sessão em
   disco (só hash+expiração, nunca o token) genuinamente bom.

---

## 5. Caminhos de filesystem que mudam no Windows

| Item | macOS (referência) | Windows | Evidência |
|---|---|---|---|
| Diretório de dados | `~/Library/Application Support/Dokke` | `%APPDATA%\Dokke` (= `...\AppData\**Roaming**\Dokke`) | [server.js:930-931](server.js) |
| `config.json`, `.j5-pin`, `j5-sessions.json` | dentro do dir acima | idem, dentro de `%APPDATA%\Dokke` | [server.js:936,950,958](server.js) |
| Separador de path | `/` | `join()` usado consistentemente em todo o código lido — sem concatenação manual de string em nenhum dos três arquivos | [auth.js:16-17](auth.js), [server.js:930-936](server.js) |
| Permissão de arquivo (`chmod 0o600`) | reduz o arquivo a leitura/escrita só do dono | **sem efeito equivalente.** No Windows, `fs.chmod`/`mode` só alternam o bit read-only; bits de owner/group/other não existem nesse modelo. A proteção real do `.j5-pin` no Windows vem só da ACL NTFS herdada do perfil do usuário — que tipicamente inclui `Administrators` e `SYSTEM` além do dono, e qualquer processo rodando como esse usuário, independente de integrity level. O comentário em [auth.js:41](auth.js) ("chmod também corrige arquivos legados") é uma garantia que só se sustenta em POSIX. | [auth.js:40,42,50,134](auth.js) |
| `%APPDATA%` é **Roaming** | N/A (não há conceito equivalente) | Em máquina domain-joined com perfis roaming, `config.json`/`.j5-pin`/`j5-sessions.json` replicam pra fora da máquina local — inclusive o PIN em texto puro. `%LOCALAPPDATA%` seria o alvo correto pra segredo local-only. | [server.js:930](server.js) |
| Atomicidade de escrita (`rename` sobre destino existente) | funciona sempre | `rename()` pode falhar com `EPERM`/`EBUSY` no Windows quando outro processo tem o arquivo aberto (AV em tempo real, Windows Search Indexer, sincronização OneDrive se `%APPDATA%` estiver dentro de uma pasta sincronizada). `auth.js` tem fallback (`writeFile` direto se o `rename` falhar, [auth.js:135-138](auth.js)); **`config.js` não tem** — nesse cenário, `saveConfig` propaga a exceção e deixa um `.tmp` órfão no diretório de dados. | [config.js:198-200](config.js) vs [auth.js:135-138](auth.js) |
| Case do nome de diretório | `Dokke` | `Dokke` (idêntico ao macOS) | [server.js:930-931](server.js) — mas Linux usa `"dokke"` minúsculo ([server.js:932](server.js)), inconsistência cosmética que não afeta Windows |
| Desinstalação | não documentada aqui | **Política ainda não definida** — o próprio PRD lista isso como risco aberto: *"Desinstalação pode apagar ou preservar PIN/configuração | Fechar política antes do release"* (`docs/plans/2026-08-18-dokke-windows-host-prd.md:309`). Hoje, como o dataDir fica fora do diretório de instalação, um desinstalador padrão (MSI/Squirrel) que só remove o diretório de instalação preserva PIN e config por acidente de localização, não por decisão explícita — não há hook de desinstalação nesta superfície. | PRD linha 309 |

---

## 6. Acoplamento e duplicação concretos (rebrand Dokke → DeckTech)

- `server.js` **hardcoda** os literais `".j5-pin"` ([server.js:950,952,953](server.js)) e
  `"j5-sessions.json"` ([server.js:958](server.js)) em vez de importar `PIN_FILE`/`SESSION_FILE`
  de `auth.js` ([auth.js:8,10](auth.js)) — as constantes existem e não são usadas nesses três
  pontos. Renomear as constantes em `auth.js` não muda esses literais; é duplicação real, não
  hipotética.
- Nomes com "j5"/"dokke" espalhados por toda a superfície, todos pontos de rebrand:
  `AUTH_COOKIE = "j5_pin"`, `SESSION_COOKIE = "j5_session"`, `PIN_FILE = ".j5-pin"`,
  `SESSION_FILE = "j5-sessions.json"` ([auth.js:7-10](auth.js)); `userDataDir()` retornando
  `"Dokke"`/`"dokke"` ([server.js:930-932](server.js)); `service: "Dokke"` na resposta de
  `/health` ([server.js:377](server.js)); prefixo de log `[dokke]` ([server.js:134](server.js));
  `DISCOVERY_MAGIC = "dokke:discover"` e a resposta `dokke:<ip>:<port>` do UDP discovery
  ([server.js:96,113](server.js)); URLs de release `felipenalves/Dokke` e `dokke.apk`
  ([server.js:85-95](server.js)).
- **Consequência não óbvia pro rebrand:** trocar `userDataDir()` pra `"DeckTech"` sem uma etapa de
  migração órfã todo `%APPDATA%\Dokke` já existente — PIN, config e sessões de quem já instalou o
  Dokke original ficam presos no diretório antigo. O código já tem o padrão certo pra isso (a
  cópia condicional em [server.js:939-946](server.js) pro config e [server.js:950-954](server.js)
  pro PIN, ambas "nunca sobrescreve, só copia se destino não existe") — a migração pro rebrand
  precisa do mesmo padrão apontando de `%APPDATA%\Dokke` pra `%APPDATA%\DeckTech`, e não pode
  contar com `schemaVersion` pra decidir nada (§3: o campo não é lido).
- Footgun de default em `auth.js`: toda função exportada usa `root = import.meta.dirname` como
  default ([auth.js:16,26,37,46](auth.js)) — ou seja, o valor padrão é *o diretório do bundle*, o
  lugar inseguro. Só `server.js` corrige isso passando `pinRoot` explícito
  ([server.js:956,963](server.js)). Qualquer novo caller (ex.: um teste, ou o shell Windows) que
  chame `ensurePin()`/`writePinFile()` sem passar `root` explicitamente volta a escrever o PIN
  dentro do diretório da aplicação — o mesmo padrão legado que a migração em
  [server.js:950-954](server.js) existe pra corrigir.

---

## Resumo executivo (3 linhas)

PIN de 4 dígitos com geração, comparação e persistência de sessão tecnicamente corretas
individualmente, mas o rate limit é por-IP e contornável, o loopback bypass assume single-user (o
que o Windows quebra estruturalmente com múltiplos usuários/RDP no mesmo host), e não há TLS por
padrão — três lacunas que compõem, porque a superfície controla lançamento de aplicativos locais.
No Windows, `chmod(0o600)` não protege nada (ACL NTFS é quem manda), `%APPDATA%` é roaming quando
deveria ser local, e `config.js` não tem o fallback de rename atômico que `auth.js` tem — mesma
operação, duas garantias diferentes. `schemaVersion` é escrito mas nunca lido; qualquer migração de
schema futura (incluindo a do próprio rebrand Dokke→DeckTech no `userDataDir()`) precisa ser
construída do zero, não estendida.
