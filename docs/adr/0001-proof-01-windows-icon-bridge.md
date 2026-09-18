# ADR 0001: Ponte Node -> `IShellItemImageFactory` para ícones 256px no Windows

**Status:** Aceita
**Data:** 2026-09-18 (revisada 2026-09-17, round 2 de review — ver "Revisão round 2" abaixo)
**Requisito:** PROOF-01 (`.maxvision/REQUIREMENTS.md`, Fase 0)
**Máquina de medição:** Windows 11 Pro 10.0.22631, x64, Node v25.5.0, VS Build Tools 2022
(17.14.37411.7) com componente C++ x64, Windows SDK 10.0.26100.0, Python 3.13.13

> **Nota sobre esta revisão:** um round de review rigoroso rejeitou a primeira versão deste
> ADR — a "verificação independente" era auto-referencial (comparava a saída do encoder contra
> a própria constante que o harness passou pro encoder, certificando qualquer coisa, inclusive
> ruído), o pool PowerShell travava silenciosamente sem reportar falha, o addon vencedor
> rejeitava paths que o fallback koffi aceitava, argumentos de CLI inválidos viravam
> `results.json` cheio de `null`, o erro de `CoInitializeEx` perdia o HRESULT, 8 atalhos
> desapareciam do conjunto sem registro, e a composição do conjunto de apps incluía
> `.msc`/`.url`/`.html`/etc. embora o texto dissesse "resolvidos ao alvo `.exe`". Todos os sete
> achados foram corrigidos com evidência re-executada nesta máquina; a seção "Revisão round 2"
> ao final detalha cada um. **Os números na tabela de "Resultados medidos" abaixo já são da
> re-execução pós-correção** (111 apps `.exe`-only, N=222 amostras/candidata) — não da rodada
> original de 136 apps que o round 1 mediu.

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
  [`scripts/list-apps.mjs`](../../measure/windows/icon-bench/scripts/list-apps.mjs): **182
  atalhos** enumerados → **174 resolvidos** a um `TargetPath` não-vazio via um único processo
  PowerShell reaproveitando um `WScript.Shell` COM → **8 não-resolvidos** (`TargetPath` veio
  vazio — atalho aponta pra uma URL ou pasta virtual do shell, ex. "Firefox Navegação
  Privada.lnk"; registrados COM motivo em `apps.json.unresolvedLnks`, round 2 finding 6) → dos
  174 resolvidos, **38 excluídos** por dedup de target normalizado / padrão de desinstalador /
  arquivo ausente em disco (registrados em `apps.json.excludedResolvedTargets`) → **136
  resolvidos e únicos, todas as extensões**. **Composição real por extensão** (round 2 finding
  7 — o texto anterior deste ADR dizia "resolvidos ao alvo `.exe`", o que era falso pra 25/136):
  `exe: 111, msc: 9, url: 6, html: 3, htm: 3, txt: 2, chm: 1, pdf: 1`. `.msc`/`.url`/`.html`
  etc. roteiam por provedores de thumbnail, não pelo caminho de ícone de app que `PLAT-03`
  chama — então o conjunto **benchmarcado é filtrado a `.exe`-only: 111 apps**, e a composição
  completa (incluindo os 25 excluídos, com nome e extensão de cada um) fica auditável em
  `apps.json.extensionHistogramAllResolved` / `apps.json.excludedNonExeTargets`. Persistido em
  [`data/apps.json`](../../measure/windows/icon-bench/data/apps.json), com a fonte gravada no
  próprio arquivo. Pelo menos um path benchmarcado contém espaço
  (`C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe`) — verificado em código, o script
  recusa rodar sem isso (regra de path do Windows, item 5 das regras não-negociáveis).
- **Controle:** candidata `control` roda o mesmo loop, mesmo encode de PNG, mesma escrita em
  disco — mas com um buffer RGBA fixo, sem chamar a API real. Isola o custo do harness em si.
- **Custo de startup separado do custo por ícone:**
  - addon N-API: carga do módulo `.node` medida uma vez (~2,7 ms), separada do custo em regime.
  - koffi: custo de primeira chamada (carga de DLL + `CoInitializeEx` + 1ª extração) medido uma
    vez (~8,1 ms), separado do regime.
  - pool PowerShell: **spawn dos processos + compilação `Add-Type` do C# de interop COM**,
    medido até TODOS os workers sinalizarem prontos — ~534 ms para um pool de 4 (~511–533 ms
    por worker, compilando em paralelo). Este número **não** é diluído nas amostras por ícone.
- **Cache de ícone do shell do Windows é por arquivo, não por ponte.** As três candidatas
  chamam a mesma API COM sobre os mesmos arquivos; se cada candidata rodasse sua própria
  passada "fria" sobre os 111 apps em sequência, a primeira pagaria o custo real de cache miss
  e todas as seguintes pareceriam artificialmente mais rápidas só por herdar o cache do thumbcache
  já aquecido pela candidata anterior — um viés de ordem, não uma diferença de ponte. Correção:
  o custo frio é pago **uma única vez**, com uma ponte arbitrária (o addon), **antes** do loop de
  candidatas. As candidatas então são comparadas com o cache já aquecido para todos, isolando o
  que de fato diferencia uma ponte da outra: overhead de marshalling/IPC, não sorte de cache.
- **Repetições:** 1 passada de aquecimento por candidata (descartada, aquece JIT/V8 do laço) +
  2 passadas medidas de 111 apps = **N=222 amostras por candidata**. Mediana e p95 reportados,
  não só a média.
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
  coisas, sobre as **111 apps benchmarcadas, não uma amostra:**
  1. Decodifica os PNGs de addon/koffi/pwsh para cada uma das 111 apps com o decodificador do
     .NET (`System.Drawing.Bitmap`, via
     [`pwsh/verify.ps1`](../../measure/windows/icon-bench/pwsh/verify.ps1)) — um caminho de
     código que NENHUM dos três bridges usa pra ESCREVER o PNG — e compara os bytes BGRA
     decodificados addon-vs-koffi e addon-vs-pwsh, byte a byte. **Resultado real, medido, não
     estimado:** 111/111 apps concordam, e o delta MÁXIMO GLOBAL observado — addon vs koffi E
     addon vs pwsh, nas 111 apps, não uma amostra — é **0** (`verify-results.json ->
     globalMaxDeltaObserved: 0`, `perBridgeMaxDeltaObserved: {"koffi":0,"pwsh":0}`). Os três
     bridges produzem pixels **byte-idênticos** em todo o conjunto benchmarcado, inclusive pwsh
     apesar de usar o encoder PNG do próprio .NET — a tolerância de `AGREEMENT_MAX_DELTA = 2`
     configurada em `verify.mjs` existe como margem de segurança e nunca foi de fato exercitada
     nesta execução (correção sobre uma versão anterior deste texto, que citava "1–2/255"
     herdado do comentário do reviewer sem reexecutar a medição).
  2. Duas checagens **diagnósticas, que NÃO decidem pass/fail** (só `disagreeCount`, a
     concordância de pixels do item 1, decide isso — ver
     `verify-results.json.sanityChecksAreDiagnosticOnly`): variância do canal alfa (pega um
     bitmap uniforme/em branco) e fração de preenchimento do bounding-box de conteúdo (pega um
     blob minúsculo num canto em vez de um ícone real). Resultado: 0/111 apps com bbox quase
     vazio; 7/111 com variância de alfa baixa, todos com `bboxFillFraction: 1` (preenchem o
     frame inteiro) — nomeados em `verify-results.json.lowAlphaVarianceApps`: Antigravity IDE,
     MSYS2 CLANG64/CLANGARM64/MINGW64/MSYS/UCRT64, NVIDIA App. **Inspecionei visualmente 3
     desses 7** (Antigravity IDE, MSYS2 CLANG64, NVIDIA App, lendo os PNGs em
     `.tmp/cache/addon/{10,54,63}.png` diretamente) — são de fato ícones com fundo sólido opaco
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
  literal dos dois lados. **Cada forma do contrato abaixo foi executada nesta máquina contra o
  addon real** (não assumida a partir da documentação do `GetFullPathNameW`), via
  [`scripts/verify-path-contract.mjs`](../../measure/windows/icon-bench/scripts/verify-path-contract.mjs)
  (barra normal / relativo, sobre um app real com espaço no path) e um script de teste ad hoc
  pontual pras demais formas (espaço/ponto finais, `%VAR%`, aspas, sufixo `,<índice>` — todas
  contra `C:\Windows\System32\notepad.exe`, `addon.extractIconBgra(path, 256)` direto):

  | Forma | Resultado real | O que confirma |
  |---|---|---|
  | canônico (barra invertida, absoluto) | sucesso | baseline |
  | barra normal (`C:/Windows/...`) | sucesso, pixel-idêntico ao canônico | `/` → `\` |
  | relativo (`..\..\...`) | sucesso, pixel-idêntico ao canônico | resolvido contra o CWD |
  | espaço à direita (`notepad.exe `) | sucesso | espaço final removido |
  | ponto à direita (`notepad.exe.`) | sucesso | ponto final removido |
  | `%SystemRoot%\...` | **falha**, hr=`0x80070002` (arquivo não encontrado) | `%VAR%` **NÃO** é expandido — tratado como texto literal |
  | `"C:\Windows\...\notepad.exe"` (com aspas) | **falha**, hr=`0x80070057` (argumento inválido) | aspas **NÃO** são removidas |
  | `notepad.exe,0` (sufixo de índice de registro) | **falha**, hr=`0x80070002` (arquivo não encontrado) | sufixo `,<índice>` **NÃO** é removido |

  As três últimas linhas falham DE PROPÓSITO — confirmam o que o contrato NÃO cobre, não um bug:
  quem chamar `realIconService` com um valor `DisplayIcon` de registro precisa expandir
  `%VAR%` (`ExpandEnvironmentStringsW`), remover aspas e cortar o sufixo `,<índice>` **antes**
  de passar o path pro addon — esse pré-processamento não existe ainda porque `PLAT-03` (o
  consumidor) é uma fase futura; fica registrado como requisito explícito da interface, não como
  suposição. Saída real do caso de harness permanente (barra normal / relativo):
  ```
  addon / forward-slash: extraction OK, pixel-identical to canonical: true
  addon / relative: extraction OK, pixel-identical to canonical: true
  koffi / forward-slash: extraction OK, pixel-identical to canonical: true
  koffi / relative: extraction OK, pixel-identical to canonical: true
  ```
  O worker PowerShell (.NET `SHCreateItemFromParsingName` via P/Invoke direto, não via
  `WScript.Shell`) foi testado à parte com o mesmo path de barra normal e **também falhou**
  (`SHCreateItemFromParsingName hr=0x80070057`) até receber a forma com barra invertida — ou
  seja, o comportamento de não-normalizar é o PADRÃO do próprio Win32 P/Invoke .NET, não um bug
  específico do addon; `pwsh` não precisou de correção porque não é a ponte escolhida e o
  requisito do path-contract não se aplica a ele (`PLAT-03` não vai chamar pwsh).
- **O que "sucesso" significa nos 100% abaixo, precisamente:** a chamada não lançou exceção
  **e** uma checagem barata em processo (`looksBlank`, amostra ~200 pixels e compara contra o
  primeiro) não achou um bitmap uniforme. Isso pega crash, HRESULT de erro e retorno em branco —
  **não** pega uma imagem não uniforme porém errada (ex.: ícone genérico do Windows em vez do
  ícone real do app). A garantia de correção pixel a pixel vem da verificação independente
  pós-benchmark (`scripts/verify.mjs`, sobre as 111 apps — ver bullet "Verificação independente"
  acima) e da inspeção visual manual, não da taxa de 100%.
- **Assimetria de encoder entre pwsh e as outras duas, registrada, não escondida:** addon e
  koffi compartilham o mesmo caminho JS (`bgraToRgba` + `lib/png.mjs`) depois de extrair os
  pixels — o mesmo ícone produz o mesmo PNG byte a byte nos dois. O worker PowerShell usa o
  encoder de PNG do próprio .NET (`Bitmap.Save(..., ImageFormat.Png)`) e escreve o arquivo
  dentro do processo PowerShell, não no Node. Isso significa que o número do pwsh inclui um
  encoder diferente, e os números de addon/koffi incluem uma transformação BGRA→RGBA em JS que o
  pwsh não paga do lado Node. A candidata `control` (mediana 1,46 ms, ver tabela abaixo) limita
  o tamanho desse efeito: é o teto do que "laço + encode + escrita em disco" custa nesta
  máquina, bem abaixo da diferença de ~15 ms entre addon e pwsh — a assimetria de encoder não é
  grande o suficiente para explicar a diferença observada entre candidatas. `scripts/verify.mjs`
  confirma isso diretamente e mais fortemente do que eu esperava: o delta de pixel decodificado
  addon-vs-pwsh é **0** (byte-idêntico) em todas as 111 apps, não uma diferença pequena mas
  não-zero (ver "Verificação independente" acima e `globalMaxDeltaObserved` em
  `verify-results.json`) — a assimetria de encoder existe no código (caminhos diferentes) mas
  não produz nenhuma diferença de pixel mensurável nesta máquina.

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

**Estes números são da re-execução pós-correção do round 2** (ver "Revisão round 2" ao final):
conjunto `.exe`-only de 111 apps (não mais 136 de todas as extensões — finding 7), addon com
normalização de path (finding 3), pwsh-pool com timeout/tratamento de morte de processo
(finding 2), `verify.mjs` rodado separadamente e passando (finding 1). Cache do shell aquecido
para todas as candidatas (ver "Método" acima). N=222 por candidata (111 apps × 2 passadas
medidas), 100% de sucesso em todas as quatro linhas, 0 timeouts no pool PowerShell.

| Candidata | mediana (ms) | p95 (ms) | média (ms) | min–max (ms) | startup (uma vez) |
|---|---:|---:|---:|---:|---:|
| controle (harness only) | 1,46 | 2,12 | 1,59 | 1,37–4,94 | 0 |
| **N-API addon** | **9,89** | **16,27** | 10,72 | 6,56–27,37 | 2,7 ms (carga do módulo) |
| **koffi (FFI)** | **11,72** | **18,99** | 12,30 | 6,96–35,86 | 8,1 ms (DLL + `CoInitializeEx` + 1ª chamada) |
| pool PowerShell (4 processos) | 25,56 (latência por request) | 49,33 | 27,01 | 11,01–70,78 | **533,8 ms** (spawn + compile `Add-Type` de 4 workers) |

Pool PowerShell, throughput agregado com concorrência=4 (tempo de parede da passada de 111 apps
÷ 111, média de 2 passadas): **6,98 ms/ícone**. Este número reflete paralelismo de 4 processos
simultâneos, não custo por chamada — não é comparável linha a linha com a mediana de
addon/koffi, que são chamadas síncronas de um processo só. Ver "Decisão" sobre por que isso não
decide a escolha.

**Baseline frio, agnóstico de ponte** (medido uma única vez, com o addon, antes de qualquer
candidata tocar os arquivos — ver "Método"): N=111, mediana **21,62 ms**, p95 **54,75 ms**,
média 26,24 ms, 100% sucesso. Mais rápido que os 43,2 ms/ícone medidos anteriormente em
`WINDOWS-STACK.md` §6.2. **Não investiguei a causa exata da diferença** — candidatas honestas,
nenhuma confirmada (esta hedge é intencionalmente mantida idêntica à v1 deste ADR — a re-execução
do round 2 não investigou essa causa de novo, e não upgradeio a incerteza pra fato só porque
os números mudaram de 136→111 apps):
1. o conjunto de apps mudou (122 → 111, filtrado a `.exe`-only no round 2 — finding 7) e o
   cache de thumbnail do Windows pode já estar mais quente hoje por uso normal da máquina;
2. **mais provável que as duas anteriores:** a própria sessão de trabalho aqueceu o cache antes
   da medição "fria" valer esse nome — outras rodadas de benchmark, probes e testes de path
   contract já tinham tocado boa parte deste mesmo conjunto de apps antes desta medição. Isso
   significa que o "baseline frio" reportado aqui é um limite superior otimista do custo real de
   primeiro-scan do PLAT-03 (que roda numa sessão do DeckTech recém-aberta, sem esse aquecimento
   prévio), não uma medição de cache verdadeiramente frio. Registro isso como "não validei a
   causa", não como fato — e sinalizo que o número frio provavelmente subestima o pior caso real.

**Números vêm de uma execução real nesta máquina**, comandos exatos na seção
"Reprodutibilidade" abaixo. A rodada original do round 1 (136 apps de todas as extensões,
N=272, sem a normalização de path do finding 3, sem os fixes de timeout do finding 2) mediu
addon em 10,82 ms e koffi em 12,07 ms medianos — a leitura não muda entre rodadas: addon e
koffi seguem estatisticamente próximos entre si (a ordem nem se mantém estável de uma rodada
pra outra) e ambos claramente mais baratos que o pool PowerShell por chamada.

## Decisão

**N-API addon**, com `koffi` como caminho de fallback documentado se o toolchain nativo deixar
de estar disponível num ambiente de build futuro. **Pool PowerShell é rejeitado** como ponte de
produção.

### Por que addon e koffi empatam em velocidade e isso não decide

Suas medianas (9,89 ms vs 11,72 ms nesta rodada pós-round-2; 10,82 ms vs 12,07 ms na rodada do
round 1) ficam dentro da faixa de ruído uma da outra — a ordem entre as duas nem se manteve
estável de uma rodada para a outra, o que por si só mostra que a diferença não é um sinal
confiável de que uma ponte é mais rápida que a outra em regime. Isso é
esperado: as duas chamam exatamente a mesma API COM (`IShellItemImageFactory::GetImage`) e o
grosso do tempo é gasto dentro do shell do Windows, não na travessia FFI/N-API. O discriminador
real não é ms/ícone — é risco de manutenção e forma de falha, que os dois bugs acima tornam
concreto, não hipotético:

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
  10–22 ms/ícone × 111 apps seria ~1,1–2,4 s se feito em série e bloqueante.
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
node scripts/list-apps.mjs                          # gera data/apps.json a partir desta máquina
cd addon-icon && ../node_modules/.bin/node-gyp clean && ../node_modules/.bin/node-gyp configure build && cd ..
node scripts/probe-addon.mjs                         # prova de 1 ícone via addon
node scripts/probe-koffi.mjs                         # prova de 1 ícone via koffi
node scripts/bench.mjs --passes 2 --pool 4           # benchmark completo, grava results.json
node scripts/verify.mjs                              # verificação independente pós-benchmark, grava verify-results.json
node scripts/verify-path-contract.mjs                # caso de harness do finding 3 (barra normal / path relativo)
```

`node-gyp clean` antes de `configure build`: nesta máquina, um `node-gyp build` incremental
depois de editar `icon_addon.cc` falhou de forma reprodutível com `LNK1103: depurando
informação corrompida` (informação de debug incremental corrompida do MSVC) — `clean` antes
de cada build evita isso; documentado aqui porque me custou tempo de diagnóstico durante o
round 2 e não é óbvio pela mensagem de erro.

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
