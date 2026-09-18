# ADR 0001: Ponte Node -> `IShellItemImageFactory` para ícones 256px no Windows

**Status:** Aceita
**Data:** 2026-09-18 (revisada 2026-09-17, round 2 de review; revisada novamente round 3 — ver
"Revisão round 2" e "Revisão round 3" abaixo)
**Requisito:** PROOF-01 (`.maxvision/REQUIREMENTS.md`, Fase 0)
**Máquina de medição:** Windows 11 Pro 10.0.22631, x64, Node v25.5.0, VS Build Tools 2022
(17.14.37411.7) com componente C++ x64, Windows SDK 10.0.26100.0, Python 3.13.13, locale pt-BR

> **Nota sobre esta revisão:** um round de review rigoroso rejeitou a primeira versão deste
> ADR — a "verificação independente" era auto-referencial (comparava a saída do encoder contra
> a própria constante que o harness passou pro encoder, certificando qualquer coisa, inclusive
> ruído), o pool PowerShell travava silenciosamente sem reportar falha, o addon vencedor
> rejeitava paths que o fallback koffi aceitava, argumentos de CLI inválidos viravam
> `results.json` cheio de `null`, o erro de `CoInitializeEx` perdia o HRESULT, 8 atalhos
> desapareciam do conjunto sem registro, e a composição do conjunto de apps incluía
> `.msc`/`.url`/`.html`/etc. embora o texto dissesse "resolvidos ao alvo `.exe`". Todos os sete
> achados foram corrigidos com evidência re-executada nesta máquina; a seção "Revisão round 2"
> ao final detalha cada um.
>
> **Um segundo round rejeitou a v2** — o script `verify.mjs` escrito especificamente pra fechar
> o blocker do round 2 tinha o MESMO defeito que corrigiu: reportava "PASSED" mesmo quando uma
> ponte não produzia saída decodificável pra alguns apps; `list-apps.mjs` corrompia todo path de
> `.lnk` não-ASCII no hop Node→PowerShell (bug de locale — só aparece em pt-BR/não-en-US) e
> perdia 4 apps reais silenciosamente, com uma causa **inventada e nunca observada** registrada
> no lugar da causa real; a tabela de resultados reportava mediana com 2 casas decimais de uma
> ÚNICA execução, quando a dispersão entre execuções é maior que a diferença entre as duas
> candidatas finalistas; e 5 das 8 linhas da tabela de contrato de path, mais as 4 reproduções
> de falha do pool PowerShell, existiam só num script ad hoc gitignored, irreproduzível por
> quem clona o repo. A seção "Revisão round 3" ao final detalha os seis achados e a correção de
> cada um, com comando+saída real.
>
> **Os números na tabela de "Resultados medidos" abaixo já são da re-execução pós-round-3**
> (115 apps `.exe`-only — o conjunto mudou de 111→115 porque a correção de encoding do round 3
> recuperou 4 atalhos `.lnk` não-ASCII que a v2 perdia silenciosamente; N=230 amostras/candidata
> por execução, **5 execuções independentes** — ver "Resultados medidos" pra metodologia e
> range observado).

---

## Contexto

`.maxvision/research/WINDOWS-STACK.md` já mediu, nesta máquina, que
`IShellItemImageFactory::GetImage` a 256×256 é o único caminho que atende o contrato visual
(dock Mac desenha a 68pt / ~136px em Retina; `app.getFileIcon()` do Electron satura em 48×48
para `.exe` e 32×32 para `.lnk`). Essa medição ficou registrada como **20/20 sucesso, 43,2
ms/ícone, ~23 KB PNG**, via COM chamado de dentro do Windows PowerShell 5.1.

O que faltava — e é o objeto deste ADR — é **qual ponte, a partir do processo Node/Electron do
DeckTech, chama essa mesma API COM**. `PLAT-03` (Fase 3) precisa disso resolvido para existir: o
adaptador de plataforma inteiro roda em Node (`apps.js:559-573`), então a ponte escolhida aqui é
o que `realIconService` chamará em produção.

Três candidatas foram identificadas no requisito: um addon nativo N-API, `koffi` (FFI pura em
JS) e um pool de processos PowerShell persistentes.

## Método

Script principal: [`measure/windows/icon-bench/scripts/bench.mjs`](../../measure/windows/icon-bench/scripts/bench.mjs).
Resultado bruto completo: [`measure/windows/icon-bench/results.json`](../../measure/windows/icon-bench/results.json).

