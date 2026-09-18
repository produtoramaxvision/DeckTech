# ADR 0001: Ponte Node -> `IShellItemImageFactory` para ícones 256px no Windows

**Status:** Aceita
**Data:** Criada 2026-09-17 22:00 (commit `2ffab25`). Revisões em ordem cronológica, cada uma
com o(s) commit(s) que a fez, para que esta linha não volte a inverter a ordem numa próxima
revisão (round 5 review, finding 5). **Restrição estrutural (round-7 fix, finding 2):** um
commit não pode citar o próprio hash — essa é a razão pela qual esta linha já quebrou três vezes
(placeholder "nesta revisão" da v5; o fix do round 6 corrigindo esse placeholder; e o commit
`15c8155` re-quebrando a linha ao ser o commit que editava a entrada sobre si mesmo). Por isso a
entrada de cada round SÓ é preenchida no round seguinte, como esta edição agora preenche a do
round 6 — a entrada do round que está fazendo esta própria edição (round 7) não tenta se
auto-citar; ver "Revisão round 7" abaixo, que registra por que isso é decisão estrutural e não
um novo descuido, e cujo(s) commit(s) serão adicionados retroativamente na próxima revisão que
tocar este arquivo. Cronologia: round 2 em 2026-09-17 22:33 (commit `2c8cc99`); correção
pós-round-2 de um self-advisory pass em 2026-09-17 22:40 (commit `7daf52b`, não um round de
review numerado — citado à parte porque o número 533,8ms desta revisão vem dele, ver "Por que o
pool PowerShell não vence"); round 3 em 2026-09-17 23:39 (commit `349a3fd`); round 4 em
2026-09-18 00:23 (commit `4287998`); round 5 em 2026-09-18 00:47 (commit `770b5d8`); round 6 em
2026-09-18 01:02–01:03 (commits `8d3ab77` e `15c8155`; `15c8155` foi mis-escopado — sua mensagem
de commit descrevia apenas esta edição de uma linha, mas o diff também carregava 152 linhas não
relacionadas de `docs/adr/0003-proof-03-lnk-binary-parsing.md`, revertidas byte-a-byte em
`e037bcb` e o conteúdo daquele arquivo recuperado pelo dono da PROOF-03 em `1a17224`; achado do
round-7 review, ver "Revisão round 7" abaixo); round 7 em 2026-09-18 (commit `0c772ba`;
preenchido retroativamente nesta edição — round 8 — seguindo a mesma restrição estrutural: o
round 7 não podia citar o próprio hash na sua própria entrada, então essa lacuna ficou para a
revisão seguinte fechar, exatamente como esta linha descreve). Pelo mesmo motivo, o round 8
(esta revisão) também não tenta se auto-citar aqui; seu(s) commit(s) serão preenchidos na
revisão seguinte que tocar este arquivo — ver "Revisão round 2", "Revisão round 3",
"Revisão round 4", "Revisão round 5", "Revisão round 6", "Revisão round 7" e "Revisão round 8"
abaixo.
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
> **Um terceiro round rejeitou a v3** — a linha `%VAR%` do contrato de path prefixava a variável
> num path já absoluto do app selecionado nesta máquina (Adobe Acrobat), produzindo uma forma
> malformada que falhava com o MESMO erro fosse `%VAR%` expandido ou não: a linha não
> discriminava nada, e a tabela citava esse resultado não-discriminante como prova de que
> `%VAR%` não é expandido; a seção "Decisão" citava números de startup/throughput do pool
> (~530ms, 6,98ms/ícone) que já não batiam com o `results.json` comitado NA MESMA revisão
> (584,8ms, 6,52ms) nem eram reprodutíveis pelo reviewer; `bench-repeat-results.json` só
> agregava `medianMs`, então um range de startup citado na prosa (423–702ms) não tinha artefato
> committed pra verificar; dois scripts de verificação promovidos na rodada anterior
> hardcodavam `C:\Windows\System32\notepad.exe` em vez de derivar de `process.env.SystemRoot`
> como um script irmão no mesmo commit já fazia; e um bloco rotulado "saída real" continha uma
> linha resumida à mão que o script nunca imprime, com 3 linhas do koffi truncadas em "for ...".
> A seção "Revisão round 4" ao final detalha os cinco achados e a correção de cada um.
>
> **Os números na tabela de "Resultados medidos" abaixo já são da re-execução pós-round-4**
> (115 apps `.exe`-only — mesmo conjunto do round 3; N=230 amostras/candidata por execução,
> **5 execuções independentes**, re-executadas no round 4 (commit `4287998`) — ver "Resultados medidos" pra
> metodologia e range observado, agora incluindo startup e throughput do pool agregados por
> rodada em `bench-repeat-results.json`, não só medianMs).

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
  literal dos dois lados. **Round 3 finding 6:** as linhas abaixo marcadas com † viviam só
  num script ad hoc sob `.tmp/` (gitignored, irreproduzível por quem clona o repo) — agora
  todas rodam, comitadas, contra os DOIS bridges in-process (não só addon — a
  origem do finding 3 do round 2 era exatamente os dois fazendo trabalho desigual), via
  [`scripts/verify-path-contract.mjs`](../../measure/windows/icon-bench/scripts/verify-path-contract.mjs),
  sobre um app real com espaço no path (`Adobe Acrobat`,
  `C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe`) para as formas derivadas do app, e um
  segundo alvo fixo (`%SystemRoot%\System32\notepad.exe`) para o par discriminador de `%VAR%`
  (ver "Round 4 finding 1" abaixo — não `notepad.exe` sintético usado como app principal, só como
  alvo fixo da linha de env var).

  **Round 4 finding 1 (major), corrigido:** a linha `%VAR%` da v3 prefixava `%ProgramFiles%` no
  path ABSOLUTO do app selecionado (`C:\Program Files\Adobe\...`), produzindo
  `%ProgramFiles%\C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe` — uma forma malformada
  que falha com o MESMO hr (`0x80070002`) seja `%VAR%` expandido ou não. Essa linha não
  discriminava nada: "passava" (isto é, falhava) mesmo que o addon expandisse variáveis de
  ambiente. Um reviewer provou isso rodando a forma comitada (falha `0x80070002`), a mesma forma
  expandida à mão (`%ProgramFiles%` → `C:\Program Files`, ainda falha, agora `0x80070057` por
  duplicar o prefixo), e um par discriminador real: `%SystemRoot%\System32\notepad.exe` (falha
  `0x80070002`) vs `C:\Windows\System32\notepad.exe` expandido à mão (sucesso). Substituí a
  linha por exatamente esse par discriminador, como duas linhas `standalone` em
  `scripts/verify-path-contract.mjs` que ignoram o app selecionado e sempre testam o alvo fixo
  `%SystemRoot%\System32\notepad.exe` (via
  [`lib/probe-target.mjs`](../../measure/windows/icon-bench/lib/probe-target.mjs), compartilhado
  também pelos dois scripts do finding 4 abaixo).

  | Forma | Resultado real (addon = koffi) | O que confirma |
  |---|---|---|
  | canônico (barra invertida, absoluto) | sucesso | baseline |
  | barra normal (`C:/Program Files/...`) | sucesso, pixel-idêntico ao canônico | `/` → `\` |
  | relativo (`..\..\...`) | sucesso, pixel-idêntico ao canônico | resolvido contra o CWD |
  | espaço à direita (`Acrobat.exe `) † | sucesso, pixel-idêntico ao canônico | espaço final removido |
  | ponto à direita (`Acrobat.exe.`) † | sucesso, pixel-idêntico ao canônico | ponto final removido |
  | `%SystemRoot%\System32\notepad.exe` (literal, alvo fixo) | **falha**, hr=`0x80070002` (arquivo não encontrado) | `%VAR%` **NÃO** é expandido — tratado como texto literal |
  | `C:\Windows\System32\notepad.exe` (mesmo alvo, expandido à mão — controle pareado) | **sucesso** | prova que a linha acima falha pela variável literal, não por notepad.exe estar inacessível |
  | `"C:\Program Files\...\Acrobat.exe"` (com aspas) † | **falha**, hr=`0x80070057` (argumento inválido) | aspas **NÃO** são removidas |
  | `Acrobat.exe,0` (sufixo de índice de registro) † | **falha**, hr=`0x80070002` (arquivo não encontrado) | sufixo `,<índice>` **NÃO** é removido |

  As linhas de `%SystemRoot%` literal, aspas e `,<índice>` falham DE PROPÓSITO — confirmam o que
  o contrato NÃO cobre, não um bug: quem chamar `realIconService` com um valor `DisplayIcon` de
  registro precisa expandir `%VAR%` (`ExpandEnvironmentStringsW`), remover aspas e cortar o
  sufixo `,<índice>` **antes** de passar o path pro addon — esse pré-processamento não existe
  ainda porque `PLAT-03` (o consumidor) é uma fase futura; fica registrado como requisito
  explícito da interface, não como suposição. Saída real desta execução, addon E koffi, colada
  verbatim (nenhuma linha resumida ou parafraseada — as 3 linhas do koffi carregam o path
  completo que o hr reporta, sem truncar):
  ```
  addon / forward-slash: extraction OK, pixel-identical to canonical: true
  addon / relative: extraction OK, pixel-identical to canonical: true
  addon / trailing space: extraction OK, pixel-identical to canonical: true
  addon / trailing dot: extraction OK, pixel-identical to canonical: true
  addon / %SystemRoot% (env var, must fail — not expanded): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002
  addon / %SystemRoot% control (hand-expanded, must succeed): extraction OK (standalone target, not compared to canonical), 262144 bytes (expected 262144)
  addon / surrounding quotes (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070057
  addon / ,0 icon-index suffix (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002
  koffi / forward-slash: extraction OK, pixel-identical to canonical: true
  koffi / relative: extraction OK, pixel-identical to canonical: true
  koffi / trailing space: extraction OK, pixel-identical to canonical: true
  koffi / trailing dot: extraction OK, pixel-identical to canonical: true
  koffi / %SystemRoot% (env var, must fail — not expanded): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002 for C:\Users\MaxVision\Desktop\cursor-oficial\decktech\measure\windows\icon-bench\%SystemRoot%\System32\notepad.exe
  koffi / %SystemRoot% control (hand-expanded, must succeed): extraction OK (standalone target, not compared to canonical), 262144 bytes (expected 262144)
  koffi / surrounding quotes (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070057 for C:\Users\MaxVision\Desktop\cursor-oficial\decktech\measure\windows\icon-bench\"C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe"
  koffi / ,0 icon-index suffix (must fail — not stripped): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002 for C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe,0

  [verify-path-contract] === standalone form addon/koffi byte-equality ===
    %SystemRoot% control (hand-expanded, must succeed): addon vs koffi byte-identical: true

  [verify-path-contract] === addon vs koffi outcome per form ===
    forward-slash: addon=succeeded koffi=succeeded (agree)
    relative: addon=succeeded koffi=succeeded (agree)
    trailing space: addon=succeeded koffi=succeeded (agree)
    trailing dot: addon=succeeded koffi=succeeded (agree)
    %SystemRoot% (env var, must fail — not expanded): addon=correctly rejected koffi=correctly rejected (agree)
    %SystemRoot% control (hand-expanded, must succeed): addon=succeeded koffi=succeeded (agree)
    surrounding quotes (must fail — not stripped): addon=correctly rejected koffi=correctly rejected (agree)
    ,0 icon-index suffix (must fail — not stripped): addon=correctly rejected koffi=correctly rejected (agree)
  ```
  0 divergências entre addon e koffi em qualquer uma das 8 formas (o script só imprime a linha
  `NOTE: N form(s) diverging` quando `divergences > 0` — ausente aqui porque não houve nenhuma,
  não porque foi omitida).

  **Round 5 review fix (finding 4, minor):** o `262144 bytes` acima era só impresso, nunca
  comparado a nada — um buffer vazio ou do tamanho errado ainda teria impresso "extraction OK" e
  passado. Corrigido de duas formas, ambas visíveis na saída acima: (a) o script agora afirma
  `bgra.length === EXPECTED_BGRA_BYTES` (256×256×4 = 262144) no ramo standalone must-succeed e
  incrementa `failures` em caso de divergência — por isso a saída agora diz
  `(expected 262144)` ao lado do tamanho medido; (b) depois que os dois bridges rodam, o script
  extrai o MESMO alvo fixo duas vezes (uma por bridge) e compara os bytes com
  `Buffer.compare` — a nova seção `=== standalone form addon/koffi byte-equality ===` acima —
  restaurando um check de conteúdo real sem depender de um app canônico. Reproduzido nesta
  máquina: `node scripts/verify-path-contract.mjs` continua terminando com
  `PASS: both bridges accept...` depois da mudança, e a comparação cross-bridge imprime
  `byte-identical: true`.
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

**Round 4 re-execução (findings 2/3):** o round 4 review encontrou a seção "Decisão" citando
números de startup/throughput do pool que já não batiam com o `results.json` comitado NESTA
MESMA revisão (~530ms/6,98ms citados na prosa da Decisão vs 584,8ms/6,52ms no `results.json`
então comitado — nem um nem outro reprodutível pelo reviewer, que mediu startup 426–579ms e
throughput 5,18–5,92ms/ícone em 5 rodadas próprias). Em vez de tentar acertar um único ponto
outra vez — o mesmo erro seria trivial de repetir —, os 5 runs foram re-executados nesta máquina
E `scripts/bench-repeat.mjs` foi estendido (finding 3) para agregar `startupMs` e
`aggregateThroughputMsPerIcon` do pwsh por rodada, não só `medianMs`, gravando tudo em
`bench-repeat-results.json` — a tabela e a prosa abaixo citam esse arquivo diretamente, comando
exato em "Reprodutibilidade":

| Candidata | medianas por execução (ms) | mediana-das-medianas | range min–max | spread |
|---|---|---:|---:|---:|
| controle (harness only) | 1,87 / 1,73 / 2,13 / 1,49 / 1,82 | 1,82 | 1,49–2,13 | 0,64 |
| **N-API addon** | 11,30 / 14,28 / 12,48 / 10,92 / 11,44 | **11,44** | 10,92–14,28 | 3,36 |
| **koffi (FFI)** | 15,01 / 14,56 / 11,64 / 12,64 / 12,13 | **12,64** | 11,64–15,01 | 3,37 |
| pool PowerShell (4 processos, latência/request) | 29,84 / 30,68 / 26,24 / 24,82 / 25,07 | 26,24 | 24,82–30,68 | 5,86 |

**O gap addon-vs-koffi na mediana-das-medianas é 1,20ms. O spread PRÓPRIO de uma única
candidata (koffi, 3,37ms) é maior que esse gap.** Isto é o output real de
`scripts/bench-repeat.mjs` desta execução:
```
[bench-repeat] addon-vs-koffi median-of-medians gap: 1.20ms. Largest single candidate's own
between-run spread (addon or koffi): 3.37ms. The between-run spread is >= the addon-vs-koffi
gap: the two candidates are NOT reliably distinguishable by ms/icon alone at this repeat count.
```
O número exato do gap (1,94ms no round 3, 1,20ms aqui) e do spread (6,07ms no round 3, 3,37ms
aqui) mudam de execução para execução — **isso é o ponto, não um problema**: cada re-execução
independente reproduz a MESMA conclusão qualitativa (spread entre execuções ≥ gap entre
candidatas) com números diferentes, o que é evidência mais forte de que a conclusão é robusta do
que um único par de números seria. Isso não é uma observação nova desta rodada — a seção
"Decisão" abaixo já argumentava, em prosa, desde o round 2, que addon e koffi "empatam em
velocidade e isso não decide"; o que o round 3 corrigiu foi a TABELA implicando o oposto, e o que
o round 4 corrige é a seção "Decisão" citando pontos fixos (530ms, 6,98ms) que uma re-execução
torna obsoletos por definição — ver a correção abaixo em "Por que o pool PowerShell não vence".

Startup do pool PowerShell (4 workers) e throughput agregado, agregados das mesmas 5 execuções
via `bench-repeat-results.json` (`candidates.pwsh.extra` em cada `results-run{N}.json` — ver
"Reprodutibilidade"):

| Métrica | por execução | mediana-das-medianas | range min–max | spread |
|---|---|---:|---:|---:|
| startup do pool (ms, 4 workers) | 1386,0 / 613,1 / 554,9 / 747,7 / 961,3 | 747,7 | 554,9–1386,0 | 831,1 |
| throughput agregado (ms/ícone, concorrência=4) | 7,88 / 8,31 / 6,86 / 6,45 / 6,64 | 6,86 | 6,45–8,31 | 1,86 |

A última das 5 execuções (a que fica em `results.json`/`.tmp/cache` no momento deste texto) deu:
p95 addon 18,26ms / koffi 18,81ms / pwsh 42,53ms; média addon 12,18ms / koffi 12,58ms / pwsh
26,10ms; min–max addon 7,43–32,53ms / koffi 7,12–39,56ms / pwsh 11,09–51,64ms; startup do pool
(4 workers) 961,3ms; throughput agregado do pool a concorrência=4: 6,64 ms/ícone (varia por
execução — ver range de startup e throughput agregados nas 5 rodadas na tabela acima: startup
554,9–1386,0ms, throughput 6,45–8,31 ms/ícone). 100% de sucesso em todas as quatro linhas, em
todas as 5 execuções, 0 timeouts no pool PowerShell em qualquer uma delas.
Throughput agregado do pool PowerShell (tempo de parede da passada de 115 apps ÷ 115, média de
2 passadas) **não é comparável linha a linha** com a mediana de addon/koffi — reflete paralelismo
de 4 processos simultâneos, não custo por chamada síncrona. Ver "Decisão" sobre por que isso não
decide a escolha.

**Baseline frio, agnóstico de ponte** (medido uma única vez por execução, com o addon, antes de
qualquer candidata tocar os arquivos — ver "Método"): na última execução, N=115, mediana
**22,91 ms**, p95 **46,39 ms**, média 25,68 ms, 100% sucesso — na mesma faixa dos 43,2 ms/ícone
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

**Round 3 e round 4 confirmam isto com medição, não só com prosa, em duas rodadas independentes**
(ver "Resultados medidos", finding 4/round 4 re-execução): rodando `bench.mjs` 5 vezes como
invocações independentes, o gap addon-vs-koffi na mediana-das-medianas foi 1,94ms no round 3 e
1,20ms nesta re-execução do round 4 — enquanto o spread PRÓPRIO de uma única candidata entre as 5
execuções chegou a 6,07ms (round 3) e 3,37ms (round 4), sempre maior que o gap da mesma rodada.
O spread entre execuções é consistentemente ≥ o gap entre candidatas em ambas as rodadas: **ms/
ícone não distingue addon de koffi nesta máquina**, com qualquer número de casas decimais — e o
padrão se manteve em duas re-execuções independentes do mesmo comando comitado
(`bench-repeat.mjs --runs 5`, que invoca `bench.mjs` 5 vezes internamente — o mesmo `bench.mjs`
citado acima), ~1h de intervalo dentro da mesma sessão de trabalho (`generatedAt`
2026-09-18T02:22:09.968Z em `349a3fd` e 2026-09-18T03:17:16.617Z em `4287998`, delta de 55,1 min),
com números diferentes mas a mesma ordenação qualitativa — não semanas nem sessões distintas.
**Não executada nesta revisão: uma re-execução cross-sessão/cross-reboot; nenhuma robustez
cross-sessão é afirmada.** Isso é esperado: as duas chamam exatamente
a mesma API COM
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

- **Custo de startup fixo da ordem de centenas de ms** — compilar C# via `Add-Type` é caro e não
  amortiza para uma extração pontual (ex.: usuário adiciona 1 app novo ao dock depois do scan
  inicial). Um addon ou koffi já têm o processo Node rodando; não pagam esse custo de novo.
  **Round 4 finding 2 (major):** a v3 deste ADR citava um ponto fixo aqui (~530ms) que já não
  batia com o `results.json` daquela mesma revisão (584,8ms) nem foi reprodutível por um
  reviewer independente (426–579ms em 5 rodadas dele). Em vez de mais um ponto fixo fadado a
  ficar obsoleto na próxima re-execução, o argumento agora cita a FAIXA observada em dois
  artefatos comitados de rodadas independentes: **533,8ms** (round 2, execução única,
  `git show 7daf52b:measure/windows/icon-bench/results.json` → `startupMs: 533.8` — este número
  NÃO vem de `bench-repeat-results.json`, que ganhou `startupMs` agregado no round 4, commit
  `4287998`) e **554,9–1386,0ms** (round 4, 5 execuções, `bench-repeat-results.json`
  comitado em `4287998` — ver "Resultados medidos"). A ordem de grandeza — centenas de ms, não dezenas — é o
  que sustenta a rejeição, não o ponto exato, e essa ordem de grandeza se manteve estável entre
  os dois artefatos.
- O throughput agregado do pool vem de **paralelismo de 4 processos**, algo que addon/koffi não
  tiveram chance de exibir aqui — não foram testados sob paralelismo equivalente (ex.:
  `worker_threads`, múltiplos `utilityProcess`). Isso não foi medido; não reivindico que
  addon/koffi paralelos seriam mais rápidos ou mais lentos, só que a comparação atual não isola
  concorrência de eficiência de ponte, e por isso não decide a escolha. **Round 4 finding 2:**
  pela mesma razão do bullet acima, o número exato (6,98 ms/ícone no round 3, 6,45–8,31 ms/ícone
  nas 5 execuções do round 4) não é o que importa — o que importa é que é um throughput
  agregado de um dígito, produzido por concorrência, não uma latência por chamada síncrona
  comparável linha a linha com addon/koffi (ver "Resultados medidos" sobre essa distinção).
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
  o custo fixo de centenas de ms de startup amortiza — ver "Por que o pool PowerShell não vence"
  para a faixa medida em duas rodadas) — mas não é a ponte de PLAT-03.
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
node scripts/probe-addon.mjs                         # prova de 1 ícone via addon; alvo notepad.exe derivado de lib/probe-target.mjs, argv[2] (1º argumento) sobrescreve (round 5 finding 3)
node scripts/probe-koffi.mjs                         # prova de 1 ícone via koffi; alvo notepad.exe derivado de lib/probe-target.mjs, argv[2] (1º argumento) sobrescreve (round 5 finding 3)
node scripts/bench-repeat.mjs --runs 5 -- --passes 2 --pool 4   # 5 invocações independentes, grava bench-repeat-results.json — round 4 finding 3: agora também agrega startupMs e aggregateThroughputMsPerIcon por rodada, não só medianMs (a última rodada grava results.json também)
node scripts/verify.mjs                              # verificação independente pós-benchmark, grava verify-results.json
node scripts/verify-path-contract.mjs                # as 8 formas do contrato de path (round 3 finding 6, %VAR% par discriminador do round 4 finding 1), addon E koffi
node scripts/verify-lnk-encoding.mjs                 # regressão: .lnk com caractere não-ASCII + espaço resolve certo (round 3 finding 2)
node scripts/verify-pwsh-failure-modes.mjs            # cenários de falha do pool pwsh do round 2, comitados (round 3 finding 6); alvo notepad.exe derivado de lib/probe-target.mjs (round 4 finding 4)
node scripts/verify-com-apartment-clash.mjs           # cenário de apartment COM clash do Electron main-process (round 3 finding 6); alvo notepad.exe derivado de lib/probe-target.mjs (round 4 finding 4)
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

## Revisão round 4

Um quarto reviewer rigoroso rejeitou a v3 deste ADR com 5 achados (2 major, 3 minor). Todos os
cinco foram corrigidos nesta máquina, com comando executado e saída colada. Nenhum achado foi
contestado — todos procediam, confirmados rodando os próprios comandos/scripts que o reviewer
citou como evidência.

1. **[major] A linha `%VAR%` de `verify-path-contract.mjs` passava pelo motivo errado — não
   discriminava expansão de variável de ambiente.** Causa raiz: a linha prefixava
   `%ProgramFiles%\` (ou `%SystemRoot%` quando o path canônico caía sob `%SystemRoot%`) no path
   ABSOLUTO do app selecionado por `list-apps.mjs`. Nesta máquina esse app é Adobe Acrobat sob
   `C:\Program Files` (a regra 5 do script prefere deliberadamente um app com espaço no path),
   então o ramo `%SystemRoot%` nunca disparava e o fallback construía
   `%ProgramFiles%\C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe` — malformado com ou sem
   expansão, falhando com o MESMO `hr=0x80070002` nos dois casos. O ADR citava esse resultado
   não-discriminante como prova de que `%VAR%` não é expandido. Corrigido substituindo a linha
   por um par discriminador STANDALONE (ignora o app selecionado, sempre testa um alvo fixo):
   `%SystemRoot%\System32\notepad.exe` (deve falhar) e o mesmo alvo expandido à mão,
   `C:\Windows\System32\notepad.exe` (deve suceder — controle pareado exigido pelo finding).
   **Reproduzido nesta revisão:**
   ```
   [verify-path-contract]   %SystemRoot% (env var, must fail — not expanded): "%SystemRoot%\\System32\\notepad.exe"
   [verify-path-contract]   %SystemRoot% control (hand-expanded, must succeed): "C:\\Windows\\System32\\notepad.exe"
   [verify-path-contract] addon / %SystemRoot% (env var, must fail — not expanded): correctly REJECTED — SHCreateItemFromParsingName failed hr=0x80070002
   [verify-path-contract] addon / %SystemRoot% control (hand-expanded, must succeed): extraction OK (standalone target, not compared to canonical), 262144 bytes
   ```
   Agora a linha falha SE E SOMENTE SE a variável não for expandida — o par ao lado prova que o
   alvo em si (`notepad.exe`) é alcançável, isolando a variável como a única diferença entre as
   duas linhas. Ver "Método" seção "Contrato de path" para a tabela e o bloco de saída completos
   (addon E koffi, sem paráfrase).
2. **[major] A seção "Decisão" citava números de startup/throughput do pool PowerShell que já
   não batiam com o `results.json` comitado na MESMA revisão (v3), e nenhum dos dois era
   reproduzível.** Provei a divergência: `git show 7daf52b:measure/windows/icon-bench/results.json`
   dá `startupMs: 533.8, aggregateThroughputMsPerIcon: 6.98` (a rodada do round 2 que o texto da
   Decisão citava), enquanto o `results.json` comitado pela v3 (a mesma revisão que continha o
   texto "~530ms"/"6,98") já tinha `startupMs: 584.8, aggregateThroughputMsPerIcon: 6.52` — dois
   valores medidos diferentes para a mesma grandeza, no mesmo documento, nenhum deles citado
   corretamente. Corrigido de duas formas: (a) a seção "Decisão" agora argumenta pela ORDEM DE
   GRANDEZA (centenas de ms de startup; throughput agregado de um dígito de ms/ícone) em vez de
   um ponto fixo, citando a faixa observada nos artefatos comitados (533,8ms no round 2,
   `7daf52b:results.json`, execução única; 554,9–1386,0ms no round 4, `bench-repeat-results.json`,
   5 execuções — ver "Por que o pool PowerShell não vence"); (b)
   "Resultados medidos" foi re-executado nesta máquina (`bench-repeat.mjs --runs 5 -- --passes 2
   --pool 4`, mesmo comando documentado) e todo número derivado de `results.json`/
   `bench-repeat-results.json` no documento foi requotado a partir da execução NOVA, não deixado
   misturado com números de rodadas anteriores.
3. **[minor] `bench-repeat-results.json` só agregava `medianMs`, então um range de startup
   citado na prosa do ADR (423–702ms) não tinha artefato comitado pra verificar.** Corrigido em
   [`scripts/bench-repeat.mjs`](../../measure/windows/icon-bench/scripts/bench-repeat.mjs): a
   coleta por rodada agora também agrega `startupMs` e `aggregateThroughputMsPerIcon` de
   `candidates.pwsh` (os dois campos existentes em `results.json` que o texto do ADR cita), com
   mediana-das-medianas, min, max e spread iguais ao que já existia pra `medianMs` — gravado em
   `bench-repeat-results.json` sob `aggregate.pwsh.extra`. **Reproduzido nesta revisão** (ver
   "Resultados medidos" para a tabela completa): `pwsh.extra.startupMs.perRun` =
   `[1386, 613.1, 554.9, 747.7, 961.3]`, range 554,9–1386,0ms — este é o range agora citado no
   ADR, substituindo o "423–702ms" que nenhum artefato comitado sustentava.
4. **[minor] Dois scripts recém-comitados (`verify-pwsh-failure-modes.mjs`,
   `verify-com-apartment-clash.mjs`) hardcodavam `C:\Windows\System32\notepad.exe`, enquanto
   `verify-path-contract.mjs`, comitado no MESMO commit, já derivava de
   `process.env.SystemRoot`.** Corrigido extraindo a derivação pra um módulo compartilhado,
   [`lib/probe-target.mjs`](../../measure/windows/icon-bench/lib/probe-target.mjs) — puro
   `node:path`, zero outros imports, zero efeito colateral (`verify-com-apartment-clash.mjs`
   depende de controlar a PRIMEIRA chamada `CoInitializeEx` deste processo; um import
   transitivo de koffi/addon nesse módulo invalidaria o cenário que o script existe pra
   reproduzir). **Round 5 review (finding 3) apontou que a contagem "quatro" acima estava errada
   — só três scripts importavam `probeTargetPath`, e `probe-addon.mjs`/`probe-koffi.mjs` ainda
   tinham o literal `C:\Windows\System32\notepad.exe` hardcoded**, apesar de citados na sequência
   de "Reprodutibilidade" deste ADR. Corrigido migrando os dois: agora **cinco** scripts importam
   o mesmo `probeTargetPath` de `lib/probe-target.mjs` — `verify-path-contract.mjs`,
   `verify-pwsh-failure-modes.mjs`, `verify-com-apartment-clash.mjs`, `probe-addon.mjs` e
   `probe-koffi.mjs` (`grep -rln "probe-target" measure/windows/icon-bench/scripts
   measure/windows/icon-bench/lib` lista os cinco). `probe-addon.mjs`/`probe-koffi.mjs` mantêm o
   argv override (`process.argv[2] || probeTargetPath`) deliberadamente — são smoke probes de uso
   manual, não o discriminador de contrato de path — e o comentário no código agora diz isso
   explicitamente. **Reproduzido**: `node scripts/probe-addon.mjs` e `node scripts/probe-koffi.mjs`
   continuam imprimindo `PASS` depois da troca, e ambos continuam decodificando para `256x256`,
   confirmando que a substituição de string literal por `probeTargetPath` não mudou o
   comportamento observado. (Os tempos de extração dessa execução são uma rodada única não
   repetida — ver a saída colada na seção "Revisão round 5" finding 3 abaixo — e não são
   comparáveis às medianas/p95 de `bench-repeat.mjs`; não sustentam conclusão de velocidade
   relativa entre addon e koffi.)
5. **[minor] Um bloco do ADR rotulado "Saída real desta execução" continha uma linha resumida à
   mão que o script nunca imprime, e elidia saída real com "for ...".** Corrigido: o bloco na
   seção "Método"/"Contrato de path" agora cola as linhas reais de
   `=== addon vs koffi outcome per form ===` uma por uma (8 linhas, uma por forma — não uma
   linha resumida), e as três linhas do koffi que antes terminavam em "for ..." agora carregam
   o path completo que `SHCreateItemFromParsingName` reportou no erro, exatamente como impresso
   nesta execução.

Todos os cinco têm evidência colada nesta revisão (comando executado + saída real). Nenhum
achado foi contestado.

## Revisão round 5

Um quinto reviewer rigoroso rejeitou a v4 deste ADR com 5 achados (1 blocker, 2 major, 2 minor).
Todos os cinco foram corrigidos nesta máquina, com comando executado e saída colada. Todos
procediam quando verificados — nenhum foi contestado.

1. **[blocker] A seção "Decisão" afirmava que o empate addon-vs-koffi tinha sido reproduzido
   "semanas de sessões diferentes ... não só uma vez", enquanto as duas execuções citadas
   (`349a3fd` e `4287998`) são 55,1 minutos apart, no mesmo dia UTC, dentro da MESMA sessão de
   trabalho — o próprio documento já admitia isso em outro trecho ("a própria sessão de trabalho
   aqueceu o cache..."), uma contradição interna.** Verificado e confirmado:
   ```
   $ git show 349a3fd:measure/windows/icon-bench/bench-repeat-results.json | grep generatedAt
     "generatedAt": "2026-09-18T02:22:09.968Z",
   $ git show 4287998:measure/windows/icon-bench/bench-repeat-results.json | grep generatedAt
     "generatedAt": "2026-09-18T03:17:16.617Z",
   $ git log -1 --format="%H %ai" 349a3fd
   349a3fdb43ed27332eabad3780d7779cb00f0f95 2026-09-17 23:39:27 -0300
   $ git log -1 --format="%H %ai" 4287998
   42879987d0d37df03495ff700a51bca8909187c4 2026-09-18 00:23:05 -0300
   ```
   Delta = 55,1 min, mesmo dia UTC, mesma sessão — a frase "semanas de sessões diferentes" era
   falsa sob qualquer leitura. Corrigido removendo a cláusula de separação temporal e afirmando
   exatamente o que a evidência sustenta: duas re-execuções independentes do mesmo comando
   comitado (`bench-repeat.mjs --runs 5`), ~1h de intervalo NA MESMA sessão, com números
   diferentes mas a mesma ordenação qualitativa — e uma hedge explícita de que não há medição
   cross-sessão/cross-reboot deste ponto (ver "Decisão" acima). Nenhuma nova medição foi
   inventada para simular robustez cross-sessão: uma re-execução de `bench-repeat.mjs` depois de
   um reboot, em outra sessão, não foi executada nesta revisão; nenhuma robustez cross-sessão é
   afirmada — registrado como limitação, não preenchido com plausibilidade.
2. **[major] O número 533,8ms — âncora da rejeição do pool PowerShell — estava atribuído à
   rodada errada (round 3) e a um artefato que nunca teve esse campo (`bench-repeat-results.json`
   do round 3), com o ADR se contradizendo entre "round 3" (duas ocorrências) e "round 2" (uma
   terceira).** Verificado:
   ```
   $ git show 349a3fd:measure/windows/icon-bench/bench-repeat-results.json | grep -c 'startupMs\|extra\|aggregateThroughput'
   0
   $ git show 349a3fd:measure/windows/icon-bench/results.json | grep -i startupMs
         "startupMs": 0,
         "startupMs": 2.1,
         "note": "in-process N-API; startupMs is one-time module load (measured during the cold-baseline phase above); per-icon stats here are warm-cache steady-state"
         "startupMs": 10.5,
         "startupMs": 584.8,
         "perWorkerStartupMs": [
   $ git show 7daf52b:measure/windows/icon-bench/results.json | grep -i "startupMs\|aggregateThroughput"
         "startupMs": 0,
         "startupMs": 2.7,
         "note": "in-process N-API; startupMs is one-time module load (measured during the cold-baseline phase above); per-icon stats here are warm-cache steady-state"
         "startupMs": 8.1,
         "startupMs": 533.8,
         "perWorkerStartupMs": [
         "aggregateThroughputMsPerIcon": 6.98,
         "note": "median/p95 are PER-REQUEST round-trip latency at concurrency=4, EXCLUDING timed-out requests (a timeout measures the timeout constant, not the bridge); successRate's denominator is total attempts (successes+failures incl. timeouts), not sample count; aggregateThroughputMsPerIcon is wall-clock/app-count and is the number comparable to a single-icon-at-a-time cost"
   ```
   Confirma a leitura do reviewer: 533,8ms mora em `7daf52b:results.json` (round 2, execução
   única), não em `349a3fd` (round 3) nem em `bench-repeat-results.json` (que ganhou
   `startupMs` agregado no round 4, commit `4287998` — ver finding 3 da "Revisão round 4"
   acima). Corrigido nos dois call sites ("Por que o pool
   PowerShell não vence" e "Revisão round 4" finding 2): ambos agora dizem "533,8ms (round 2,
   `7daf52b:results.json`, execução única)" e nomeiam explicitamente qual artefato comitado
   sustenta cada ponta do range (533,8ms round 2 / 554,9–1386,0ms round 4).
3. **[major] "Revisão round 4" finding 4 afirmava que quatro scripts importavam
   `probeTargetPath`, listava três, dizia "os três scripts" duas frases depois, e dois outros
   scripts (`probe-addon.mjs`, `probe-koffi.mjs`) ainda tinham o literal hardcoded que o finding
   existia pra eliminar — apesar de citados na sequência de "Reprodutibilidade" deste ADR.**
   Verificado antes do fix (saída colada verbatim, não resumida):
   ```
   $ grep -rn 'probe-target' measure/windows/icon-bench/scripts measure/windows/icon-bench/lib
   measure/windows/icon-bench/scripts/verify-com-apartment-clash.mjs:19:import { probeTargetPath } from "../lib/probe-target.mjs";
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:24:// hand-expanded form succeeds. See lib/probe-target.mjs.
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:39:import { probeTargetPath } from "../lib/probe-target.mjs";
   measure/windows/icon-bench/scripts/verify-pwsh-failure-modes.mjs:24:import { probeTargetPath } from "../lib/probe-target.mjs";

   $ grep -rn 'notepad' measure/windows/icon-bench/scripts
   measure/windows/icon-bench/scripts/probe-addon.mjs:14:const target = process.argv[2] || "C:\\Windows\\System32\\notepad.exe";
   measure/windows/icon-bench/scripts/probe-koffi.mjs:13:const target = process.argv[2] || "C:\\Windows\\System32\\notepad.exe";
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:22:// %SystemRoot%\System32\notepad.exe target): one asserting the literal
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:87:    // always-present target (System32\notepad.exe) independent of which
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:93:    build: () => "%SystemRoot%\\System32\\notepad.exe",
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:99:    // could be failing for an unrelated reason, e.g. notepad.exe missing).
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:135:          // standalone rows probe a fixed target (notepad.exe), not the
   ```
   Só 3 importadores reais de `probeTargetPath`, e o literal sobrevivia em `probe-addon.mjs:14`
   e `probe-koffi.mjs:13`, exatamente como o reviewer apontou. O resto dos hits em
   `verify-path-contract.mjs` (linhas 22, 87, 99, 135) são comentários — mas a linha 93
   (`build: () => "%SystemRoot%\\System32\\notepad.exe"`) É um literal vivo, não comentário: é a
   forma `%SystemRoot%` não-expandida que a linha must-fail existe pra testar, e ela PRECISA
   continuar literal (não virar `probeTargetPath`) para a linha significar algo — trocá-la
   quebraria o próprio teste que ela implementa. Nenhum desses cinco hits é o `target` (a
   variável) de `probe-addon.mjs`/`probe-koffi.mjs`, que é o que este finding corrige.
   Corrigido migrando os dois scripts para `probeTargetPath` (com fallback `argv[2] ||
   probeTargetPath`, mantendo o override deliberado — são smoke probes de uso manual, não o
   discriminador de path-contract). Reproduzido depois da migração — os dois greps de novo, e os
   dois scripts rodados:
   ```
   $ grep -rn 'probe-target' measure/windows/icon-bench/scripts measure/windows/icon-bench/lib
   measure/windows/icon-bench/scripts/probe-addon.mjs:9:import { probeTargetPath } from "../lib/probe-target.mjs";
   measure/windows/icon-bench/scripts/probe-koffi.mjs:11:import { probeTargetPath } from "../lib/probe-target.mjs";
   measure/windows/icon-bench/scripts/verify-com-apartment-clash.mjs:19:import { probeTargetPath } from "../lib/probe-target.mjs";
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:24:// hand-expanded form succeeds. See lib/probe-target.mjs.
   measure/windows/icon-bench/scripts/verify-path-contract.mjs:39:import { probeTargetPath } from "../lib/probe-target.mjs";
   measure/windows/icon-bench/scripts/verify-pwsh-failure-modes.mjs:24:import { probeTargetPath } from "../lib/probe-target.mjs";

   $ grep -rnc 'notepad' measure/windows/icon-bench/scripts/probe-addon.mjs measure/windows/icon-bench/scripts/probe-koffi.mjs
   measure/windows/icon-bench/scripts/probe-addon.mjs:0
   measure/windows/icon-bench/scripts/probe-koffi.mjs:0
   ```
   O escopo do grep "depois" é só os dois arquivos migrados (não o diretório `scripts/` inteiro
   como "antes") de propósito: o grep largo continua batendo em `verify-path-contract.mjs`
   legitimamente (linha 93, o literal vivo explicado acima), então o grep estreito isola só os
   dois arquivos que este finding migrou, sem ruído dos hits legítimos de outro script.
   ```
   $ node scripts/probe-addon.mjs
   [probe-addon] extracting 256x256 from: C:\Windows\System32\notepad.exe
   [probe-addon] extract=113.6ms encode=7.7ms size=67187B -> C:\Users\MaxVision\Desktop\cursor-oficial\decktech\measure\windows\icon-bench\.tmp\probe-addon.png
   [probe-addon] independent decode check: 256x256
   [probe-addon] PASS
   $ node scripts/probe-koffi.mjs
   [probe-koffi] extracting 256x256 from: C:\Windows\System32\notepad.exe
   [probe-koffi] extract=60.2ms encode=6.8ms size=67187B -> C:\Users\MaxVision\Desktop\cursor-oficial\decktech\measure\windows\icon-bench\.tmp\probe-koffi.png
   [probe-koffi] independent decode check: 256x256
   [probe-koffi] PASS
   ```
   Agora **cinco** scripts importam `probeTargetPath` (6 hits no grep acima — 5 imports + 1
   comentário em `verify-path-contract.mjs`), contagem corrigida no texto (ver "Revisão round 4"
   finding 4 acima). O mesmo alvo `notepad.exe` continua nomeado nas linhas de
   `node scripts/probe-addon.mjs` / `node scripts/probe-koffi.mjs` na seção "Reprodutibilidade"
   deste ADR (não citando número de linha de propósito, pra não repetir o defeito deste próprio
   finding numa futura revisão que desloque o texto), agora corretamente descrito como derivado
   de `lib/probe-target.mjs` em todos os scripts que aparecem naquela sequência, incluindo
   `probe-addon.mjs`/`probe-koffi.mjs`.
4. **[minor] O controle pareado `%SystemRoot%` — a linha cujo propósito inteiro é provar que a
   linha must-fail discrimina — só afirmava "não lançou exceção"; o tamanho de 262144 bytes que
   o ADR cita como prova nunca era comparado a nada.** Corrigido em
   [`scripts/verify-path-contract.mjs`](../../measure/windows/icon-bench/scripts/verify-path-contract.mjs):
   (a) `EXPECTED_BGRA_BYTES = PROBE_ICON_SIZE * PROBE_ICON_SIZE * 4` agora é afirmado contra
   `bgra.length` no ramo standalone must-succeed, incrementando `failures` em caso de divergência
   — e `PROBE_ICON_SIZE` (256) é a MESMA constante passada pra `addon.extractIconBgra(p,
   PROBE_ICON_SIZE)`/`koffiExtract(p, PROBE_ICON_SIZE)`, não um segundo literal `256`
   independente do tamanho pedido de fato (o `size * size * 4` que o próprio finding pediu); (b)
   depois dos dois bridges rodarem, o script extrai o mesmo alvo fixo via addon E koffi e compara
   os bytes com `Buffer.compare` — um check de conteúdo real sem depender de um app canônico,
   como sugerido pelo finding. Reproduzido nesta máquina depois de trocar os dois literais `256`
   pela constante (`node scripts/verify-path-contract.mjs`, saída completa na seção
   "Método"/"Contrato de path" acima, byte-idêntica à saída antes da troca): `262144 bytes
   (expected 262144)` para os dois bridges, `byte-identical: true` na nova seção
   `=== standalone form addon/koffi
   byte-equality ===`, e o script termina com `PASS` — o comportamento observado não mudou, a
   força da asserção mudou.
5. **[minor] O cabeçalho do ADR listava "Data: 2026-09-18 (revisada 2026-09-17 ...)" — a data de
   criação aparecendo DEPOIS da data de revisão no texto, invertido em relação à ordem real
   (criado 2026-09-17 22:00:23, última revisão então 2026-09-18 00:23:05).** Corrigido
   substituindo a linha livre por entradas datadas explícitas em ordem cronológica direta, cada
   uma com o commit que a fez (ver linha "Data" no topo deste documento) — para que a próxima
   revisão (esta, round 5) não possa reintroduzir a inversão sem também reordenar uma lista
   explícita de commits, não uma frase de prosa solta.

Todos os cinco têm evidência colada nesta revisão (comando executado + saída real). Todos os
cinco procediam. Nenhum achado foi contestado.

## Revisão round 6

Um sexto reviewer rigoroso rejeitou a v5 deste ADR (commit `770b5d8`) com 2 achados (1 major,
1 minor). Ambos procediam quando verificados; nenhum foi contestado.

1. **[major] O fix do round 5 para uma citação de proveniência errada introduziu uma NOVA
   citação de proveniência errada da mesma classe: o ADR afirmava, em dois pontos, que
   `bench-repeat-results.json` só passou a agregar `startupMs` "nesta revisão, round 5", quando
   git prova que essa agregação chegou no round 4 (commit `4287998`), e o commit `770b5d8` (que
   introduziu a frase) nunca tocou nesse arquivo nem no script que o escreve.** Verificado antes
   do fix (saída colada verbatim):
   ```
   $ git show --stat 770b5d8 --format=""
    docs/adr/0001-proof-01-windows-icon-bridge.md      | 241 +++++++++++++++++++--
    measure/windows/icon-bench/scripts/probe-addon.mjs |   6 +-
    measure/windows/icon-bench/scripts/probe-koffi.mjs |   6 +-
    .../icon-bench/scripts/verify-path-contract.mjs    |  61 +++++-
    4 files changed, 286 insertions(+), 28 deletions(-)

   $ git show 4287998:measure/windows/icon-bench/bench-repeat-results.json | grep -c 'startupMs'
   4

   $ git log --oneline -- measure/windows/icon-bench/scripts/bench-repeat.mjs
   4287998 fix(measure): close round-4 review rejection of PROOF-01 icon bridge benchmark
   349a3fd fix(measure): close round-3 review rejection of PROOF-01 icon bridge benchmark

   $ git diff 4287998 HEAD --stat -- measure/windows/icon-bench/bench-repeat-results.json | wc -l
   0
   ```
   Confirma a leitura do reviewer: `770b5d8` não toca `bench-repeat-results.json` nem
   `bench-repeat.mjs`, e o arquivo já continha `startupMs` agregado (4 ocorrências) desde o
   commit `4287998` do round 4 — a mesma "Revisão round 4" finding 3 já credita corretamente
   (ver acima: "Corrigido em `scripts/bench-repeat.mjs`... **Reproduzido nesta revisão**...").
   A frase "só passou a agregar `startupMs` nesta revisão, round 5" nos dois call sites ("Por
   que o pool PowerShell não vence" e "Revisão round 5" finding 2) era falsa e contradizia o
   próprio documento. **Corrigido em ambos os call sites**, substituindo pela data real (round
   4, commit `4287998`) e apontando para a finding 3 da "Revisão round 4" que já a credita
   corretamente — sem alterar a alegação principal, que está correta e permanece: 533,8ms vem
   de `7daf52b:results.json`, não de `bench-repeat-results.json`.
2. **[minor] Números de uma única execução de `probe-addon.mjs`/`probe-koffi.mjs` foram
   promovidos da saída colada em bloco pra prosa argumentativa do ADR, num documento cujo
   capítulo de método argumenta que uma execução única é ruído e cuja conclusão principal é que
   addon e koffi empatam — e o par citado (113,6ms/60,2ms) lia como koffi quase 2x mais rápido
   que addon.** Re-executado nesta máquina para confirmar a variabilidade entre rodadas
   (saída colada verbatim):
   ```
   $ node scripts/probe-addon.mjs
   [probe-addon] extracting 256x256 from: C:\Windows\System32\notepad.exe
   [probe-addon] extract=82.2ms encode=7.1ms size=67187B -> C:\Users\MaxVision\Desktop\cursor-oficial\decktech\measure\windows\icon-bench\.tmp\probe-addon.png
   [probe-addon] independent decode check: 256x256
   [probe-addon] PASS
   $ node scripts/probe-koffi.mjs
   [probe-koffi] extracting 256x256 from: C:\Windows\System32\notepad.exe
   [probe-koffi] extract=53.3ms encode=8.9ms size=67187B -> C:\Users\MaxVision\Desktop\cursor-oficial\decktech\measure\windows\icon-bench\.tmp\probe-koffi.png
   [probe-koffi] independent decode check: 256x256
   [probe-koffi] PASS
   ```
   Nesta execução, addon=82,2ms e koffi=53,3ms — de novo koffi soa quase 1,5x mais rápido, um
   par DIFERENTE do que o ADR citava (113,6/60,2). O reviewer, na mesma máquina e no mesmo
   commit (`770b5d8`), reportou um TERCEIRO par ainda mais diferente — addon=95,1ms e
   koffi=91,3ms, quase empatado — na evidência do achado. Três execuções independentes do
   MESMO par de scripts, no mesmo hardware, produzindo três relações diferentes entre addon e
   koffi (empate quase exato / addon ~1,9x mais lento / addon ~1,5x mais lento) é a prova mais
   forte de que o número de uma execução única não é comparável entre si e não sustenta
   conclusão de velocidade relativa — mais forte que qualquer uma das três rodadas isoladas.
   Isso confirma o ponto do reviewer: promover um desses números pra prosa argumentativa é
   enganoso. **Corrigido**: a frase na seção "Revisão round 4" finding 4 agora só afirma o que
   o `**Reproduzido**` precisa provar — que os dois scripts continuam imprimindo `PASS` e
   decodificando pra `256x256` depois da troca de `probeTargetPath` — sem números de ms na
   prosa. O bloco cercado com a saída real completa (incluindo a linha de tempo) permanece
   intocado na seção "Revisão round 5" finding 3, onde já estava, com uma nota explícita de que
   é uma execução única não repetida, não comparável às medianas/p95 de `bench-repeat.mjs`.

Ambos os achados têm evidência colada nesta revisão (comando executado + saída real). Nenhum
achado foi contestado.

## Revisão round 7

Um sétimo reviewer rigoroso rejeitou a v6 deste ADR com 2 achados (1 blocker, 1 major). Ambos
procediam quando verificados; nenhum foi contestado.

1. **[blocker] `list-apps.mjs` encolhia silenciosamente a população benchmarcada quando uma
   raiz do Start Menu estava ausente/redirecionada ou uma subpasta era ilegível: reportava
   sucesso, passava por todo gate e escrevia um conjunto 30% menor, sem aviso, sem contador e
   exit 0 — a cadeia de proveniência do ADR (182 atalhos → 178 resolvidos → 140 únicos → 115
   `.exe`) podia silenciosamente ser uma cadeia diferente em outra máquina enquanto toda
   alegação do ADR ainda "passava".** Reproduzido pelo reviewer (saída colada verbatim):
   ```
   $ cd measure/windows/icon-bench && APPDATA="C:\Users\MaxVision\NoSuchRoamingDir" node scripts/list-apps.mjs
   [list-apps] enumerated 123 .lnk files in 6.7 ms
   [list-apps] roots: C:\ProgramData\... ; C:\Users\MaxVision\NoSuchRoamingDir\Microsoft\Windows\Start Menu\Programs
   [list-apps] resolved 103 apps total (all extensions)
   [list-apps] wrote 80 .exe-only deduped apps to ...\data\apps.json
   [list-apps] at least one path contains a space: true
   EXIT=0
   ```
   Três sites de perda silenciosa em `measure/windows/icon-bench/scripts/list-apps.mjs` (código
   pré-fix — os números de linha citados em revisões anteriores desta seção foram removidos na
   revisão round 8 por apontarem, no arquivo como commitado, para linhas não relacionadas ao
   defeito descrito; o trecho de código citado abaixo é a referência estável, não sujeita a essa
   deriva):
   `if (!existsSync(root)) return found;` (raiz ausente/redirecionada some sem registro);
   `try { entries = readdirSync(...); } catch { continue; }` (diretório ilegível — EACCES/EPERM,
   reparse point, redirecionamento de roaming — some sem mensagem nem contador);
   `process.env.APPDATA || "C:\\Users\\Default\\AppData\\Roaming"` (o perfil Default é um
   template de provisionamento, nunca o Start Menu de um usuário real, então um APPDATA não
   definido produzia um conjunto de apps plausível porém ERRADO em vez de um erro). O reviewer
   apontou que o padrão CORRETO já existia neste mesmo arquivo, três funções adiante:
   `unresolvedLnks` e `excludedResolvedTargets` já registram cada item descartado COM MOTIVO em
   `apps.json` — o que torna isto um gap, não uma escolha deliberada.

   **Corrigido** em `measure/windows/icon-bench/scripts/list-apps.mjs`:
   - `%ProgramData%` e `%APPDATA%` não têm mais fallback algum: se qualquer um estiver ausente,
     o script agora falha com um erro nomeado (`FATAL: %APPDATA% is not set — ...`) e `exit 1`,
     em vez de adivinhar um caminho. O comentário no código explica por que o fallback do
     `Default\AppData\Roaming` era especificamente perigoso (template de provisionamento, não
     um usuário real).
   - Uma raiz do Start Menu que não existe (`existsSync` falso) agora é fatal, checada ANTES de
     qualquer enumeração: o script lista as raízes ausentes e sai com `exit 1`.
   - `walkLnk()` agora retorna `{ found, unreadableDirs }`: todo `readdirSync` que lançar exceção
     durante a caminhada (path, `err.code`, `err.errno`, mensagem) é registrado em
     `unreadableDirs`, seguindo exatamente o padrão de `unresolvedLnks`/`excludedResolvedTargets`
     já presente no arquivo — `apps.json` ganhou `unreadableDirCount` e `unreadableDirs`, e o
     console imprime a contagem logo após a enumeração (não só no resumo final), para sobreviver
     a uma saída antecipada nos gates seguintes (`hasSpace`, lista vazia).
   - Decisão explícita, documentada em comentário no código: uma subpasta ilegível PROFUNDA na
     árvore é uma perda PARCIAL dentro de uma raiz que funciona — registrada, não fatal, para que
     uma pasta travada/EPERM isolada não mate o benchmark inteiro. Uma RAIZ ilegível (existe mas
     `readdirSync` lança — EACCES/EPERM/reparse point) é a MESMA perda total de população que uma
     raiz ausente, então também é fatal — checada logo após as duas caminhadas.

   **Reproduzido nesta revisão** — o comando exato do reviewer, mais as duas variantes de env var
   não definida, mais uma raiz ilegível REAL construída com `icacls /deny` (não simulada), mais um
   run limpo confirmando que a cadeia 182→178→140→115 do ADR não mudou:
   ```
   $ cd measure/windows/icon-bench && APPDATA="C:\Users\MaxVision\NoSuchRoamingDir" node scripts/list-apps.mjs; echo "EXIT=$?"
   [list-apps] FATAL: 1 Start Menu root(s) do not exist — cannot build a complete app list:
     - C:\Users\MaxVision\NoSuchRoamingDir\Microsoft\Windows\Start Menu\Programs
   [list-apps] a missing/redirected root would otherwise silently shrink the benchmarked population (round-7 review finding 1). Refusing to proceed.
   EXIT=1

   $ env -u APPDATA node scripts/list-apps.mjs; echo "EXIT=$?"
   [list-apps] FATAL: %APPDATA% is not set — cannot locate the per-user Start Menu root. Refusing to fall back to C:\Users\Default\AppData\Roaming (...)
   EXIT=1

   $ env -u ProgramData node scripts/list-apps.mjs; echo "EXIT=$?"
   [list-apps] FATAL: %ProgramData% is not set — cannot locate the machine-wide Start Menu root. Refusing to guess a fallback path.
   EXIT=1
   ```
   **Subpasta ilegível real (não uma raiz — retitulado na revisão round 8: este bloco, como
   originalmente rotulado "Raiz ilegível real", descrevia e mostrava a saída de uma SUBPASTA
   ilegível dentro de uma raiz que existe e é legível, não de uma raiz ilegível. Nenhum run da
   raiz ilegível aparecia nesta seção — ver o bloco "Raiz ilegível real (round 8)" logo abaixo,
   na Revisão round 8, para essa evidência que faltava):** `icacls <pasta> /deny
   'MaxVisionFPV\MaxVision:(RX)'` numa subpasta dentro de uma árvore `APPDATA` fake com um `.lnk`
   dummy, run com essa `APPDATA`:
   ```
   [list-apps] enumerated 123 .lnk files in 5.3 ms
   [list-apps] unreadable directories encountered during enumeration: 1 (path/code recorded in apps.json.unreadableDirs)
   [list-apps] unreadable directory count (enumeration-time, non-root): 1 (recorded with path/code in apps.json.unreadableDirs)
   [list-apps] wrote 80 .exe-only deduped apps to ...\data\apps.json (23 non-.exe targets excluded ...)
   EXIT=0
   ```
   Confirma a decisão: subpasta ilegível → registrada em `unreadableDirs`, não fatal, `exit 0`.
   O comportamento do outro ramo — raiz ausente/ilegível → fatal, `exit 1`, `apps.json` NÃO é
   reescrito — está confirmado para o caso "ausente" pelos três runs degradados acima (raiz que
   não existe / `APPDATA` não definido / `ProgramData` não definido, todos `exit 1` antes desta
   linha). O caso "raiz EXISTE mas é ilegível" (`readdirSync` lança na raiz, não numa subpasta)
   não tinha run nesta seção — essa lacuna é o que a Revisão round 8 abaixo fecha, com uma ACE de
   deny real aplicada à raiz em si, não a uma subpasta dela.

   Run limpo, máquina real, depois de reverter a árvore `APPDATA` fake:
   ```
   $ node scripts/list-apps.mjs; echo "EXIT=$?"
   [list-apps] enumerated 182 .lnk files in 9.5 ms
   [list-apps] unreadable directories encountered during enumeration: 0
   [list-apps] resolved 182 .lnk targets via single PowerShell/WScript.Shell process in 579.1 ms (3.18 ms/lnk amortized)
   [list-apps] resolved 140 apps total (all extensions); extension histogram: {"exe":115,"msc":9,"txt":2,"pdf":1,"url":6,"html":3,"htm":3,"chm":1}
   [list-apps] unresolved .lnk count (resolution itself failed/empty): 4
   [list-apps] resolved-but-excluded count (uninstaller/dedup/missing file): 38
   [list-apps] wrote 115 .exe-only deduped apps to ...\data\apps.json (25 non-.exe targets excluded ...)
   [list-apps] at least one path contains a space: true
   EXIT=0
   ```
   182 → 178 resolvidos (182 − 4 não-resolvidos) → 140 únicos (todas extensões) → 115 `.exe` —
   idêntico ao que o ADR já citava; `git diff --stat -- measure/windows/icon-bench/data/apps.json`
   mostra apenas os dois campos novos (`unreadableDirCount: 0`, `unreadableDirs: []`), os dois
   timings (`enumMs`, `resolveMs`) e `generatedAt` mudando — nenhum app, contagem ou motivo de
   exclusão mudou.

2. **[major] O commit `15c8155` tinha mensagem descrevendo uma edição de uma linha do cabeçalho
   deste ADR, mas o diff carregava 152 linhas não relacionadas de `docs/adr/0003-proof-03-lnk-binary-parsing.md`, violando a regra "stage only the files you intended" na mesma dimensão que o
   round 6 estava corrigindo; o cabeçalho do ADR então creditava o round 6 a um único commit
   quando o round 6 é dois commits.** Verificado (saída colada verbatim):
   ```
   $ git show -s --format='%H %ci' 8d3ab77 15c8155 e037bcb 1a17224
   8d3ab7773fa238d9d1a69d0ce57072b2ed710a08 2026-09-18 01:02:17 -0300
   15c81559606a59d200e3ce232e5a40987853a879 2026-09-18 01:03:05 -0300
   e037bcb1ce508132e1face79824227c4f1480de9 2026-09-18 01:04:17 -0300
   1a17224d177fc6781fef0b8d165cd31cdfce1dda 2026-09-18 01:05:09 -0300

   $ git show --stat 15c8155 --format=""
    docs/adr/0001-proof-01-windows-icon-bridge.md |   4 +-
    docs/adr/0003-proof-03-lnk-binary-parsing.md | 152 ++++++++++++++++++--------
    2 files changed, 106 insertions(+), 50 deletions(-)

   $ git diff d4daa7d e037bcb --stat -- docs/adr/0003-proof-03-lnk-binary-parsing.md
   (vazio — revert byte-a-byte confirmado)

   $ git diff 15c8155 1a17224 --stat -- docs/adr/0003-proof-03-lnk-binary-parsing.md
    docs/adr/0003-proof-03-lnk-binary-parsing.md | 5 +++--
    1 file changed, 3 insertions(+), 2 deletions(-)
   ```
   Confirma a leitura do reviewer: nenhum dado foi perdido (`e037bcb` reverteu byte-a-byte, e o
   dono da PROOF-03 recuperou o conteúdo correto em `1a17224`), mas o commit `15c8155` tem uma
   mensagem que não descreve seu próprio diff. Segunda metade do achado: o cabeçalho do ADR dizia
   "round 6 em 2026-09-18 01:02 (commit `8d3ab77`)" quando round 6 é dois commits — `8d3ab77`
   (01:02:17) e `15c8155` (01:03:05) — quebrando pela terceira vez o próprio propósito declarado
   da linha ("para que esta linha não volte a inverter a ordem numa próxima revisão").

   **Corrigido**: o cabeçalho (linhas 4-12) agora nomeia os dois commits do round 6
   (`8d3ab77` e `15c8155`) com a nota de mis-escopo e o revert. Em vez de tentar uma quarta
   correção pontual que quebraria de novo na próxima vez que um round citasse a si mesmo, o
   cabeçalho agora declara a restrição estrutural por escrito (um commit não pode citar o
   próprio hash) e move a responsabilidade de preencher a entrada de um round para o round
   SEGUINTE — exatamente como esta edição preencheu a do round 6. A entrada do round 7 (esta
   revisão) portanto não tenta se auto-citar; seu(s) commit(s) serão adicionados retroativamente
   na próxima revisão que tocar este arquivo. Não houve rebase nem reescrita de histórico — o
   commit `15c8155` mis-escopado permanece no histórico como está; apenas o texto do ADR foi
   corrigido para descrevê-lo com precisão. Processo adotado para este próprio commit de
   correção: `git commit --` com pathspec explícito, listando apenas os arquivos pretendidos, em
   vez de depender do índice compartilhado (que `git status` mostrava com arquivos não
   relacionados de outra tarefa em progresso).

Ambos os achados têm evidência colada nesta revisão (comando executado + saída real). Nenhum
achado foi contestado.

## Revisão round 8

Um oitavo reviewer rigoroso rejeitou a v7 deste ADR com 3 achados (2 major, 1 minor). Todos
procediam quando verificados; nenhum foi contestado.

1. **[major] O bloco da revisão round 7 rotulado "Raiz ilegível real (não uma raiz ausente)" não
   mostrava uma RAIZ ilegível — mostrava uma SUBPASTA ilegível (exit 0), e a conclusão duas
   linhas depois ("Raiz ausente/ilegível → fatal, exit 1") não tinha nenhum run do ramo
   raiz-ilegível por trás dela em lugar nenhum do ADR — a mesma classe de defeito que o round 4
   já havia rejeitado neste mesmo ADR ("um bloco rotulado 'saída real' continha uma linha... que
   o script nunca imprime").** O reviewer reproduziu o ramo faltante pessoalmente e colou a saída
   real: `icacls '<fake APPDATA>\...\Start Menu\Programs' /deny 'MaxVisionFPV\MaxVision:(RX)'`
   (na RAIZ, não numa subpasta) seguido de `node scripts/list-apps.mjs` produz
   `[list-apps] FATAL: 1 Start Menu root(s) exist but could not be read:` com `(EPERM)` e
   `EXIT=1`.

   **Corrigido**: o bloco da revisão round 7 foi retitulado para "Subpasta ilegível real (não uma
   raiz)" — sua saída real não mudou, só a legenda, que agora descreve corretamente o que o
   comando testou. Um novo bloco, abaixo, fecha a lacuna com um run real do ramo raiz-ilegível,
   construído do zero nesta revisão (não copiado da citação do reviewer, que era ilustrativa —
   reconstruído e observado nesta máquina):

   Setup (`.lnk` dummy dentro de uma árvore `APPDATA` fake, para isolar do Start Menu real):
   ```
   $ New-Item -ItemType Directory -Force -Path "$scratch\FakeAppData\Microsoft\Windows\Start Menu\Programs"
   $ "dummy" | Out-File "$scratch\FakeAppData\Microsoft\Windows\Start Menu\Programs\dummy.lnk" -Encoding ascii
   ```
   ACE de deny aplicada à RAIZ em si (não a uma subpasta dela — esta é a diferença do bloco
   acima):
   ```
   $ icacls $root /deny 'MaxVisionFPV\MaxVision:(RX)'
   arquivo processado: ...\FakeAppData\Microsoft\Windows\Start Menu\Programs
   Processados com sucesso 1 arquivos; falha no processamento de 0 arquivos
   $ icacls $root
   ...\Programs MaxVisionFPV\MaxVision:(DENY)(RX)
                S-1-5-21-...:(I)(OI)(CI)(M)
                ...
                MaxVisionFPV\MaxVision:(I)(OI)(CI)(F)
   ```
   (a linha `(I)(OI)(CI)(F)` herdada de mais embaixo na lista concede full control por herança,
   mas a DENY explícita no topo tem precedência na avaliação de ACL do Windows — confirmado pelo
   comportamento abaixo, não apenas assumido). Discriminação antes de aceitar o resultado, para
   não cair no MESMO erro do achado que este bloco está corrigindo (uma raiz ausente e uma raiz
   ilegível produzem mensagens diferentes — `do not exist` vs. `exist but could not be read` — e
   só a segunda é a alegação que faltava):
   ```
   $ node .../test-root-deny.mjs $root
   root arg: "C:\\Users\\MaxVision\\AppData\\Local\\Temp\\claude\\proof01-round8-scratch\\FakeAppData\\Microsoft\\Windows\\Start Menu\\Programs"
   existsSync: true
   readdirSync FAILED: EPERM -4048 EPERM: operation not permitted, scandir '...\Programs'
   ```
   `existsSync` verdadeiro + `readdirSync` falhando com `EPERM` é exatamente o ramo raiz-ilegível
   (não o ramo raiz-ausente, que teria `existsSync` falso). Run do `list-apps.mjs` real com
   `APPDATA` apontando para essa árvore:
   ```
   $ $env:APPDATA = "$scratch\FakeAppData"; node scripts/list-apps.mjs; echo "EXIT=$LASTEXITCODE"
   [list-apps] enumerated 123 .lnk files in 5.0 ms
   [list-apps] roots: C:\ProgramData\Microsoft\Windows\Start Menu\Programs ; C:\Users\MaxVision\AppData\Local\Temp\claude\proof01-round8-scratch\FakeAppData\Microsoft\Windows\Start Menu\Programs
   [list-apps] unreadable directories encountered during enumeration: 1 (path/code recorded in apps.json.unreadableDirs)
   [list-apps] FATAL: 1 Start Menu root(s) exist but could not be read:
     - C:\Users\MaxVision\AppData\Local\Temp\claude\proof01-round8-scratch\FakeAppData\Microsoft\Windows\Start Menu\Programs (EPERM)
   [list-apps] same reasoning as a missing root (round-7 review finding 1): proceeding on a partial read would silently guess the population. Refusing to proceed.
   EXIT=1
   ```
   Isso é exatamente a linha que faltava no round 7: "exist but could not be read" + `(EPERM)` +
   `EXIT=1` — o ramo raiz-ilegível, não o ramo raiz-ausente já documentado. `apps.json` não foi
   reescrito por este run (o `exit(1)` acontece antes de qualquer `writeFileSync`):
   ```
   $ git status --porcelain -- measure/windows/icon-bench/data/apps.json
   (sem saída — arquivo intocado)
   ```
   Limpeza da ACE de deny e confirmação de que a cadeia de proveniência não mudou:
   ```
   $ icacls $root /remove:d 'MaxVisionFPV\MaxVision'
   arquivo processado: ...\Programs
   Processados com sucesso 1 arquivos; falha no processamento de 0 arquivos
   $ Remove-Item Env:\APPDATA; $env:APPDATA = "C:\Users\MaxVision\AppData\Roaming"
   $ node scripts/list-apps.mjs; echo "EXIT=$LASTEXITCODE"
   [list-apps] enumerated 182 .lnk files in 10.0 ms
   [list-apps] unreadable directories encountered during enumeration: 0
   [list-apps] resolved 182 .lnk targets via single PowerShell/WScript.Shell process in 535.2 ms (2.94 ms/lnk amortized)
   [list-apps] resolved 140 apps total (all extensions); extension histogram: {"exe":115,"msc":9,"txt":2,"pdf":1,"url":6,"html":3,"htm":3,"chm":1}
   [list-apps] unresolved .lnk count (resolution itself failed/empty): 4
   [list-apps] resolved-but-excluded count (uninstaller/dedup/missing file): 38
   [list-apps] wrote 115 .exe-only deduped apps to ...\data\apps.json (25 non-.exe targets excluded ...)
   [list-apps] at least one path contains a space: true
   EXIT=0
   ```
   182 → 178 → 140 → 115, idêntico ao já citado no ADR: a cadeia de proveniência não mudou.

2. **[major] O achado do round 7 estava só meio fechado: uma SUBPASTA ilegível ainda encolhia
   silenciosamente a população benchmarcada até dentro do benchmark. `list-apps.mjs` sai com
   `exit 0` e sobrescreve o `data/apps.json` commitado com o conjunto encolhido, e `bench.mjs` —
   o único consumidor — nunca lê `unreadableDirCount`, então o campo de contabilidade era
   write-only. O dano exato que o blocker do round 7 apontava ("a cadeia de proveniência podia
   silenciosamente ser uma cadeia diferente em outra máquina enquanto toda alegação do ADR ainda
   passava") continuava intacto nesse caminho.** Verificado nesta revisão: `grep -n
   "unreadable|appsData\." measure/windows/icon-bench/scripts/bench.mjs` (antes do fix abaixo)
   retornava só três linhas — `appsData.hasSpaceInPath`, `appsData.apps`,
   `appsData.source`/`hasSpaceInPath` — nenhum gate em `unreadableDirCount` em lugar nenhum do
   harness.

   **Corrigido**, combinando as duas opções que o reviewer ofereceu (não escolhendo só uma):
   - `list-apps.mjs` agora grava `populationComplete: unreadableDirs.length === 0` em
     `apps.json` (campo novo, ao lado de `unreadableDirCount`).
   - `bench.mjs` lê esse campo logo após carregar `apps.json` e é fatal por padrão quando a
     população é incompleta — `populationComplete !== true` é tratado como incompleta, incluindo
     o caso do campo estar AUSENTE (um `apps.json` gerado por um `list-apps.mjs` pré-round-8):
     ausência não é tratada como "completo", exatamente o buraco que este achado descreve seria
     reproduzido se `undefined` fosse tratado como truthy.
   - `--allow-incomplete` é o opt-in explícito exigido pra rodar mesmo assim: sem a flag, `bench.mjs`
     sai com `exit 1` e um banner `*** INCOMPLETE POPULATION ***`; com a flag, o mesmo banner é
     impresso (deixando claro que é opt-in deliberado, não o caminho padrão), o benchmark roda, e
     `populationComplete`/`unreadableDirCountAtListTime`/`allowIncompleteFlag` são gravados em
     `results.json` — não só impressos no console — e o banner é reimpresso perto da SUMMARY
     TABLE, porque um banner só no início do log some acima de 300+ linhas de saída por
     candidato.
   - `list-apps.mjs` continua NÃO fatal para subpasta ilegível — essa decisão do round 7 não foi
     revisitada (não era o que este achado pedia); o gate fica inteiramente em `bench.mjs`.

   **Evidência dos três caminhos**, com `--limit 2 --passes 1` pra manter o custo baixo (essas
   rodadas de demonstração sobrescrevem `results.json` e `data/apps.json` — ambos restaurados ao
   fim, verificado abaixo):

   Caminho A — população completa, sem flag → prossegue (roda o benchmark completo, config real
   já vista nas seções anteriores do ADR; não repetido aqui por já estar coberto).

   Caminho B — população incompleta (`populationComplete: false`, `unreadableDirCount: 1`), sem
   `--allow-incomplete` → recusa:
   ```
   $ node scripts/bench.mjs --limit 2 --passes 1
   [bench] config: limit=2 measurePasses=1 poolSize=4 iconSize=256
   [bench] *** INCOMPLETE POPULATION *** apps.json.populationComplete=false (unreadableDirCount=1) — the benchmarked app set may be smaller than the real Start Menu contents.
   [bench] FATAL: refusing to benchmark an incomplete population. Re-run scripts/list-apps.mjs after fixing the unreadable directory, or pass --allow-incomplete to proceed deliberately (the incompleteness will be stamped into results.json and re-printed at the end).
   EXIT=1
   ```

   Caminho C — mesma população incompleta, com `--allow-incomplete` → prossegue, banner impresso
   duas vezes (carregamento + perto do SUMMARY TABLE), e o resultado gravado em `results.json`
   confirma o stamp:
   ```
   $ node scripts/bench.mjs --limit 2 --passes 1 --allow-incomplete
   [bench] *** INCOMPLETE POPULATION *** apps.json.populationComplete=false (unreadableDirCount=1) — ...
   [bench] --allow-incomplete given: proceeding anyway. This is a deliberate opt-in, not a default.
   ... (execução completa dos 4 candidatos, 2 apps cada) ...
   [bench] wrote full results to ...\results.json
   [bench] *** INCOMPLETE POPULATION *** this run used --allow-incomplete against an apps.json with populationComplete=false (unreadableDirCountAtListTime=1). The numbers below do not reflect the full real app set. See results.json.populationComplete.
   [bench] === SUMMARY TABLE ===
   ...
   EXIT=0

   $ node -e 'console.log(JSON.stringify({populationComplete: require("./results.json").populationComplete, unreadableDirCountAtListTime: require("./results.json").unreadableDirCountAtListTime, allowIncompleteFlag: require("./results.json").allowIncompleteFlag}))'
   {"populationComplete":false,"unreadableDirCountAtListTime":1,"allowIncompleteFlag":true}
   ```

   Caminho D (não pedido explicitamente pelo achado, mas necessário pra provar que "ausente" não
   é tratado como "completo") — `apps.json` sem o campo `populationComplete` (simula um arquivo
   gerado por um `list-apps.mjs` pré-round-8) → também recusa:
   ```
   $ node scripts/bench.mjs --limit 2 --passes 1
   [bench] *** INCOMPLETE POPULATION *** apps.json.populationComplete=undefined (unreadableDirCount=0) — ...
   [bench] FATAL: refusing to benchmark an incomplete population. ...
   EXIT=1
   ```

   Restauração e verificação de que nada da demonstração vazou pro estado commitado:
   ```
   $ git checkout -- measure/windows/icon-bench/results.json
   $ git status --porcelain -- measure/windows/icon-bench/results.json
   (sem saída — restaurado)
   $ git diff -- measure/windows/icon-bench/data/apps.json
   (apenas: +"populationComplete": true, mais enumMs/resolveMs/generatedAt atualizados pelo
   re-run limpo desta revisão — nenhum app, contagem ou exclusão mudou; `dedupedAppCount: 115`
   idêntico)
   ```

3. **[minor] A seção da revisão round 7 citava `list-apps.mjs:42`, `:47-50` e `:69` sem
   qualificador de versão; no arquivo como commitado (pós-fix), esses números apontam para
   comentários e para o próprio fix, não para o defeito descrito.** Verificado: `sed -n
   '42p;47,50p;69p' measure/windows/icon-bench/scripts/list-apps.mjs` no HEAD anterior a esta
   revisão (`0c772ba`) retorna comentário de prosa e a linha do fix (`unreadableDirs.push(...)`),
   não o código pré-fix citado no texto.

   **Corrigido**: os números de linha foram removidos da seção round 7 (não repinados a um
   commit específico — o exemplo de formato `1a17224:...` que o reviewer deu é ilustrativo, não
   um pin válido: `1a17224` nunca tocou `list-apps.mjs`, confirmado por `git log --oneline --
   measure/windows/icon-bench/scripts/list-apps.mjs` retornando apenas `0c772ba`, `349a3fd`,
   `2c8cc99`, `2ffab25`). O texto agora se apoia só no código citado entre crases, que não
   envelhece, seguindo a alternativa que o próprio achado ofereceu.

Todos os três achados têm evidência colada nesta revisão (comando executado + saída real).
Nenhum achado foi contestado.
