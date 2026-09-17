# CORE-SERVER — análise de superfície (Node server core do Dokke/DeckTech)

Escopo: `server.js` (1089 linhas), `apps.js` (707 linhas), `actions.js` (31
linhas), `obs.js` (92 linhas), `obs-ws.js` (66 linhas) — todos na raiz do
repo. Verificado com `wc -l` em 2026-09-17; nenhum diretório `platform/` ou
`windows/` existe no tree (`find . -maxdepth 2 -iname "platform*" -o
-iname "windows*"` não retornou nada fora de `.git`), confirmando que o PRD e
o plano de implementação Windows (`docs/plans/2026-08-18-dokke-windows-host-*`)
nunca foram codados.

---

## 1. Visão geral da arquitetura

`server.js` monta um único `http(s).Server` + `WebSocketServer` (biblioteca
`ws`) compartilhando a mesma porta (upgrade no mesmo listener,
[server.js:989-996](server.js#L989-L996)). `makeApp()` ([server.js:292](server.js#L292))
retorna o request handler puro (testável sem bind de porta); `startServer()`
([server.js:912](server.js#L912)) é o bootstrap real que resolve diretório de
dados, PIN, sessões, OBS e sobe o listener.

Dependências de plataforma entram via injeção de dependência em `makeApp`:
`appTools = { listAppProcesses, listInstalledApps }` e
`actions = { activateApp, openWebsite }`
([server.js:295-296](server.js#L295-L296)), com defaults importados
diretamente de `apps.js`/`actions.js`. Isso já é *quase* o adaptador de
plataforma que o PRD pede — mas os defaults só têm implementação macOS; não
existe seam explícito (nenhuma fábrica `platform/index.js` que escolha
mac vs windows por `process.platform`).

---

## 2. HTTP routing — cada `/api/*` com método e shape

Roteamento é feito com `if (url.pathname === ...)` sequenciais dentro de um
único closure `handler` (não há Router/tabela); a ordem importa porque
alguns matches usam regex (`url.pathname.match(...)`). Body é lido via
`readBody()` ([server.js:139-157](server.js#L139-L157)), que acumula string,
corta em 64KB (`BODY_MAX_BYTES`, [server.js:53](server.js#L53)) devolvendo o
sentinel `BODY_TOO_BIG`, e faz `JSON.parse` devolvendo `BODY_INVALID` em
erro — **nunca lança**, todo endpoint precisa checar os dois sentinels
manualmente (repetido ~10x).

| Rota | Método | Auth | Shape body → resposta | Linha |
|---|---|---|---|---|
| `/health` | GET | não | `→ {ok:true, service:"Dokke"}` | [377](server.js#L377) |
| `/api/probe` | GET | não | loga UA+querystring, `204` vazio | [378](server.js#L378) |
| `/api/version` | GET | não | `→ {ok, local:{tag,apkVersion}, latest}` (latest = cache do GitHub releases) | [383](server.js#L383) |
| `/api/auth` | POST | não (é o login) | `{pin}` → `Set-Cookie` sessão + `{ok:true}` / 401 / 429 (lock) | [401](server.js#L401) |
| `/api/pin` | GET/POST | **loopback only** | GET `→{ok,pin}`; POST regenera `→{ok,pin}` e revoga todas sessões | [444](server.js#L444) |
| `/api/apps` | GET | sim | `→{pieces,revision,pinned,running,v,limits}` | [467](server.js#L467) |
| `/api/config` | GET | sim | `→{ok,config:publicCfg}` | [476](server.js#L476) |
| `/api/config/pinned` | POST | sim | `{app,position?}` adiciona 1 → `{ok,config,pushed}` | [484](server.js#L484) |
| `/api/config/pinned` | PUT | sim | `{apps\|pinned:[]}` substitui lista inteira (bulk, app Mac) → `{ok,config,pushed}`; 409 se config tem sites | [492](server.js#L492) |
| `/api/config/pinned/:name` | DELETE | sim | remove 1 app → `{ok,config,pushed}` | [572](server.js#L572) |
| `/api/config/pieces` | POST | sim | `{type:"website",title,url,position?}` → `{ok,piece,added,config}` | [601](server.js#L601) |
| `/api/config/pieces/order` | PUT | sim | `{revision,ids[],positions?}` reordena (409 se `revision` não bate) | [653](server.js#L653) |
| `/api/config/pieces/:id` | DELETE | sim | `{revision}` remove peça (409 revision, 404 not found) | [712](server.js#L712) |
| `/api/pieces/:id/open` | POST | sim | abre peça tipo `website` via `actions.openWebsite` → `{ok,piece}` | [739](server.js#L739) |
| `/api/status` | GET | sim | `→{ok,service,devices,pinned,config}` | [772](server.js#L772) |
| `/api/apps/installed` | GET | sim | `→{ok,apps:[{name,path,icon}]}` (via `appTools.listInstalledApps`) | [791](server.js#L791) |
| `/api/apps/:name/activate` | POST | sim | `{pid?}` → `actions.activateApp({name,pid})` → `{ok:true}` | [798](server.js#L798) |
| `/api/apps/:name/icon` | GET | sim | PNG binário, `Cache-Control: public, max-age=86400` ou 404 | [825](server.js#L825) |
| `/api/obs/state` | GET | sim | `{ok:true,connected:false}` se sem OBS; senão `{ok,connected:true,state}` | [852](server.js#L852) |
| `/api/obs/record` `/stream` `/stop-all` | POST | sim | toggles, `{ok:true}` ou `{ok:false,connected:false}` | [865-867](server.js#L865-L867) |
| `/api/obs/scene` | POST | sim | `{scene}` → `switchScene` | [868](server.js#L868) |
| `/*` (estático) | GET | não | serve `public/`, guarda path traversal, `index.html`/`sw.js` sem cache | [888](server.js#L888) |

Observações relevantes:
- **Gate de auth genérico**: qualquer `/api/*` exige `authed()` (loopback OU
  cookie de sessão válido), aplicado *antes* do roteamento específico
  ([server.js:462-466](server.js#L462-L466)) — exceto `/api/auth` e
  `/api/pin`, que têm suas próprias regras.
- **CSRF/Origin check**: todo método state-changing (`POST/PUT/PATCH/DELETE`)
  exige `sameOrigin(req)` ([server.js:66-77](server.js#L66-L77),
  aplicado em [325](server.js#L325)) — Origin ausente é permitido (clientes
  nativos/apps), Origin presente precisa bater exatamente.
- **Optimistic concurrency**: mutações de `pieces` usam `revision` (contador
  monotônico em `config.json`) e devolvem 409 `REVISION_CONFLICT` se o
  client está desatualizado ([server.js:345-349](server.js#L345-L349)).
- **Serialização de escrita**: `withConfigLock` ([server.js:317-321](server.js#L317-L321))
  encadeia uma fila de promises — não é lock de arquivo real, é apenas
  ordenação in-process; concorrência entre múltiplos processos Node não é
  coberta (não é um cenário do produto atual, mas seria relevante se o host
  Windows rodar o server como serviço + tray process separados).
- **Erros nunca vazam detalhe**: `fail()` ([server.js:133-137](server.js#L133-L137))
  loga a mensagem real no console do servidor e devolve sempre
  `{ok:false,error:"erro interno"}` genérico com status 500 ao cliente.

---

## 3. Protocolo WebSocket

Upgrade acontece no mesmo `http.Server` ([server.js:989](server.js#L989)),
path implícito é o único path que o `ws` lib aceita nesse server (o client
conecta em `ws://host:port/ws` conforme `public/index.html:2348`).

**Autenticação do upgrade** (`verifyClient`, [server.js:991-995](server.js#L991-L995)):
mesma regra do HTTP — `sameOrigin` + (loopback OU sessão de cookie válida).

**Mensagens servidor → cliente** (via `createStatusFeed`,
[server.js:233-290](server.js#L233-L290)):
- `{type:"online", online:true, devices, v}` — enviada uma vez ao conectar
  ([server.js:274](server.js#L274)).
- `{type:"apps", pieces, revision, pinned, running, devices, v, limits}` —
  broadcast a cada mudança de estado ou a cada `STATUS_POLL_MS` (1500ms,
  [server.js:161](server.js#L161)) enquanto houver clients conectados; só
  envia de fato se o payload serializado mudou (`encoded === last` dedupe,
  [server.js:261](server.js#L261)), exceto quando `force=true` (nova
  conexão ou `ping()` explícito).
- `{type:"online", online:false}` — no `close()` do feed
  ([server.js:286](server.js#L286)).

**Mensagens cliente → servidor**: só `{type:"ping"}`
([server.js:1010](server.js#L1010), consumido no cliente em
`public/index.html:2385`) — usado como keep-alive leve que força um
`broadcast(true)` imediato, mas rate-limitado por conexão via
`PING_MIN_INTERVAL_MS` (1500ms, [server.js:60](server.js#L60),
[server.js:1008-1016](server.js#L1008-L1016)) para não virar amplificador
de tráfego.

**Reconexão**: client-side (`public/index.html:2371-2378`) usa backoff
exponencial de 2s até 30s, só reconecta se a página não estiver hidden.
Server-side, heartbeat próprio detecta conexões mortas: todo `WS_HEARTBEAT_MS`
(30s, [server.js:62](server.js#L62)) o servidor faz `ping()` nativo do
protocolo WS em cada client e termina quem não respondeu `pong` desde o
ciclo anterior ([server.js:1020-1032](server.js#L1020-L1032)) — isso é
distinto do `{type:"ping"}` JSON que é aplicativo, não protocolo.

**Push imediato em mutação**: toda rota state-changing de config chama
`onStatusChange()` → `feed.ping()` (`force:true`), assim um dispositivo
recebe a alteração em <1s sem esperar o poll de 1500ms
(comentário em [server.js:281](server.js#L281)).

Nada aqui é macOS-específico; o WS/HTTP core é 100% portável — é a razão
pela qual o PRD (seção 11) descreve "o núcleo de protocolo e sincronização
deve ser reaproveitado" no host Windows.

---

## 4. Inventário de apps e ícones — TUDO macOS-only

Este é o núcleo do trabalho de port. `apps.js` é inteiramente construído em
cima de chamadas de shell e frameworks Apple:

### 4.1 Descoberta (`listInstalledApps` / `scanAppsDirs`)
- Varre diretórios fixos macOS: `/Applications`, `/System/Applications`,
  `~/Applications` ([apps.js:27-31](apps.js#L27-L31)), mais um path
  hardcoded para o Finder em `/System/Library/CoreServices/Finder.app`
  ([apps.js:34-36](apps.js#L34-L36)).
- `findAppBundles()` ([apps.js:189-211](apps.js#L189-L211)) é um `readdir`
  recursivo (profundidade máx. 2) procurando diretórios `*.app`, resolvendo
  symlinks com `stat()` (cobre o caso Safari→Cryptex).
- Cache de inventário: TTL 120s (`INSTALLED_APPS_TTL_MS`,
  [apps.js:19](apps.js#L19)), com dedupe de scan concorrente
  (`installedCache.promise`, [apps.js:66](apps.js#L66),
  [apps.js:243-259](apps.js#L243-L259)) e teste helper
  `clearInstalledAppsCache()` ([apps.js:71-73](apps.js#L71-L73)).
- **Nenhuma parte é Windows-portável**: bundle `.app` não existe em Windows
  (o equivalente seria `.lnk`/registry/Start Menu, conforme RF-03 do PRD).

### 4.2 Processos em execução (`listAppProcesses`)
- Faz `execFile("/usr/bin/lsappinfo", [])` ([apps.js:11](apps.js#L11),
  chamado em [apps.js:108](apps.js#L108)) — utilitário CLI exclusivo do
  macOS. Parseia saída texto com regex (`parseApps`,
  [apps.js:75-91](apps.js#L75-L91)) extraindo `name`, `pid`, `type`,
  `bundlePath`; filtra só `type === "Foreground"`
  ([apps.js:111](apps.js#L111)).
- Resolve nome canônico via `canonicalAppNameFromBundlePath`
  ([apps.js:97-100](apps.js#L97-L100)) porque `lsappinfo` devolve o nome
  localizado (ex. "Calendário") mas o bundle path preserva o nome estável
  (ex. "Calendar") — casado com `LOCALIZED_APP_ALIASES`
  ([apps.js:41-49](apps.js#L41-L49)) usado depois na resolução de ícone.
- Cache curto TTL 1500ms (`RUNNING_TTL_MS`, [apps.js:25](apps.js#L25)) —
  evita fork por poll de status (o poll HTTP do `server.js` roda a cada
  `STATUS_POLL_MS=1500ms`).
- Windows equivalente seria enumerar processos + títulos de janela (Win32
  API `EnumWindows`/`GetWindowText` ou PowerShell `Get-Process`), sem
  conceito de "bundle path" nem "type=Foreground" do LaunchServices.

### 4.3 Ícones (`realIconService`)
Cadeia de fallback em `loadPng()` ([apps.js:621-689](apps.js#L621-L689)),
por ordem de tentativa:
1. **Helper nativo AppKit** — `DokkeIconHelper.app`
   ([apps.js:13](apps.js#L13), fonte Swift em
   `mac/IconHelper/main.swift`) chamado via `/usr/bin/open -W -n <helper>
   --args <src> <out> <maxPx>` ([apps.js:264-275](apps.js#L264-L275)). O
   Swift usa `NSWorkspace.shared.icon(forFile:)` + `effectiveAppearance`
   para respeitar dark/light mode do ícone
   (`mac/IconHelper/main.swift:38-73`). Isto é o mesmo caminho que o
   Finder usa para ícones — não tem análogo direto no Win32 API puro (o
   equivalente seria `SHGetFileInfo`/`IExtractIcon` do shell do Windows).
2. **Fallback de arquivo direto** — `findIconFile()`
   ([apps.js:157-187](apps.js#L157-L187)) lê `Contents/Info.plist` via
   `execFile("plutil", ["-convert","json","-o","-", ...])`
   ([apps.js:149](apps.js#L149)) para achar `CFBundleIconFile`, depois
   procura o `.icns`/`.png` correspondente em `Contents/Resources`.
   Conversão para PNG é `execFile("sips", ["-s","format","png","-Z",
   maxPx, src, "--out", out])` ([apps.js:278](apps.js#L278)) — `sips` é
   exclusivo do macOS.
3. **Monograma gerado** (`monogramPng`,
   [apps.js:527-557](apps.js#L527-L557)) — fallback plataforma-agnóstico:
   gera SVG com iniciais + gradiente, mas ainda converte pra PNG via
   `sips` ([apps.js:549](apps.js#L549)) — **mesmo o fallback "genérico"
   depende de um binário macOS**. Um port Windows precisaria de outro
   rasterizador (ou reimplementar `normalizePngIcon`/PNG encoder puro-JS
   já presente em [apps.js:474-525](apps.js#L474-L525) sem depender de
   `sips`).
- **Aparência do sistema**: `readMacIconAppearance()`
  ([apps.js:281-291](apps.js#L281-L291)) faz `execFile("/usr/bin/defaults",
  ["read","-g"])` e faz parse regex de `AppleIconAppearanceTheme` /
  `AppleInterfaceStyle` — usado como parte da cache key do ícone
  (`resolveAppearanceToken`, [apps.js:584-595](apps.js#L584-L595), TTL
  1000ms) para invalidar cache quando o usuário troca dark/light mode
  no meio da sessão. Sem equivalente Windows implementado (seria
  `HKCU\...\Personalize\AppsUseLightTheme`).
- **Decodificador/encoder PNG feito à mão**: `decodeRgbaPng`
  ([apps.js:396-453](apps.js#L396-L453)), `normalizePngIcon`
  ([apps.js:474-525](apps.js#L474-L525)), `pngChunk`
  ([apps.js:455-468](apps.js#L455-L468)), `pngIsEmpty`
  ([apps.js:323-369](apps.js#L323-369)) são JS puro, zero dependência
  nativa — **portáveis como estão**. Recortam a margem transparente do
  ícone (bounding box) e reencaixam num canvas fixo com moldura de 94%
  ([apps.js:490](apps.js#L490)) — trata inconsistências reais entre apps
  (comentário cita Calendar/Notion/Books.app).
- Caches em 3 camadas: LRU em memória (`memPng`, cap `MEM_PNG_MAX=40`,
  [apps.js:21](apps.js#L21)), `memMiss` set para não reprocessar ícones
  conhecidos-vazios, e cache em disco (`ICON_CACHE_DIR = .icon-cache/`,
  [apps.js:12](apps.js#L12)) podado a `DISK_PNG_MAX=256` arquivos por
  `pruneIconCache()` ([apps.js:303-319](apps.js#L303-L319), poda por
  `mtime`).

### 4.4 Injeção de dependência já preparada para adaptador
`realIconService(deps)` já aceita `scan`, `findIcon`, `exec`, `iconHelper`
como parâmetros injetáveis ([apps.js:559-573](apps.js#L559-L573)) —
comentário explícito em [apps.js:562-563](apps.js#L562-L563): *"Adaptador
por plataforma: macOS usa Contents/Resources; o futuro Windows poderá
injetar um resolvedor de .exe/.lnk sem mudar a API HTTP."* Esse é o ponto
de menor resistência para o seam do adaptador Windows — a função já separa
"resolver caminho do ícone" de "converter para PNG normalizado". O que
falta é a implementação windows equivalente de `scan`/`findIcon`/`iconHelper`,
mais um jeito de escolher a implementação por `process.platform` (hoje o
default de `iconHelper` já checa `process.platform === "darwin"`
[apps.js:571](apps.js#L571), então em Windows ele cai automaticamente pro
fallback `sips`-based, que também falharia — **hoje rodar isso em Windows
quebra silenciosamente para monograma-que-também-falha**, pois `sips` não
existe lá).

---

## 5. Processo/ativação (`actions.js`) — também macOS-only

Arquivo de 31 linhas, 4 funções:
- `cliExec(cmd,args)` ([actions.js:3-7](actions.js#L3-L7)) — wrapper de
  `execFile` promisificado à mão (não usa `util.promisify`), plataforma-
  agnóstico em si.
- `openApp(name)` → `exec("open", ["-a", name])`
  ([actions.js:9-11](actions.js#L9-L11)) — `open -a` é comando macOS.
- `openWebsite(url)` → `exec("/usr/bin/open", [url])`
  ([actions.js:14-16](actions.js#L14-L16)) — path absoluto macOS; usado
  pela rota `/api/pieces/:id/open`. Comentário confirma que a URL nunca
  vem direto do cliente remoto, só da config persistida (mitigação de
  RCE via shell — mas nota: `execFile` já não interpreta shell, então o
  risco seria só de abrir uma URL inesperada, não injeção de comando).
- `focusApp(name, pid)` ([actions.js:18-26](actions.js#L18-L26)) — se
  `pid` é inteiro positivo, roda AppleScript via `osascript -e "tell
  application \"System Events\" to set frontmost of first process whose
  unix id is <pid> to true"`; se falhar (try/catch), cai para `openApp`
  (nova instância). Sem PID válido, vai direto para `openApp`.
- `activateApp(app, tools)` ([actions.js:28-31](actions.js#L28-L31)) — é
  o único export consumido pelo server (`/api/apps/:name/activate`,
  [server.js:817](server.js#L817)); decide entre foco (se `pid` válido)
  ou abertura.

Windows equivalente do "focus": `SetForegroundWindow`/`AllowSetForegroundWindow`
via PowerShell ou binário nativo — Win32 tem restrições de foco mais
rígidas que macOS (RF-06/risco "Foco" do PRD já antecipa isso, seção 15).

**Tratamento de falha**: em `focusApp`, um erro de `osascript` é
capturado e degrada para `openApp` — não propaga. Em `activateApp`, se
`openApp`/`focusApp` lançar (ex.: app não existe), a exceção sobe até o
`.catch(err => fail(res, err))` da rota ([server.js:820](server.js#L820)),
vira 500 genérico — o servidor **não cai**, mas o erro específico
("app não encontrado") não chega ao cliente, só "erro interno". Isso
cumpre o requisito do PRD "falhas de foco não podem derrubar o servidor"
mas não cumpre plenamente "companion recebe mensagem compreensível" (seção
8.3/RF-06) — hoje toda falha de ativação vira a mesma string genérica.

---

## 6. Integração OBS (`obs.js` + `obs-ws.js`)

Plataforma-agnóstica (TCP/WebSocket puro, sem shell-out). Dois arquivos:

- **`obs-ws.js`** — conexão/handshake com o protocolo obs-websocket v5:
  `connectOBS({password,host,port})` ([obs-ws.js:19](obs-ws.js#L19))
  retorna `null` se `password` vazio (OBS desabilitado por design, não
  erro) ([obs-ws.js:20](obs-ws.js#L20)); timeout de 3s no handshake
  ([obs-ws.js:25](obs-ws.js#L25)); implementa a troca de auth
  `Hello`(op 0)→`Identify`(op 1) com SHA-256 salt+challenge
  (`authResponse`, [obs-ws.js:4-9](obs-ws.js#L4-L9),
  `buildIdentify`, [obs-ws.js:11-17](obs-ws.js#L11-L17)) — é a
  implementação do handshake oficial obs-websocket 5.x.
- **`obs.js`** — classe `OBS` que envolve o WebSocket já conectado com um
  request/response por correlação de ID (`op:6` = Request,
  [obs.js:17](obs.js#L17)), timeout de 5s por request default
  ([obs.js:2](obs.js#L2)), rejeita a Promise pendente em erro
  (`requestStatus.result === false`, [obs.js:36-39](obs.js#L36-L39)).
  Métodos de alto nível: `getState()` (paraleliza
  `GetSceneList`+`GetRecordStatus`+`GetStreamStatus` via
  `Promise.all`, [obs.js:45-49](obs.js#L45-L49)), `switchScene`,
  `toggleRecord`, `toggleStream`, `stopAll` (best-effort, engole erros
  individuais, [obs.js:72-83](obs.js#L72-L83)).
- **Falha graceful**: se `obs` é `null` (OBS não configurado via env vars
  `OBS_WS_PASSWORD`/`OBS_WS_HOST`/`OBS_WS_PORT`, [server.js:920-924](server.js#L920-L924)),
  toda rota `/api/obs/*` devolve `{ok:true/false, connected:false}` sem
  exceção — nunca derruba o servidor nem bloqueia startup (é `await`ado
  mas com timeout curto e fallback `null`).
- Nenhuma mudança necessária no port Windows — este módulo já é 100%
  portável, sem chamadas de sistema operacional.

---

## 7. Error handling — padrão geral

- **HTTP**: toda promise chain termina em `.catch(err => fail(res, err))`;
  `fail()` sempre 500 + mensagem genérica, log real vai só pro `console.error`
  do processo servidor ([server.js:133-137](server.js#L133-L137)).
- **Corpo inválido**: sentinels `BODY_TOO_BIG`/`BODY_INVALID` — repetido em
  cada rota manualmente (não há middleware de validação central); rota que
  esquecer de checar teria bug potencial, mas a inspeção mostra que todas
  checam.
- **Falha de plataforma não derruba o processo**: `listAppProcesses` engole
  toda exceção de `lsappinfo` e devolve `[]` ([apps.js:118-120](apps.js#L118-120));
  `activateApp`/`focusApp` fazem fallback ou propagam para virar 500 (nunca
  process-level throw); `server.on("error", ...)` e `wss.on("error", ...)`
  registrados após o startup para nunca deixar um erro de socket matar o
  processo Node ([server.js:999-1000](server.js#L999-L1000), comentário
  explica que sem isso "um erro encaminhado pelo ws pode terminar o
  processo").
- **Falha de ícone**: cadeia inteira de fallback (helper→findIcon→monograma)
  garante que `getIconPng` nunca lança — na pior hipótese devolve `null`
  (rota devolve 404, [server.js:837-840](server.js#L837-L840)), nunca 500.
  Isso já satisfaz RF-04 do PRD ("quando falhar, mostrar fallback
  consistente") — o padrão de resiliência está certo, só a implementação
  do último fallback (`monogramPng` via `sips`) é macOS-only.
- **Erro de rede/socket na inicialização**: `startServer()` registra
  `server.once("error")`/`wss.once("error")` **antes** do `listen()`
  especificamente para capturar porta ocupada (`EADDRINUSE`) e rejeitar a
  Promise de startup de forma limpa
  ([server.js:1034-1058](server.js#L1034-L1058)) — mapeia diretamente para
  RF-11 do PRD ("porta ocupada" precisa virar mensagem, não crash).

---

## 8. Concorrência e caching — visão consolidada

| Cache | TTL/Cap | Local | Propósito |
|---|---|---|---|
| `installedCache` | 120s (`INSTALLED_APPS_TTL_MS`) | `apps.js:66` | evita re-scan de disco a cada request |
| `runningCache` | 1500ms (`RUNNING_TTL_MS`) | `apps.js:68` | evita fork de `lsappinfo` por poll |
| `memPng` (ícones) | LRU cap 40 (`MEM_PNG_MAX`) | `apps.js:577` | ícones quentes em RAM |
| ícones em disco | cap 256 arquivos, poda por mtime (`DISK_PNG_MAX`) | `.icon-cache/` | evita disco ilimitado |
| `versionCache` | 10min, stale-while-revalidate | `server.js:82` | não bloqueia request por fetch do GitHub |
| `appearanceInflight` | 1000ms | `apps.js:581` | evita `defaults read -g` repetido |
| sessões WS | Set `clients`, sem cap | `server.js:234` | 1 timer compartilhado por broadcast, não por cliente |

Padrão de dedupe de in-flight requests repetido 3x (`scanInflight`,
`runningCache.promise`, `loadInflight` map de ícones) — todos seguem o
mesmo idioma: se já há uma Promise em voo para a mesma chave, devolve ela
em vez de disparar um scan/fork/load duplicado. É um padrão consistente e
correto, mas não está extraído em um helper genérico (`memoizeInflight`) —
está duplicado manualmente 3 vezes com pequenas variações de cache-key.

`withConfigLock` ([server.js:317-321](server.js#L317-L321)) serializa
apenas dentro do processo (fila de Promises); não é um file lock real —
seguro para 1 processo Node por instância, o que é a premissa atual (1
Mac, 1 processo). Um host Windows com tray+server como processos separados
teria que revisitar essa suposição se o server for reiniciado /
supervisionado externamente (não é o caso do plano atual — o `windows/src/
server-process.js` do plano trataria o Node embutido como filho único do
Electron, então a premissa provavelmente se mantém).

---

## 9. Onde o adaptador de plataforma precisa entrar

Resumo do seam, cruzando com o plano de implementação (Task 1-3):

1. **`appTools` em `makeApp()`** ([server.js:295](server.js#L295)) já é o
   ponto de injeção correto para `listInstalledApps`/`listAppProcesses` —
   troca de import direto de `apps.js` para um provider escolhido por
   `process.platform` resolve RF-03/RF-06 sem tocar rotas.
2. **`actions` em `makeApp()`** ([server.js:296](server.js#L296)) idem para
   `activateApp`/`openWebsite` — mesmo padrão.
3. **`iconService`** ([server.js:298](server.js#L298), default
   `realIconService()`) — já injetável, e `realIconService(deps)` já
   suporta trocar `scan`/`findIcon`/`iconHelper`/`exec` internamente
   ([apps.js:559-573](apps.js#L559-573)); falta um `realIconService`
   equivalente (ou os mesmos `deps`) alimentado por primitivas Windows.
4. **Nenhuma rota HTTP/WS precisa mudar** — o contrato de shape
   (`{name,path,icon}` para apps instalados; `{name,pid,type}` para
   processos rodando; PNG binário para ícone) já é abstrato o bastante
   para qualquer plataforma, exatamente como a seção 11 do PRD pede
   ("o protocolo do Dokke permanece compartilhado").
5. **Único ponto sem injeção hoje**: o default de `iconHelper` em
   `realIconService` decide macOS vs. nenhum baseado em
   `process.platform === "darwin"` ([apps.js:571](apps.js#L571)) — não há
   ramo `win32`. Isso precisa de uma nova branch (ou de mover essa decisão
   para fora de `apps.js`, para um módulo `platform/index.js` que resolve
   `{listInstalledApps, listAppProcesses, activateApp, openWebsite,
   iconService}` por SO, exatamente como o plano descreve em
   `platform/platform-contract.js` + `platform/windows/apps.js` +
   `platform/windows/actions.js`).
6. **Gap não coberto pelo plano**: `readMacIconAppearance()`
   (dark/light mode do ícone) não tem contrato formal — está embutido
   como parâmetro opcional `appearanceToken` em `realIconService`, então
   tecnicamente já é substituível, mas o plano de implementação não lista
   uma task explícita para o equivalente Windows (teria que ler o registro
   `HKCU\...\Personalize`).

---

## 10. Visual contract checklist

Não aplicável — este surface (CORE-SERVER) não tem UI própria. A UI (dock,
sidebar Apps/Conectar, grid 4×2, app picker, tela Conectar) vive em
`public/index.html` (3113 linhas, fora do escopo desta análise) e é servida
estaticamente pelo bloco final de `handler()`
([server.js:888-907](server.js#L888-L907)). O contrato visual da seção 7 do
PRD não é implementado/validado por nenhum dos 5 arquivos analisados aqui;
o único artefato relacionado é o comentário em `uiVersion()`
([server.js:217-226](server.js#L217-L226)) que versiona `index.html` por
mtime+size para forçar reload automático do client quando o servidor sobe
uma UI nova.