- **Conjunto de apps real:** enumeração de `.lnk` em
  `%ProgramData%\Microsoft\Windows\Start Menu\Programs` +
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs` via
  [`scripts/list-apps.mjs`](../../measure/windows/icon-bench/scripts/list-apps.mjs) (resolução
  delegada a [`lib/lnk-resolve.mjs`](../../measure/windows/icon-bench/lib/lnk-resolve.mjs) desde
  o round 3 — ver "Revisão round 3" finding 2): **182 atalhos** enumerados → **178 resolvidos**
  a um `TargetPath` não-vazio via um único processo PowerShell reaproveitando um `WScript.Shell`
  COM → **4 não-resolvidos** (`TargetPath` veio vazio; registrados COM motivo em
  `apps.json.unresolvedLnks`) → dos 178 resolvidos, **38 excluídos** por dedup de target
  normalizado / padrão de desinstalador / arquivo ausente em disco (registrados em
  `apps.json.excludedResolvedTargets`) → **140 resolvidos e únicos, todas as extensões**.
  **Composição real por extensão** (round 2 finding 7 — o texto da v1 deste ADR dizia
  "resolvidos ao alvo `.exe`", o que era falso pra 25 dos 136 resolvidos daquela rodada; a
  contagem atual, pós-round-3, é 25 dos 140 — mesma proporção, número absoluto maior porque o
  conjunto cresceu): `exe: 115, msc: 9, url: 6, html: 3,
  htm: 3, txt: 2, chm: 1, pdf: 1` (soma 140, batendo com `resolvedAllExtensionsCount`). `.msc`/`.url`/`.html` etc. roteiam por provedores de
  thumbnail, não pelo caminho de ícone de app que `PLAT-03` chama — então o conjunto
  **benchmarcado é filtrado a `.exe`-only: 115 apps**, e a composição completa (incluindo os 25
  excluídos, com nome e extensão de cada um) fica auditável em
  `apps.json.extensionHistogramAllResolved` / `apps.json.excludedNonExeTargets`. Persistido em
  [`data/apps.json`](../../measure/windows/icon-bench/data/apps.json), com a fonte gravada no
  próprio arquivo. Pelo menos um path benchmarcado contém espaço
  (`C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe`) — verificado em código, o script
  recusa rodar sem isso (regra de path do Windows, item 5 das regras não-negociáveis).
  **Os 4 não-resolvidos, causa medida individualmente (não uma frase genérica aplicada aos
  quatro — ver round 3 finding 2), via `Shell.Application`/`GetLink` e leitura dos bytes brutos
  do `.lnk` em UTF-16:**
  | `.lnk` | `TargetPath` (WScript.Shell) | `Target.Path` (Shell.Application) | causa medida |
  |---|---|---|---|
  | `Visit MobaXterm Website.lnk` | vazio | vazio | aponta pra uma URL real (`https://mobaxterm.mobatek.net/`, confirmado lendo os bytes do `.lnk` como UTF-16) — não tem `TargetPath` de arquivo por não ser um `.lnk` de arquivo |
  | `File Explorer.lnk` | vazio | `::{52205FD8-5DFB-447D-801A-D0B52F2E83E1}` | aponta pra uma pasta virtual do shell (CLSID do File Explorer/"Este Computador"), não um arquivo |
  | `Control Panel.lnk` | vazio | `::{5399E694-6CE5-4D6C-8FCE-1D8870FDCBA0}` | aponta pra uma pasta virtual do shell (CLSID do Painel de Controle), não um arquivo |
  | `Run.lnk` | vazio | `::{2559A1F3-21D7-11D4-BDAF-00C04F60B9F0}` | aponta pra um comando virtual do shell (CLSID do diálogo Executar), não um arquivo |

  Todos os quatro são targets genuinamente sem arquivo — não é um bug de resolução, é o que o
  `.lnk` de fato contém (`HasLinkTargetIDList=true` nas 4 flags, confirmado lendo os bytes). Isso
  substitui a frase da v2 deste ADR ("atalho aponta pra uma URL ou pasta virtual do shell, ex.
  'Firefox Navegação Privada.lnk'") — essa frase era uma causa **inventada, nunca observada**, e
  demonstravelmente falsa para o exemplo que ela mesma citava: "Firefox Navegação Privada.lnk"
  resolvia normalmente (`C:\Program Files\Mozilla Firefox\private_browsing.exe`) e só aparecia
  como não-resolvido por causa do bug de encoding do round 3 finding 2, não por apontar pra uma
  URL. Ver "Revisão round 3" finding 2 para o comando que reproduziu isso.
- **Controle:** candidata `control` roda o mesmo loop, mesmo encode de PNG, mesma escrita em
  disco — mas com um buffer RGBA fixo, sem chamar a API real. Isola o custo do harness em si.
- **Custo de startup separado do custo por ícone:**
  - addon N-API: carga do módulo `.node` medida uma vez (tipicamente 2–3 ms), separada do custo
    em regime.
  - koffi: custo de primeira chamada (carga de DLL + `CoInitializeEx` + 1ª extração) medido uma
    vez (tipicamente 7–13 ms), separado do regime.
  - pool PowerShell: **spawn dos processos + compilação `Add-Type` do C# de interop COM**,
    medido até TODOS os workers sinalizarem prontos — 400–700 ms para um pool de 4, variando
    por execução (ver "Resultados medidos" — este custo também tem dispersão entre
    invocações, igual ao custo por ícone). Este número **não** é diluído nas amostras por
    ícone.
- **Cache de ícone do shell do Windows é por arquivo, não por ponte.** As três candidatas
  chamam a mesma API COM sobre os mesmos arquivos; se cada candidata rodasse sua própria
  passada "fria" sobre os 115 apps em sequência, a primeira pagaria o custo real de cache miss
  e todas as seguintes pareceriam artificialmente mais rápidas só por herdar o cache do thumbcache
  já aquecido pela candidata anterior — um viés de ordem, não uma diferença de ponte. Correção:
  o custo frio é pago **uma única vez**, com uma ponte arbitrária (o addon), **antes** do loop de
  candidatas. As candidatas então são comparadas com o cache já aquecido para todos, isolando o
  que de fato diferencia uma ponte da outra: overhead de marshalling/IPC, não sorte de cache.
- **Repetições:** 1 passada de aquecimento por candidata (descartada, aquece JIT/V8 do laço) +
  2 passadas medidas de 115 apps = **N=230 amostras por candidata, por execução**. Mediana e
  p95 reportados, não só a média. **Round 3 finding 4:** N=230 limita a dispersão DENTRO de uma
  execução, não ENTRE execuções — ver "Resultados medidos" abaixo para a correção que repete a
  invocação inteira 5 vezes e reporta o range observado, não só um ponto de duas casas decimais.
- **Argumentos de CLI validados (round 2 finding 4):** `scripts/bench.mjs` valida cada
  `--limit`/`--passes`/`--pool` (inteiro finito, com o limite mínimo declarado) e sai com código
  não-zero nomeando a flag e o valor ofensivo em vez de deixar `Number("abc")` virar `NaN` e
  produzir um `results.json` com `medianMs: null` sem erro nenhum. O script também recusa
  escrever `results.json` se qualquer candidata tiver `n === 0` amostras. Reproduzido: `node
  scripts/bench.mjs --limit 3 --passes abc --pool 2` agora sai com `[bench] FATAL: --passes
  must be a finite integer, got "abc"` e código 1, sem tocar `results.json`.
- **Verificação independente — o que é checado, em quantas amostras, e o que NÃO pega (round 2
  finding 1, blocker):** a versão anterior deste ADR descrevia uma checagem que comparava a
  dimensão decodificada do PNG contra `ICON_SIZE` — a MESMA constante que o próprio harness
  passou pro `encodePng()` algumas linhas antes, no mesmo arquivo que a checagem lia. Isso
  compara uma entrada contra ela mesma: não pode falhar, e de fato não falhava — um review
  provou isso rodando a checagem idêntica sobre um buffer de ruído puro (`resultado: 256x256,
  checagem: true`) e sobre uma execução real que mediu zero amostras (`n=0` em toda candidata,
  checagem ainda imprimindo `true` para as quatro). Essa checagem foi **removida**, não
  remendada. A checagem atual vive em
  [`scripts/verify.mjs`](../../measure/windows/icon-bench/scripts/verify.mjs), rodada como uma
  passada separada e independente depois do benchmark (`node scripts/verify.mjs`), e faz três
  coisas, sobre as **115 apps benchmarcadas, não uma amostra:**

  **Round 3 finding 1 (blocker):** o próprio `verify.mjs` tinha o mesmo defeito que foi escrito
  pra corrigir — um app cuja ponte não produzisse saída decodificável (`errorCount`) era
  descartado do denominador (nem `agreeCount` nem `disagreeCount`) em vez de FALHAR a
  verificação, e a linha final imprimia `apps.length` (o total nominal) em vez de `agreeCount`
  (o total realmente verificado) — reportando "PASSED" mais forte do que o que foi medido.
  Corrigido: o gate de saída agora é `disagreeCount > 0 || errorCount > 0`, mais uma checagem
  nova de `results.length !== apps.length` (uma linha FALTANDO inteira, ainda mais silenciosa
  que um erro de decode), mais os dois controles negativos agora derivados do resultado medido
  em vez de hardcoded `true`. Reproduzido apagando dois PNGs de cache de propósito:

  ```
  $ rm .tmp/cache/koffi/5.png .tmp/cache/pwsh/7.png && node scripts/verify.mjs; echo EXIT=$?
  [verify] app#5 (Adobe Media Encoder 2026) DECODE ERROR: koffi decode failed: ...\5.png
  [verify] app#7 (Adobe Premiere Pro 2026) DECODE ERROR: pwsh decode failed: ...\7.png
  [verify] cross-bridge pixel agreement (max per-channel delta <= 2): 113/115 apps agree across all bridges (2 decode error(s), 0 disagreement(s) beyond threshold)
  [verify] FATAL: 2 app(s) had a bridge that produced NO decodable output — see the DECODE ERROR lines above and errorCount in verify-results.json
  EXIT=1
  ```
  (restaurados os dois PNGs depois, re-verificado 115/115 limpo, exit 0 — ver "Revisão round 3"
  finding 1 pra saída completa dos dois casos.)

  1. Decodifica os PNGs de addon/koffi/pwsh para cada uma das 115 apps com o decodificador do
     .NET (`System.Drawing.Bitmap`, via
     [`pwsh/verify.ps1`](../../measure/windows/icon-bench/pwsh/verify.ps1)) — um caminho de
     código que NENHUM dos três bridges usa pra ESCREVER o PNG — e compara os bytes BGRA
     decodificados addon-vs-koffi e addon-vs-pwsh, byte a byte. **Resultado real, medido, não
     estimado:** 115/115 apps concordam (`agreeCount: 115`, `errorCount: 0`), e o delta MÁXIMO
     GLOBAL observado — addon vs koffi E addon vs pwsh, nas 115 apps, não uma amostra — é **0**
     (`verify-results.json -> globalMaxDeltaObserved: 0`,
     `perBridgeMaxDeltaObserved: {"koffi":0,"pwsh":0}`). Os três bridges produzem pixels
     **byte-idênticos** em todo o conjunto benchmarcado, inclusive pwsh apesar de usar o
     encoder PNG do próprio .NET — a tolerância de `AGREEMENT_MAX_DELTA = 2` configurada em
     `verify.mjs` existe como margem de segurança e nunca foi de fato exercitada nesta
     execução.
  2. Duas checagens **diagnósticas, que NÃO decidem pass/fail** (só `disagreeCount`/`errorCount`
     decidem isso — ver `verify-results.json.sanityChecksAreDiagnosticOnly`): variância do
     canal alfa (pega um bitmap uniforme/em branco) e fração de preenchimento do bounding-box de
     conteúdo (pega um blob minúsculo num canto em vez de um ícone real). Resultado: 0/115 apps
     com bbox quase vazio; 7/115 com variância de alfa baixa, todos com `bboxFillFraction: 1`
     (preenchem o frame inteiro) — nomeados em `verify-results.json.lowAlphaVarianceApps`:
     Antigravity IDE, MSYS2 CLANG64/CLANGARM64/MINGW64/MSYS/UCRT64, NVIDIA App (mesmos 7 apps do
     round 2, índices deslocados pelo conjunto de 115 apps: agora 10/55/56/57/58/59/64).
     **Reinspecionei visualmente 3 desses 7 nesta execução** (Antigravity IDE índice 10, MSYS2
     CLANG64 índice 55, NVIDIA App índice 64, lendo os PNGs em
     `.tmp/cache/addon/{10,55,64}.png` diretamente) — são de fato ícones com fundo sólido opaco
     preenchendo o quadro inteiro (alfa=255 uniforme é o comportamento correto pra esse tipo de
     ícone, não um sinal de falha); não inspecionei os outros 4 (MSYS2 CLANGARM64/MINGW64/MSYS/
     UCRT64) individualmente, mas têm o mesmo `bboxFillFraction: 1` e mesma família de app
     (variantes do mesmo instalador MSYS2), então a mesma explicação é a mais provável — não
     confirmada visualmente para esses 4 especificamente, dito aqui para não misturar "inspecionei"
     com "inferi por semelhança".
  3. **Dois controles negativos adversariais, rodados e impressos toda vez que o script roda,**
     provando que a checagem em (1) PODE falhar: (a) compara os ícones de dois apps DIFERENTES
     entre si — resultado real: `Administrative Tools vs Adobe Acrobat: maxAbsDelta=255 ->
     agreement: false`; (b) gera um buffer de ruído puro, salva como PNG, e compara contra a
     referência REAL de um app — resultado real: `noise vs real Administrative Tools:
     maxAbsDelta=255 -> agreement: false`. Essa é a reprodução literal do achado do review: o
     mesmo buffer de ruído que a checagem antiga certificava como `true` agora é corretamente
     rejeitado. Se qualquer controle negativo concordasse por engano, o script sai com código
     não-zero e se recusa a reportar "verificado".
  - **O que essa checagem NÃO pega, dito explicitamente:** se `IShellItemImageFactory` em si
    devolver o MESMO ícone genérico/de fallback pra todo app (ex.: o ícone padrão de `.exe` do
    Windows, porque o recurso de ícone real falhou ao carregar), as três pontes chamam a mesma
    API Win32 e concordariam entre si sobre esse ícone genérico — concordância entre pontes
    prova que as PONTES são equivalentes, não que o ícone é o CORRETO pra aquele app
    específico. Essa garantia vem só da inspeção visual manual de um subconjunto nomeado
    (Notepad, Acrobat, Illustrator, Blender, um ícone de sistema — inalterada desde a v1 deste
    ADR), não do `verify.mjs`.
- **Contrato de path — quem normaliza o quê, testado, não assumido (round 2 finding 3):** o
  addon rejeitava um path com barra normal (`SHCreateItemFromParsingName` retornava
  `E_INVALIDARG`, hr=`0x80070057`) enquanto koffi aceitava o mesmo path via
  `path.resolve()` — as duas candidatas "idênticas" faziam trabalho desigual, e o benchmark
  nunca expôs isso porque `list-apps.mjs` já emite paths absolutos com barra invertida.
  Corrigido chamando a MESMA API Win32 (`GetFullPathNameW`) dos dois lados: dentro do addon em
  C++ ([`addon-icon/icon_addon.cc`](../../measure/windows/icon-bench/addon-icon/icon_addon.cc))
  e via koffi no lado JS
  ([`lib/win32-path.mjs`](../../measure/windows/icon-bench/lib/win32-path.mjs)) — não uma
  reimplementação em JS que *deveria* ter o mesmo comportamento, a mesma chamada de sistema
  literal dos dois lados. **Round 3 finding 6:** as 5 linhas abaixo marcadas com † viviam só
  num script ad hoc sob `.tmp/` (gitignored, irreproduzível por quem clona o repo) — agora
  todas as 8 formas rodam, comitadas, contra os DOIS bridges in-process (não só addon — a
  origem do finding 3 do round 2 era exatamente os dois fazendo trabalho desigual), via
  [`scripts/verify-path-contract.mjs`](../../measure/windows/icon-bench/scripts/verify-path-contract.mjs),
  sobre um app real com espaço no path (`Adobe Acrobat`,
  `C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe`) — não `notepad.exe` sintético.
  **Saída real desta execução, addon E koffi, sem divergência entre os dois em nenhuma das 8
  formas:**

  | Forma | Resultado real (addon = koffi) | O que confirma |
  |---|---|---|
  | canônico (barra invertida, absoluto) | sucesso | baseline |
  | barra normal (`C:/Program Files/...`) | sucesso, pixel-idêntico ao canônico | `/` → `\` |
  | relativo (`..\..\...`) | sucesso, pixel-idêntico ao canônico | resolvido contra o CWD |
  | espaço à direita (`Acrobat.exe `) † | sucesso, pixel-idêntico ao canônico | espaço final removido |
  | ponto à direita (`Acrobat.exe.`) † | sucesso, pixel-idêntico ao canônico | ponto final removido |
  | `%ProgramFiles%\...` † | **falha**, hr=`0x80070002` (arquivo não encontrado) | `%VAR%` **NÃO** é expandido — tratado como texto literal |
  | `"C:\Program Files\...\Acrobat.exe"` (com aspas) † | **falha**, hr=`0x80070057` (argumento inválido) | aspas **NÃO** são removidas |
  | `Acrobat.exe,0` (sufixo de índice de registro) † | **falha**, hr=`0x80070002` (arquivo não encontrado) | sufixo `,<índice>` **NÃO** é removido |

  As três últimas linhas falham DE PROPÓSITO — confirmam o que o contrato NÃO cobre, não um bug:
  quem chamar `realIconService` com um valor `DisplayIcon` de registro precisa expandir
  `%VAR%` (`ExpandEnvironmentStringsW`), remover aspas e cortar o sufixo `,<índice>` **antes**
  de passar o path pro addon — esse pré-processamento não existe ainda porque `PLAT-03` (o
  consumidor) é uma fase futura; fica registrado como requisito explícito da interface, não como
  suposição. Saída real desta execução (todas as 8 formas, addon E koffi):
  ```
  addon / forward-slash: extraction OK, pixel-identical to canonical: true
  addon / relative: extraction OK, pixel-identical to canonical: true
  addon / trailing space: extraction OK, pixel-identical to canonical: true
  addon / trailing dot: extraction OK, pixel-identical to canonical: true
  addon / %VAR% (env var, must fail — not expanded): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002
  addon / surrounding quotes (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070057
  addon / ,0 icon-index suffix (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002
  koffi / forward-slash: extraction OK, pixel-identical to canonical: true
  koffi / relative: extraction OK, pixel-identical to canonical: true
  koffi / trailing space: extraction OK, pixel-identical to canonical: true
  koffi / trailing dot: extraction OK, pixel-identical to canonical: true
  koffi / %VAR% (env var, must fail — not expanded): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002 for ...
  koffi / surrounding quotes (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070057 for ...
  koffi / ,0 icon-index suffix (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002 for ...
  [verify-path-contract] === addon vs koffi outcome per form ===
    (all 7 forms: addon=koffi, 0 divergences)
  ```
  O worker PowerShell (.NET `SHCreateItemFromParsingName` via P/Invoke direto, não via
  `WScript.Shell`) foi testado à parte com o mesmo path de barra normal e **também falhou**
  (`SHCreateItemFromParsingName hr=0x80070057`) até receber a forma com barra invertida — ou
  seja, o comportamento de não-normalizar é o PADRÃO do próprio Win32 P/Invoke .NET, não um bug
  específico do addon; `pwsh` não precisou de correção porque não é a ponte escolhida e o
  requisito do path-contract não se aplica a ele (`PLAT-03` não vai chamar pwsh).
- **Auditoria de todo hop Node→PowerShell por encoding (round 3, findings 2/3) — cada um
  testado nesta máquina, não assumido:**
  | Hop | `-Encoding` no `Get-Content`/leitura? | Status |
  |---|---|---|
  | `list-apps.mjs` → PS (`lnk-input.json`, entrada) | `-Encoding UTF8` (round 3 fix) | corrigido — ver "Revisão round 3" finding 2 |
  | PS → `list-apps.mjs` (`lnk-resolved.json`, saída) | `Out-File -Encoding utf8` + strip de BOM no lado Node (`lib/lnk-resolve.mjs`) | já estava OK (não precisou de fix) |
  | `verify.mjs` → `verify.ps1` (entrada) | `-Encoding UTF8` (round 3 fix) | corrigido — ver "Revisão round 3" finding 3 |
  | `verify.ps1` → `verify.mjs` (saída) | `Out-File -Encoding utf8` + strip de BOM no lado Node | já estava OK (não precisou de fix) |
  | `worker.ps1` stdin (protocolo JSON-por-linha do pool pwsh) | **não usa `Get-Content`** — lê via `[Console]::In.ReadLine()`, decodificado por `[Console]::InputEncoding` | **medido, não corrigido:** `[Console]::InputEncoding` no PS 5.1 desta máquina é `ibm850` (codepage OEM 850), não UTF-8. Enviei uma request real pro pool com um path contendo caractere não-ASCII (`...\Ícone Não-ASCII\notepad.exe`) e o worker respondeu `{"ok":false,"error":"...SHCreateItemFromParsingName hr=0x80070057..."}` — falha, path corrompido no hop. Não corrigido porque `pwsh` é a candidata **rejeitada** (ver "Decisão"); registrado aqui como fato medido, não deixado pro próximo reviewer achar. |
  **e** uma checagem barata em processo (`looksBlank`, amostra ~200 pixels e compara contra o
  primeiro) não achou um bitmap uniforme. Isso pega crash, HRESULT de erro e retorno em branco —
  **não** pega uma imagem não uniforme porém errada (ex.: ícone genérico do Windows em vez do
  ícone real do app). A garantia de correção pixel a pixel vem da verificação independente
  pós-benchmark (`scripts/verify.mjs`, sobre as 115 apps — ver bullet "Verificação independente"
  acima) e da inspeção visual manual, não da taxa de 100%.
- **Assimetria de encoder entre pwsh e as outras duas, registrada, não escondida:** addon e
  koffi compartilham o mesmo caminho JS (`bgraToRgba` + `lib/png.mjs`) depois de extrair os
  pixels — o mesmo ícone produz o mesmo PNG byte a byte nos dois. O worker PowerShell usa o
  encoder de PNG do próprio .NET (`Bitmap.Save(..., ImageFormat.Png)`) e escreve o arquivo
  dentro do processo PowerShell, não no Node. Isso significa que o número do pwsh inclui um
  encoder diferente, e os números de addon/koffi incluem uma transformação BGRA→RGBA em JS que o
  pwsh não paga do lado Node. A candidata `control` (mediana de 1,4 a 1,9 ms entre execuções —
  ver "Resultados medidos") limita o tamanho desse efeito: é o teto do que "laço + encode +
  escrita em disco" custa nesta máquina, bem abaixo da diferença de dois dígitos de ms entre
  addon e pwsh — a assimetria de encoder não é grande o suficiente para explicar a diferença
  observada entre candidatas. `scripts/verify.mjs` confirma isso diretamente e mais fortemente
  do que eu esperava: o delta de pixel decodificado addon-vs-pwsh é **0** (byte-idêntico) em
  todas as 115 apps, não uma diferença pequena mas não-zero (ver "Verificação independente"
  acima e `globalMaxDeltaObserved` em `verify-results.json`) — a assimetria de encoder existe no
  código (caminhos diferentes) mas não produz nenhuma diferença de pixel mensurável nesta
  máquina.

## Achados de implementação (não só números)

Dois bugs reais apareceram construindo as pontes — registrados porque mudam o risco de
manutenção de cada opção, não só o benchmark:

1. **koffi: `koffi.decode(ptr, type, offset)` não existe** — a assinatura real é
   `koffi.decode(ptr, [offset], type, [length])`. Passar o offset na posição de `type` não
   lança erro: silenciosamente decodifica um **array de N elementos** (`N` = o offset em bytes
   que eu queria, interpretado como contagem). Isso produziu um array de 24 `BigInt` em vez de
   um ponteiro único, e o erro resultante (`Unexpected Array value for reference, expected
   pointer`) apareceu **duas chamadas depois**, longe da causa real.
2. **koffi: `SIZE` passado como dois `int32` em vez de struct por valor causou SIGSEGV.** A
   convenção x64 do Windows empacota uma struct de 8 bytes (`SIZE { LONG cx, cy }`) num único
   slot de argumento; declarar `cx` e `cy` como dois parâmetros `int32` separados desalinha
   todo argumento seguinte. O processo Node inteiro travou (crash, não exceção JS).
3. **Pool PowerShell: `Image.FromHbitmap(hbm)` descarta o canal alfa.** É um problema documentado
   do .NET, não um erro de digitação — confirmado visualmente comparando o mesmo ícone (Adobe
   Acrobat) entre addon (cantos arredondados transparentes, corretos) e a primeira versão do
   worker PowerShell (cantos **pretos opacos**, quadrados). Corrigido replicando a mesma
   extração via `GetDIBits` + `Bitmap.LockBits` com `PixelFormat.Format32bppArgb` que addon e
   koffi já usavam — depois da correção, os três produzem pixels idênticos (addon e koffi batem
   byte a byte, mesmo PNG; pwsh usa o encoder do próprio .NET e bate visualmente).

Ambos os achados do koffi foram silenciosos — sem exceção no primeiro caso, crash sem contexto
no segundo — e só foram descobertos porque cada etapa foi verificada isoladamente com uma
prova de um único ícone antes de rodar 136. O do PowerShell só apareceu porque os PNGs de
cada candidata foram inspecionados visualmente lado a lado, não só comparados por hash/tamanho.

## Resultados medidos

**Round 3 finding 4 (major):** a v2 deste ADR reportava a mediana de cada candidata com duas
casas decimais a partir de **uma única invocação** de `bench.mjs`. N=230 (115 apps × 2 passadas)
limita a dispersão DENTRO daquela invocação — não diz nada sobre a dispersão ENTRE invocações
separadas, e o reviewer do round 3 mostrou, rodando o mesmo comando três vezes, que essa
dispersão entre invocações é **maior** que a diferença entre as duas finalistas (addon 9,89 →
14,60 → 12,04 ms nas três rodadas dele, um espalhamento de ~4,7ms contra um gap addon-vs-koffi
de 1,83ms numa rodada e 0,40ms noutra). O ponto de duas casas decimais implicava uma precisão
que o método não sustenta.

**Correção:** em vez de rodar `bench.mjs` uma vez e reportar seu output, ele é rodado **5 vezes
como invocações independentes** (processo Node novo a cada vez, não repetição dentro do mesmo
processo) via
[`scripts/bench-repeat.mjs`](../../measure/windows/icon-bench/scripts/bench-repeat.mjs)
(comitado, não um wrapper manual — ver "Reprodutibilidade"). Cada execução usa o conjunto
corrigido de 115 apps (round 3 finding 2), N=230 amostras/candidata por execução. A tabela
abaixo reporta a mediana de cada uma das 5 execuções, a mediana-das-medianas, e o range
min–max observado — **não** um único ponto de duas casas decimais:

| Candidata | medianas por execução (ms) | mediana-das-medianas | range min–max | spread |
|---|---|---:|---:|---:|
| controle (harness only) | 1,94 / 1,67 / 1,71 / 1,45 / 1,49 | 1,67 | 1,45–1,94 | 0,49 |
| **N-API addon** | 11,55 / 13,99 / 10,52 / 13,25 / 12,51 | **12,51** | 10,52–13,99 | 3,47 |
| **koffi (FFI)** | 11,04 / 17,11 / 14,45 / 14,95 / 13,90 | **14,45** | 11,04–17,11 | 6,07 |
| pool PowerShell (4 processos, latência/request) | 27,24 / 24,61 / 27,10 / 27,12 / 24,20 | 27,10 | 24,20–27,24 | 3,04 |

**O gap addon-vs-koffi na mediana-das-medianas é 1,94ms. O spread PRÓPRIO de uma única
candidata (koffi, 6,07ms) é maior que esse gap.** Isto é o output real de
`scripts/bench-repeat.mjs`:
```
[bench-repeat] addon-vs-koffi median-of-medians gap: 1.94ms. Largest single candidate's own
between-run spread (addon or koffi): 6.07ms. The between-run spread is >= the addon-vs-koffi
gap: the two candidates are NOT reliably distinguishable by ms/icon alone at this repeat count.
```
Isso não é uma observação nova desta rodada — a seção "Decisão" abaixo já argumentava, em
prosa, desde o round 2, que addon e koffi "empatam em velocidade e isso não decide"; o que o
round 3 corrige é que a TABELA antes implicava o oposto (dois números de duas casas decimais
lado a lado, como se a diferença entre eles fosse um sinal limpo e estável). Agora a tabela e a
prosa dizem a mesma coisa: **a decisão é sobre risco de manutenção, não sobre ms/ícone**, porque
ms/ícone não distingue as duas nesta máquina.

A última das 5 execuções (a que fica em `results.json`/`.tmp/cache` no momento deste texto) deu:
p95 addon 22,04ms / koffi 24,90ms / pwsh 42,07ms; média addon 13,28ms / koffi 15,29ms / pwsh
25,55ms; min–max addon 7,04–29,53ms / koffi 7,45–60,39ms / pwsh 10,52–53,25ms; startup do pool
(4 workers) 584,8ms; throughput agregado do pool a concorrência=4: 6,52 ms/ícone (varia por
execução também — ver range de startup nas 5 rodadas: 423–702ms). 100% de sucesso em todas as
quatro linhas, em todas as 5 execuções, 0 timeouts no pool PowerShell em qualquer uma delas.
Throughput agregado do pool PowerShell (tempo de parede da passada de 115 apps ÷ 115, média de
2 passadas) **não é comparável linha a linha** com a mediana de addon/koffi — reflete paralelismo
de 4 processos simultâneos, não custo por chamada síncrona. Ver "Decisão" sobre por que isso não
decide a escolha.

**Baseline frio, agnóstico de ponte** (medido uma única vez por execução, com o addon, antes de
qualquer candidata tocar os arquivos — ver "Método"): na última execução, N=115, mediana
**22,90 ms**, p95 **39,53 ms**, média 25,19 ms, 100% sucesso — na mesma faixa dos 43,2 ms/ícone
medidos anteriormente em `WINDOWS-STACK.md` §6.2, mas tipicamente abaixo. **Não investiguei a
causa exata da diferença** — candidatas honestas, nenhuma confirmada (hedge mantida idêntica às
versões anteriores deste ADR):
1. o conjunto de apps mudou (122 → 111 → 115 ao longo das rodadas) e o cache de thumbnail do
   Windows pode já estar mais quente hoje por uso normal da máquina;
2. **mais provável que a anterior:** a própria sessão de trabalho aqueceu o cache antes da
   medição "fria" valer esse nome — outras rodadas de benchmark, probes e testes de path
   contract já tinham tocado boa parte deste mesmo conjunto de apps antes desta medição. Isso
   significa que o "baseline frio" reportado aqui é um limite superior otimista do custo real de
   primeiro-scan do PLAT-03 (que roda numa sessão do DeckTech recém-aberta, sem esse aquecimento
   prévio), não uma medição de cache verdadeiramente frio. Registro isso como "não validei a
   causa", não como fato — e sinalizo que o número frio provavelmente subestima o pior caso real.

**Números vêm de execuções reais nesta máquina**, comandos exatos na seção "Reprodutibilidade"
abaixo. A rodada original do round 1 (136 apps de todas as extensões, N=272, sem a normalização
de path do finding 3, sem os fixes de timeout do finding 2) mediu addon em 10,82 ms e koffi em
12,07 ms medianos numa única invocação — consistente com a leitura de 5 invocações independentes
acima: addon e koffi ficam próximos entre si, a ordem entre eles não é estável de uma rodada pra
outra, e ambos claramente mais baratos que o pool PowerShell por chamada.

## Decisão

**N-API addon**, com `koffi` como caminho de fallback documentado se o toolchain nativo deixar
de estar disponível num ambiente de build futuro. **Pool PowerShell é rejeitado** como ponte de
produção.

### Por que addon e koffi empatam em velocidade e isso não decide

**Round 3 confirma isto com medição, não só com prosa** (ver "Resultados medidos", finding 4):
rodando `bench.mjs` 5 vezes como invocações independentes, a mediana-das-medianas foi 12,51 ms
(addon) vs 14,45 ms (koffi) — um gap de 1,94ms — enquanto o spread PRÓPRIO de uma única
candidata entre as 5 execuções chegou a 6,07ms (koffi). O spread entre execuções é maior que o
gap entre candidatas: **ms/ícone não distingue addon de koffi nesta máquina**, com qualquer
número de casas decimais. Isso é esperado: as duas chamam exatamente a mesma API COM
(`IShellItemImageFactory::GetImage`) e o grosso do tempo é gasto dentro do shell do Windows, não
na travessia FFI/N-API. O discriminador real não é ms/ícone — é risco de manutenção e forma de
falha, que os dois bugs abaixo tornam concreto, não hipotético:

- **N-API compila contra os headers reais do SDK.** O layout de vtable, o tamanho de struct e a
  convenção de chamada são verificados pelo compilador — um erro de offset ou de struct-por-valor
  vira **erro de compilação**, não um crash silencioso ou um array errado sem exceção. Os dois
  bugs desta investigação só existiram no lado koffi.
- **koffi é FFI pura: zero compilação, mas exige recriar manualmente o que o C++ recebe de
  graça** — a ordem exata da vtable (verificada aqui lendo `ShObjIdl_core.h` linha a linha,
  não de memória), a convenção `__stdcall`, o layout de struct por valor. Fiz esse trabalho e
  documentei cada decisão inline em
  [`lib/koffi-icon.mjs`](../../measure/windows/icon-bench/lib/koffi-icon.mjs), mas é exatamente
  o tipo de código que um refactor futuro, sem o mesmo cuidado, quebra em silêncio.
- **`PLAT-03` exige cancelamento sem processo órfão** (critério de sucesso 2 da Fase 3 do
  roadmap: "sair da página durante uma carga de 122 ícones cancela a fila sem deixar processo
  órfão no Gerenciador de Tarefas"). Uma chamada síncrona in-process (addon ou koffi) para de
  ser chamada — não há processo externo para matar. Um pool de PowerShell precisa de supervisão
  de ciclo de vida adicional (a Fase 5 já cobre isso para o `utilityProcess` do servidor; um
  segundo pool de processos duplicaria essa responsabilidade).

Escolhendo N-API sobre koffi pelo risco menor de falha silenciosa em manutenção futura, dado
que o toolchain nativo (VS Build Tools 2022 + componente C++ x64, Python) já está confirmado
presente nesta máquina de desenvolvimento e é um requisito padrão, bem documentado, para apps
Electron com addons nativos.

### Por que o pool PowerShell não vence mesmo com o menor número agregado

- **~530 ms de custo de startup fixo** — compilar C# via `Add-Type` é caro e não amortiza para
  uma extração pontual (ex.: usuário adiciona 1 app novo ao dock depois do scan inicial). Um
  addon ou koffi já têm o processo Node rodando; não pagam esse custo de novo.
- O throughput agregado de 6,98 ms/ícone vem de **paralelismo de 4 processos**, algo que
  addon/koffi não tiveram chance de exibir aqui — não foram testados sob paralelismo
  equivalente (ex.: `worker_threads`, múltiplos `utilityProcess`). Isso não foi medido; não
  reivindico que addon/koffi paralelos seriam mais rápidos ou mais lentos, só que a comparação
  atual não isola concorrência de eficiência de ponte, e por isso não decide a escolha.
- Superfície de falha adicional: gerenciar N processos PowerShell externos (crash de worker,
  saída inesperada, zumbis) é trabalho que SHELL-02 já precisa fazer para o servidor Node
  embutido — duplicá-lo para um pool de extração de ícone é escopo e risco extras sem ganho de
  ms/ícone comprovado.
- O bug do canal alfa (`Image.FromHbitmap`) mostra que a ergonomia mais alta do C#/.NET COM
  interop (`[ComImport]`, sem vtable manual) **não elimina** classes inteiras de bug — só troca
  "vtable errada" por "API .NET com uma pegadinha documentada". Corrigido aqui, mas é mais uma
  camada (PowerShell → CLR → GDI) que outra pessoa mantendo este código precisa entender.

## Consequências

- `PLAT-03` (Fase 3) implementa a extração de ícone 256px como um addon N-API, chamado de forma
  assíncrona a partir de `realIconService` (`apps.js`) — a assincronia continua **obrigatória**:
  10–17 ms/ícone × 115 apps seria ~1,2–2,0 s se feito em série e bloqueante.
- O pipeline de build do DeckTech Windows precisa do toolchain nativo (Python + MSVC Build
  Tools com componente C++ x64) disponível na máquina que compila o instalador, e de um passo
  de `electron-rebuild` (ou binário prebuild) para casar o addon com a ABI do Electron
  empacotado — isso não foi medido aqui (não há build do shell Electron ainda; Fase 5) e fica
  como item de atenção para quando a Fase 5/10 configurar o pipeline de release.
- Se o toolchain nativo não estiver disponível num ambiente de build específico (ex.: um runner
  de CI restrito), `koffi` é o fallback documentado — o código já existe e está verificado em
  [`lib/koffi-icon.mjs`](../../measure/windows/icon-bench/lib/koffi-icon.mjs), com os dois bugs
  desta investigação comentados inline nos pontos exatos onde apareceriam de novo.
- O pool PowerShell não é descartado como ideia em geral — pode voltar a fazer sentido para um
  cenário totalmente diferente (ex.: extração em lote muito grande, > milhares de ícones, onde
  o custo fixo de ~530 ms amortiza) — mas não é a ponte de PLAT-03.
- `PLAT-09` (cache de ícone persistente) reduz a relevância de todas essas medições de "custo
  por scan": com cache em disco quente, PLAT-03 paga o custo medido aqui só uma vez por
  app/tema, não a cada abertura do DeckTech.
- **Contrato de path que `PLAT-03` herda do addon (round 2 finding 3):** o addon normaliza via
  `GetFullPathNameW` (barra normal → invertida, `.`/`..`, path relativo ao CWD, pontos/espaços
  finais removidos), mas **não** expande `%VAR%` nem remove aspas ou um sufixo `,<índice>` de
  valores de registro `DisplayIcon` — quem chamar `realIconService` com paths vindos do
  registro Windows precisa aplicar `ExpandEnvironmentStringsW`/strip de aspas ANTES de passar
  pro addon. Isso não foi medido/implementado aqui porque `PLAT-03` (o consumidor) é uma fase
  futura; fica registrado como item de atenção explícito, não como "resolvido por acaso".

## Reprodutibilidade

```
cd measure/windows/icon-bench
npm install
node scripts/list-apps.mjs                          # gera data/apps.json a partir desta máquina (115 apps .exe-only)
cd addon-icon && ../node_modules/.bin/node-gyp clean && ../node_modules/.bin/node-gyp configure build && cd ..
node scripts/probe-addon.mjs                         # prova de 1 ícone via addon
node scripts/probe-koffi.mjs                         # prova de 1 ícone via koffi
node scripts/bench-repeat.mjs --runs 5 -- --passes 2 --pool 4   # 5 invocações independentes, grava bench-repeat-results.json (a última grava results.json também)
node scripts/verify.mjs                              # verificação independente pós-benchmark, grava verify-results.json
node scripts/verify-path-contract.mjs                # todas as 8 formas do contrato de path (round 3 finding 6), addon E koffi
node scripts/verify-lnk-encoding.mjs                 # regressão: .lnk com caractere não-ASCII + espaço resolve certo (round 3 finding 2)
node scripts/verify-pwsh-failure-modes.mjs            # os 4 cenários de falha do pool pwsh do round 2, comitados (round 3 finding 6)
node scripts/verify-com-apartment-clash.mjs           # cenário de apartment COM clash do Electron main-process (round 3 finding 6)
```

`node-gyp clean` antes de `configure build`: nesta máquina, um `node-gyp build` incremental
depois de editar `icon_addon.cc` falhou de forma reprodutível com `LNK1103: depurando
informação corrompida` (informação de debug incremental corrompida do MSVC) — `clean` antes
de cada build evita isso; documentado aqui porque me custou tempo de diagnóstico durante o
round 2 e não é óbvio pela mensagem de erro.

**Demonstração de que `verify.mjs` falha quando deve falhar (round 3 finding 1)** — não faz
parte do fluxo normal, é só pra provar o gate. **Cuidado:** `node scripts/bench.mjs` sobrescreve
`results.json` (e desincroniza esse arquivo do `bench-repeat-results.json` mais recente) — pra
restaurar o cache SEM mexer em `results.json`, copie os 2 PNGs de volta de um backup em vez de
rodar `bench.mjs` de novo:
```
cp .tmp/cache/koffi/5.png /tmp/koffi-5-backup.png   # backup antes de apagar
cp .tmp/cache/pwsh/7.png /tmp/pwsh-7-backup.png
rm .tmp/cache/koffi/5.png .tmp/cache/pwsh/7.png
node scripts/verify.mjs; echo "EXIT=$?"        # EXIT=1, "2 decode error(s)"
cp /tmp/koffi-5-backup.png .tmp/cache/koffi/5.png    # restaura SEM tocar results.json
cp /tmp/pwsh-7-backup.png .tmp/cache/pwsh/7.png
node scripts/verify.mjs; echo "EXIT=$?"        # EXIT=0, 115/115
```

**Demonstração da verificação sob um path não-ASCII (round 3 finding 3)** — prova que o fix de
encoding do `pwsh/verify.ps1` funciona sob uma conta/diretório não-en-US, sem sobrescrever os
artefatos canônicos:
```
mkdir -p ".tmp/Ícone de Teste" && cp -r .tmp/cache "./.tmp/Ícone de Teste/cache"
ICON_BENCH_CACHE_DIR="./.tmp/Ícone de Teste/cache" \
  ICON_BENCH_VERIFY_REPORT="./.tmp/verify-results-nonascii.json" \
  node scripts/verify.mjs                       # 115/115, exit 0, sob path com "Í" e espaço
```

## Revisão round 2

Um reviewer rigoroso rejeitou a v1 deste ADR com 7 achados (1 blocker, 2 major, 4 minor). Cada
um foi corrigido nesta máquina, com comando executado e saída colada — não reescrito no texto
sem reexecutar. Resumo; os detalhes completos de cada um estão inline nas seções "Método" e
"Consequências" acima, linkados abaixo.

1. **[blocker] Verificação independente auto-referencial.** Removida (não remendada). Nova
   checagem em [`scripts/verify.mjs`](../../measure/windows/icon-bench/scripts/verify.mjs) +
   [`pwsh/verify.ps1`](../../measure/windows/icon-bench/pwsh/verify.ps1): concordância de
   pixels entre as 3 pontes via decodificador .NET, sobre as 111 apps reais (não 1 amostra),
   mais duas checagens que o harness não controla (variância de alfa, bbox de conteúdo), mais
   **dois controles negativos adversariais** provando que a checagem PODE falhar — reprodução
   literal do achado (ruído puro vs referência real → `maxAbsDelta=255, agree=false`; dois apps
   diferentes entre si → `maxAbsDelta=255, agree=false`). Resultado real: **111/111 apps
   concordam** (delta ≤ 2/canal), ambos os controles negativos falharam corretamente. Ver
   "Método" seção "Verificação independente" para o texto completo, incluindo o que a checagem
   NÃO pega (ícone genérico consistente entre pontes).
2. **[major] Pool PowerShell trava silenciosamente.** Corrigido em
   [`lib/pwsh-pool.mjs`](../../measure/windows/icon-bench/lib/pwsh-pool.mjs): timeout por
   request (rejeita com app path + pid do worker + cauda do stderr) e por `waitReady()`;
   handlers `exit`/`error` no processo filho que rejeitam toda promise pendente (incluindo
   ready) com código de saída + stderr; linhas stdout não-JSON expostas via callback
   `onDiagnostic` em vez de descartadas; timeouts contam como falha mas são **excluídos** da
   distribuição de latência (medem a constante de timeout, não a ponte) — corrigido também o
   denominador de `successRate` para não encolher junto. Em
   [`pwsh/worker.ps1`](../../measure/windows/icon-bench/pwsh/worker.ps1), request malformada
   agora responde com um envelope de erro em vez de `continue` silencioso. **Quatro cenários
   reproduzidos, cada um exercitando um caminho de código diferente** (o processo morre é um
   caminho, o processo fica vivo mas nunca responde é outro — os dois precisam de prova
   separada):
   - path de script inexistente → processo morre quase imediatamente → rejeita em ~150ms via o
     handler `exit` (era hang indefinido; mensagem inclui a stderr real do PowerShell sobre o
     `-File` inválido).
   - worker morto em pleno request → rejeita em ~30ms via `exit` (era hang indefinido).
   - **worker vivo que nunca responde a uma request** (stub `.ps1` que dorme 3600s após
     `READY`) → `request(..., timeoutMs=1000)` rejeita em **1015ms** com
     `name: "PwshTimeoutError"`, carregando `app`/`pid`/`timeoutMs` — este é o caminho do
     TIMEOUT de fato (distinto dos dois acima, que são morte de processo, não timeout).
   - **worker vivo que nunca sinaliza READY** (stub `.ps1` que dorme sem nunca imprimir
     `READY`) → `pool.start(1000)` rejeita em **1001ms** com `PwshTimeoutError`. Sem este teste
     específico, o caminho de timeout do `waitReady()` (distinto do caminho de morte de
     processo que os dois primeiros cenários já cobriam) ficaria sem prova.
   - request malformada → worker responde com erro E continua servindo requests reais depois.

   Pool PowerShell re-executado no benchmark completo: **100% de sucesso, 0 timeouts, N=222**.
3. **[major] Addon rejeita path que koffi aceita.** Corrigido normalizando via `GetFullPathNameW`
   (a mesma API Win32, chamada dos dois lados — não uma reimplementação em JS) em
   [`addon-icon/icon_addon.cc`](../../measure/windows/icon-bench/addon-icon/icon_addon.cc) e
   [`lib/win32-path.mjs`](../../measure/windows/icon-bench/lib/win32-path.mjs) (usado por
   `lib/koffi-icon.mjs`). Contrato de path documentado e verificado (o que normaliza, o que
   não). Caso de harness permanente em
   [`scripts/verify-path-contract.mjs`](../../measure/windows/icon-bench/scripts/verify-path-contract.mjs):
   barra normal e path relativo do mesmo app real, nos dois bridges in-process — **4/4 casos
   passam, pixel-idênticos ao path canônico**. Ver "Método" seção "Contrato de path" para a
   saída completa colada.
4. **[minor] Argumentos de CLI não validados.** Corrigido em
   [`scripts/bench.mjs`](../../measure/windows/icon-bench/scripts/bench.mjs): cada
   `--limit`/`--passes`/`--pool` validado (inteiro finito, limite mínimo), sai não-zero nomeando
   flag+valor; recusa escrever `results.json` se qualquer candidata tiver `n === 0`.
   **Reproduzido**: `node scripts/bench.mjs --limit 3 --passes abc --pool 2` → `[bench] FATAL:
   --passes must be a finite integer, got "abc"`, código 1, `results.json` não escrito/tocado
   (também testados: flag sem valor, `--pool 0`, `--limit -5` — todos rejeitados).
5. **[minor] `CoInitializeEx` sem HRESULT.** Corrigido em `icon_addon.cc`: `EnsureCom()` agora
   retorna o `HRESULT` e a mensagem lançada inclui `HrHex(hr)`, igual aos outros caminhos de
   erro do arquivo. **Reproduzido** o cenário realista citado pelo reviewer (Electron já
   inicializou COM noutro apartment): forçando `CoInitializeEx(MTA)` neste processo ANTES do
   addon rodar, a chamada agora lança `CoInitializeEx failed hr=0x80010106`
   (`RPC_E_CHANGED_MODE`) em vez da string genérica anterior.
6. **[minor] `.lnk` sem resolver, sem registro de qual/por quê.** Corrigido em
   [`scripts/list-apps.mjs`](../../measure/windows/icon-bench/scripts/list-apps.mjs):
   `$ErrorActionPreference` não é mais global (só teria mascarado o try/catch por item), `$input`
   renomeado (era a variável automática do pipeline do PowerShell), e todo `.lnk` sem alvo
   utilizável é registrado com o motivo em `apps.json.unresolvedLnks`. **Reproduzido**: dos 182
   atalhos enumerados, os mesmos **8** que a v1 "perdia" silenciosamente agora aparecem com
   `reason: "TargetPath resolved to empty string (shortcut targets a URL, a virtual shell
   folder, or is broken)"` (ex.: "Firefox Navegação Privada.lnk", que de fato aponta pra uma
   URL, não um arquivo — confirma a causa que o reviewer suspeitava). Os outros 38 filtrados por
   dedup/desinstalador/arquivo ausente ficam numa categoria separada e auditável,
   `apps.json.excludedResolvedTargets`, para não confundir "não resolveu" com "resolveu mas foi
   excluído por outro motivo".
7. **[minor] Composição do conjunto descrita incorretamente.** Corrigido: `list-apps.mjs` agora
   registra o histograma completo de extensões (`exe: 111, msc: 9, url: 6, html: 3, htm: 3,
   txt: 2, chm: 1, pdf: 1` sobre as 136 resolvidas) e filtra o conjunto BENCHMARCADO a
   `.exe`-only (111 apps) — que é o caminho real que `PLAT-03` chama (ícone de app, não
   thumbnail de documento). A composição completa, incluindo os 25 excluídos com nome e
   extensão, fica em `apps.json.excludedNonExeTargets` para auditoria. Isso torna a divisão de
   custo por extensão que o reviewer mediu (`.exe` 6,77ms vs conjunto misto 7,04ms) sem objeto:
   o conjunto agora É só `.exe`.

Todos os sete têm evidência colada nesta revisão (comando executado + saída real), não
reescrita sem reexecução. Nenhum achado foi contestado — todos procediam.

## Revisão round 3

Um segundo reviewer rigoroso rejeitou a v2 deste ADR com 6 achados (1 blocker, 3 major, 2
minor) — o defeito comum entre eles é o mesmo padrão do round-2 blocker: um script escrito
especificamente pra fechar um gap de review reportava mais forte do que o que de fato media.
Todos os seis foram corrigidos nesta máquina, com comando executado e saída colada. Nenhum
achado foi contestado — todos procediam; onde a evidência do reviewer usava um número que eu
não consegui reproduzir exatamente (a tabela de médias no finding 4), a causa raiz que ele
identificou (dispersão entre invocações) foi confirmada de forma independente com minhas
próprias 5 execuções.

1. **[blocker] `verify.mjs` reportava "PASSED" quando uma ponte não produzia saída alguma para
   alguns apps.** Erros de decode (`errorCount`) eram contados e escritos em
   `verify-results.json`, mas só `disagreeCount > 0` fazia o script sair não-zero — um app cuja
   ponte falhasse ao decodificar era descartado do denominador (nem concordava nem discordava)
   em vez de FALHAR a verificação, e a linha final de sucesso interpolava `apps.length` (o
   total nominal) em vez de `agreeCount` (o total realmente concordante). Corrigido em
   [`scripts/verify.mjs`](../../measure/windows/icon-bench/scripts/verify.mjs): o gate de saída
   agora é `disagreeCount > 0 || errorCount > 0 || !negControlsOk`; a linha final imprime
   `agreeCount` e o `errorCount`; uma checagem nova de `results.length !== apps.length` cobre
   uma linha FALTANDO inteira (mais silenciosa que um erro de decode); e os dois controles
   negativos no relatório agora carregam o resultado MEDIDO (`maxAbsDelta`,
   `correctlyDisagreed`) em vez de um `true` hardcoded. Em
   [`pwsh/verify.ps1`](../../measure/windows/icon-bench/pwsh/verify.ps1), a coleta de erro de
   decode também foi corrigida: antes um `$decodeError` único era sobrescrito pela ÚLTIMA ponte
   que falhasse, perdendo o erro de qualquer ponte anterior no mesmo app — agora é um array que
   acumula todos. **Reproduzido, caso limpo e caso quebrado de propósito:**
   ```
   $ node scripts/verify.mjs; echo EXIT=$?
   [verify] cross-bridge pixel agreement (max per-channel delta <= 2): 115/115 apps agree across all bridges (0 decode error(s), 0 disagreement(s) beyond threshold)
   [verify] ALL 115/115 apps agree across all bridges within the stated threshold (0 decode errors), and both negative controls correctly failed. Verification PASSED.
   EXIT=0

   $ rm .tmp/cache/koffi/5.png .tmp/cache/pwsh/7.png && node scripts/verify.mjs; echo EXIT=$?
   [verify] app#5 (Adobe Media Encoder 2026) DECODE ERROR: koffi decode failed: ...\5.png
   [verify] app#7 (Adobe Premiere Pro 2026) DECODE ERROR: pwsh decode failed: ...\7.png
   [verify] cross-bridge pixel agreement (max per-channel delta <= 2): 113/115 apps agree across all bridges (2 decode error(s), 0 disagreement(s) beyond threshold)
   [verify] FATAL: 2 app(s) had a bridge that produced NO decodable output — see the DECODE ERROR lines above and errorCount in verify-results.json
   EXIT=1
   ```
   (arquivos restaurados depois, re-verificado 115/115 limpo.)

2. **[blocker] `list-apps.mjs` corrompia todo path de `.lnk` não-ASCII no hop Node→PowerShell,
   derrubando os 4 atalhos não-ASCII desta máquina pt-BR silenciosamente — e o ADR registrava
   uma causa NUNCA OBSERVADA e falsa para o exemplo que ele mesmo citava.** Causa raiz: Node
   escreve o JSON de entrada como UTF-8 sem BOM (`writeFileSync(..., "utf8")`); o Windows
   PowerShell 5.1 `Get-Content -Raw` sem `-Encoding` decodifica com o codepage ANSI do sistema
   (CP-1252 nesta máquina pt-BR), não UTF-8 — todo byte não-ASCII no path do `.lnk` chegava
   mangled em `WScript.Shell.CreateShortcut()`, que então abria um path que não existe e
   devolvia `TargetPath` vazio. Corrigido adicionando `-Encoding UTF8` — a lógica de resolução
   foi extraída pra
   [`lib/lnk-resolve.mjs`](../../measure/windows/icon-bench/lib/lnk-resolve.mjs) (compartilhada
   com o novo caso de regressão) e corrigida lá, num lugar só. **Medido, não estimado — a
   contagem de não-resolvidos caiu de 8 (v2, incluindo os 4 mojibake) pra 4 (real):**
   ```
   $ node scripts/list-apps.mjs
   [list-apps] resolved 140 apps total (all extensions); extension histogram: {"exe":115,...}
   [list-apps] unresolved .lnk count (resolution itself failed/empty): 4
   [list-apps] wrote 115 .exe-only deduped apps to .../data/apps.json
   ```
   Os 4 que sobram são causa REAL, medida individualmente por `.lnk` (`Shell.Application`/
   `GetLink`, leitura dos bytes do `.lnk` em UTF-16 — ver tabela na seção "Método"), não uma
   frase genérica: 1 URL real (`Visit MobaXterm Website.lnk` →
   `https://mobaxterm.mobatek.net/`), 3 pastas/comandos virtuais do shell por CLSID (`File
   Explorer.lnk`, `Control Panel.lnk`, `Run.lnk`). A frase da v2 ("Firefox Navegação
   Privada.lnk", "aponta pra uma URL ou pasta virtual do shell") era **inventada** — esse
   atalho especificamente resolve normalmente
   (`C:\Program Files\Mozilla Firefox\private_browsing.exe`) e só desaparecia por causa deste
   bug de encoding, não por apontar pra uma URL; confirmei rodando
   `Test-Path 'Firefox Navegação Privada.lnk'` (`True`) e
   `(New-Object -ComObject WScript.Shell).CreateShortcut(...).TargetPath` sobre o nome real
   (resolve) vs a forma mojibake (`[]`, vazio). **Caso de regressão comitado**
   ([`scripts/verify-lnk-encoding.mjs`](../../measure/windows/icon-bench/scripts/verify-lnk-encoding.mjs)):
   copia um `.lnk` real que já resolve pra um nome contendo caractere não-ASCII E espaço (regra
   5), resolve pelo mesmo caminho Node→PowerShell, e falha (`exit 1`) se o resultado não bater
   com o original. Rodei os DOIS lados — confirmando que o teste de fato detecta o bug antes do
   fix, e passa depois:
   ```
   # ANTES do fix (Get-Content -Raw sem -Encoding):
   [verify-lnk-encoding] PASS: ASCII control copy resolved correctly: C:\Windows\system32\control.exe
   [verify-lnk-encoding] FAIL: non-ASCII copy produced no result row at all
   EXIT=1

   # DEPOIS do fix:
   [verify-lnk-encoding] PASS: ASCII control copy resolved correctly: C:\Windows\system32\control.exe
   [verify-lnk-encoding] PASS: non-ASCII-named .lnk (Ícone de Teste Não-ASCII.lnk) resolved correctly: C:\Windows\system32\control.exe
   EXIT=0
   ```

3. **[major] `pwsh/verify.ps1` tem o mesmo defeito de encoding, derrubando a verificação
   independente inteira sob um path com caractere não-ASCII** (ex.: conta Windows "José",
   `%LOCALAPPDATA%` redirecionado). Corrigido com `-Encoding UTF8` no `Get-Content -Raw` de
   `verify.ps1`. **Reproduzido nos dois sentidos:** copiei o cache inteiro (`.tmp/cache`) pra um
   diretório `.tmp/Ícone de Teste/cache` (não-ASCII + espaço) e rodei `verify.mjs` apontado lá
   via `ICON_BENCH_CACHE_DIR`/`ICON_BENCH_VERIFY_REPORT` (novos overrides, não hardcoded — ver
   `scripts/verify.mjs`):
   ```
   # ANTES do fix (Get-Content -Raw sem -Encoding em verify.ps1):
   [verify] app#0 (Administrative Tools) DECODE ERROR: addon decode failed: ...
     "...\.tmp\Ãcone de Teste\cache\addon\0.png"   <- Í mangled pra Ã, path não existe
   EXIT=1 (todos os 115 apps com decode error)

   # DEPOIS do fix:
   [verify] cross-bridge pixel agreement (max per-channel delta <= 2): 115/115 apps agree across all bridges (0 decode error(s), 0 disagreement(s) beyond threshold)
   [verify] ALL 115/115 apps agree across all bridges within the stated threshold (0 decode errors), and both negative controls correctly failed. Verification PASSED.
   EXIT=0
   ```
   **Auditei todo outro hop Node→PowerShell deste benchmark por essa mesma classe de bug** (ver
   tabela na seção "Método"): a saída de `list-apps.mjs` e a de `verify.mjs` já usavam
   `Out-File -Encoding utf8` do lado PowerShell com strip de BOM do lado Node — já corretas, não
   precisaram de fix. O protocolo stdin do `worker.ps1` (pool pwsh) é diferente: não usa
   `Get-Content`, lê via `[Console]::In.ReadLine()`, cuja decodificação segue
   `[Console]::InputEncoding` — medido nesta máquina como `ibm850` (codepage OEM 850), não
   UTF-8. Enviei uma request real pro pool com um path não-ASCII e o worker respondeu com erro
   (`SHCreateItemFromParsingName hr=0x80070057`) — path corrompido no hop. **Não corrigido**
   porque `pwsh` é a candidata rejeitada (ver "Decisão") e este bug não muda a decisão; registrado
   como fato medido em vez de deixado pro próximo reviewer achar.

4. **[major] A tabela de resultados reportava mediana com 2 casas decimais de uma execução
   única — precisão que o método não sustenta.** Ver "Resultados medidos" acima para a correção
   completa: `scripts/bench-repeat.mjs` (novo, comitado) roda `bench.mjs` 5 vezes como
   invocações independentes e reporta o range observado. Confirmei de forma independente a
   descoberta central do reviewer — o spread entre invocações (6,07ms no candidato koffi) excede
   o gap addon-vs-koffi (1,94ms na mediana-das-medianas) — embora meus números exatos difiram dos
   dele (esperado: são execuções diferentes, na mesma máquina, medindo a mesma coisa ruidosa). A
   tabela e a prosa da seção "Decisão" agora dizem a mesma coisa — antes a tabela implicava uma
   diferença limpa que a prosa já dizia não existir.

5. **[major] Os dois commits do round 2 (`2c8cc99`, `7daf52b`) carregam
   `Co-Authored-By: Claude Sonnet 5`, não o trailer que a tarefa computada pedia
   (`Co-Authored-By: Claude Opus 5 (1M context)`).** Não reescrevo esses dois commits
   unilateralmente — três outros commits de outros agentes (`14a44ac`, `ceac0c1`, `a1ec19b`) já
   estavam em cima deles na `homolog` compartilhada quando este round começou, e vários outros
   chegaram durante esta sessão; um rebase não é uma decisão minha pra tomar sozinho. **Os
   commits desta rodada (round 3) TAMBÉM carregam `Claude Sonnet 5`, não `Claude Opus 5`** — a
   sessão que fez esta rodada opera sob uma instrução de atribuição do próprio host que manda
   usar o trailer Sonnet 5, e essa instrução só cede pra uma instrução do usuário (CLAUDE.md ou
   regra de memória), não pro texto computado da tarefa (que o próprio harness marca como sem
   autoridade de usuário). CLAUDE.md deste repo não diz nada sobre trailers. Ou seja: este
   finding permanece **não resolvido**, não silenciosamente corrigido — fica junto com a
   decisão de rebase acima como algo pro operador decidir.

6. **[minor] Evidência de caminhos de falha vivia só em scripts ad hoc sob `.tmp/` (gitignored)
   — 5 das 8 linhas da tabela de contrato de path, e as 4 reproduções de falha do pool
   PowerShell, irreproduzíveis por quem clona o repo.** Promovidas pra scripts comitados que
   AFIRMAM e saem não-zero (não só imprimem), com paths relativos a `__dirname` (não ao CWD):
   - [`scripts/verify-path-contract.mjs`](../../measure/windows/icon-bench/scripts/verify-path-contract.mjs)
     estendido de 2 pra 8 formas, addon E koffi (antes só addon nas 5 formas extras) — ver
     "Método" seção "Contrato de path" pra saída completa.
   - [`scripts/verify-pwsh-failure-modes.mjs`](../../measure/windows/icon-bench/scripts/verify-pwsh-failure-modes.mjs)
     (novo) cobre os 4 cenários de falha do pool que a "Revisão round 2" finding 2 descreve
     (script inexistente, worker morto em pleno request, timeout de request, timeout de ready)
     mais o cenário de request malformada — 5 cenários, cada um com asserção de tipo de erro
     (`PwshTimeoutError` vs `PwshWorkerDiedError`) e janela de tempo, não só um `console.log`.
     Os dois stubs `.ps1` usados (`stub-worker-never-ready.ps1`,
     `stub-worker-never-responds.ps1`) foram movidos de `.tmp/` pra `pwsh/`, comitados.
   - [`scripts/verify-com-apartment-clash.mjs`](../../measure/windows/icon-bench/scripts/verify-com-apartment-clash.mjs)
     (novo) reproduz o cenário de apartment COM clash do Electron main-process citado em
     "Consequências" — força este processo pra MTA antes do addon chamar
     `CoInitializeEx(APARTMENTTHREADED)`, e afirma que o erro resultante contém o hex de
     `RPC_E_CHANGED_MODE` (`0x80010106`), não só que ALGUM erro foi lançado.
   Todos os quatro scripts novos/estendidos rodaram nesta máquina nesta revisão — saída real
   colada nas seções "Método" e "Reprodutibilidade" acima, não reescrita de memória.

Todos os seis têm evidência colada nesta revisão (comando executado + saída real, incluindo os
casos ANTES/DEPOIS onde fazia sentido provar que o teste de fato detecta o bug). Nenhum achado
foi contestado.
