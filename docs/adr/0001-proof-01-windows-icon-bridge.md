# ADR 0001: Ponte Node -> `IShellItemImageFactory` para ícones 256px no Windows

**Status:** Aceita
**Data:** 2026-09-18
**Requisito:** PROOF-01 (`.maxvision/REQUIREMENTS.md`, Fase 0)
**Máquina de medição:** Windows 11 Pro 10.0.22631, x64, Node v25.5.0, VS Build Tools 2022
(17.14.37411.7) com componente C++ x64, Windows SDK 10.0.26100.0, Python 3.13.13

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

- **Conjunto de apps real:** 136 apps, gerado por
  [`scripts/list-apps.mjs`](../../measure/windows/icon-bench/scripts/list-apps.mjs) —
  enumeração de `.lnk` em `%ProgramData%\Microsoft\Windows\Start Menu\Programs` +
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs` (182 atalhos), resolvidos ao alvo `.exe`
  via um único processo PowerShell reaproveitando um `WScript.Shell` COM, deduplicados por
  target path normalizado, com desinstaladores óbvios (`unins*.exe`, `uninstall*`) excluídos.
  Persistido em [`data/apps.json`](../../measure/windows/icon-bench/data/apps.json), com a
  fonte gravada no próprio arquivo. Pelo menos um path benchmarcado contém espaço
  (`C:\Program Files\Adobe\Acrobat DC\Acrobat\Acrobat.exe`) — verificado em código, o script
  recusa rodar sem isso (regra de path do Windows, item 5 das regras não-negociáveis).
- **Controle:** candidata `control` roda o mesmo loop, mesmo encode de PNG, mesma escrita em
  disco — mas com um buffer RGBA fixo, sem chamar a API real. Isola o custo do harness em si.
- **Custo de startup separado do custo por ícone:**
  - addon N-API: carga do módulo `.node` medida uma vez (~5 ms), separada do custo em regime.
  - koffi: custo de primeira chamada (carga de DLL + `CoInitializeEx` + 1ª extração) medido uma
    vez (~7 ms), separado do regime.
  - pool PowerShell: **spawn dos processos + compilação `Add-Type` do C# de interop COM**,
    medido até TODOS os workers sinalizarem prontos — ~410 ms para um pool de 4 (~404 ms
    por worker, compilando em paralelo). Este número **não** é diluído nas amostras por ícone.
- **Cache de ícone do shell do Windows é por arquivo, não por ponte.** As três candidatas
  chamam a mesma API COM sobre os mesmos arquivos; se cada candidata rodasse sua própria
  passada "fria" sobre os 136 apps em sequência, a primeira pagaria o custo real de cache miss
  e todas as seguintes pareceriam artificialmente mais rápidas só por herdar o cache do thumbcache
  já aquecido pela candidata anterior — um viés de ordem, não uma diferença de ponte. Correção:
  o custo frio é pago **uma única vez**, com uma ponte arbitrária (o addon), **antes** do loop de
  candidatas. As candidatas então são comparadas com o cache já aquecido para todos, isolando o
  que de fato diferencia uma ponte da outra: overhead de marshalling/IPC, não sorte de cache.
- **Repetições:** 1 passada de aquecimento por candidata (descartada, aquece JIT/V8 do laço) +
  2 passadas medidas de 136 apps = **N=272 amostras por candidata**. Mediana e p95 reportados,
  não só a média.
- **Verificação independente:** cada PNG produzido é checado por um decodificador que não é o
  nosso: `System.Drawing.Image.FromFile` (.NET), confirmando 256×256. Feito por amostragem (não
  nas 272 amostras — chamar o .NET por processo é caro) mais inspeção visual manual de ícones
  variados (Notepad, Acrobat, Illustrator, Blender, um ícone de sistema) via leitura direta dos
  PNGs gerados.
- **O que "sucesso" significa nos 100% abaixo, precisamente:** a chamada não lançou exceção
  **e** uma checagem barata em processo (`looksBlank`, amostra ~200 pixels e compara contra o
  primeiro) não achou um bitmap uniforme. Isso pega crash, HRESULT de erro e retorno em branco —
  **não** pega uma imagem não uniforme porém errada (ex.: ícone genérico do Windows em vez do
  ícone real do app). A garantia de correção pixel a pixel vem da amostra verificada
  independentemente (spot check acima) e da inspeção visual manual, não da taxa de 100%.
- **Assimetria de encoder entre pwsh e as outras duas, registrada, não escondida:** addon e
  koffi compartilham o mesmo caminho JS (`bgraToRgba` + `lib/png.mjs`) depois de extrair os
  pixels — o mesmo ícone produz o mesmo PNG byte a byte nos dois. O worker PowerShell usa o
  encoder de PNG do próprio .NET (`Bitmap.Save(..., ImageFormat.Png)`) e escreve o arquivo
  dentro do processo PowerShell, não no Node. Isso significa que o número do pwsh inclui um
  encoder diferente, e os números de addon/koffi incluem uma transformação BGRA→RGBA em JS que o
  pwsh não paga do lado Node. A candidata `control` (mediana 1,53–1,64 ms, ver tabela abaixo)
  limita o tamanho desse efeito: é o teto do que "laço + encode + escrita em disco" custa nesta
  máquina, bem abaixo da diferença de ~9 ms entre addon/koffi e pwsh — a assimetria de encoder
  não é grande o suficiente para explicar a diferença observada entre candidatas.

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

Cache do shell aquecido para todas as candidatas (ver "Método" acima). N=272 por candidata
(136 apps × 2 passadas medidas), 100% de sucesso em todas as quatro linhas.

| Candidata | mediana (ms) | p95 (ms) | média (ms) | min–max (ms) | startup (uma vez) |
|---|---:|---:|---:|---:|---:|
| controle (harness only) | 1,53 | 2,19 | 1,66 | 1,33–4,26 | 0 |
| **N-API addon** | **10,82** | **18,60** | 11,66 | 6,78–29,50 | 5,1 ms (carga do módulo) |
| **koffi (FFI)** | **12,07** | **20,50** | 12,81 | 7,20–36,40 | 7,2 ms (DLL + `CoInitializeEx` + 1ª chamada) |
| pool PowerShell (4 processos) | 19,87 (latência por request) | 36,74 | 21,67 | 8,32–66,14 | **414,1 ms** (spawn + compile `Add-Type` de 4 workers) |

Pool PowerShell, throughput agregado com concorrência=4 (tempo de parede da passada de 136 apps
÷ 136, média de 2 passadas): **5,50 ms/ícone**. Este número reflete paralelismo de 4 processos
simultâneos, não custo por chamada — não é comparável linha a linha com a mediana de
addon/koffi, que são chamadas síncronas de um processo só. Ver "Decisão" sobre por que isso não
decide a escolha.

**Baseline frio, agnóstico de ponte** (medido uma única vez, com o addon, antes de qualquer
candidata tocar os arquivos — ver "Método"): N=136, mediana **23,07 ms**, p95 **56,63 ms**,
média 26,70 ms, 100% sucesso. Mais rápido que os 43,2 ms/ícone medidos anteriormente em
`WINDOWS-STACK.md` §6.2. **Não investiguei a causa exata da diferença** — candidatas honestas,
nenhuma confirmada:
1. o conjunto de apps mudou (122 → 136, máquina em uso contínuo desde a medição original) e o
   cache de thumbnail do Windows pode já estar mais quente hoje por uso normal da máquina;
2. **mais provável que as duas anteriores:** a própria sessão de trabalho aqueceu o cache antes
   da medição "fria" valer esse nome — antes de rodar o benchmark completo, os scripts
   `probe-addon.mjs`/`probe-koffi.mjs` já haviam extraído o ícone do Notepad, e duas rodadas de
   fumaça (`--limit 6`, `--limit 15`) já haviam tocado um subconjunto dos mesmos 136 apps. Isso
   significa que o "baseline frio" reportado aqui é um limite superior otimista do custo real de
   primeiro-scan do PLAT-03 (que roda numa sessão do DeckTech recém-aberta, sem esse aquecimento
   prévio), não uma medição de cache verdadeiramente frio. Registro isso como "não validei a
   causa", não como fato — e sinalizo que o número frio provavelmente subestima o pior caso real.

**Números vêm de uma reprodução em ambiente limpo.** Esta tabela é da segunda execução completa
do benchmark, depois de apagar `node_modules/`, `addon-icon/build/` e `results.json` e repetir
exatamente os comandos da seção "Reprodutibilidade" abaixo — não da primeira execução usada para
depurar o harness. Uma primeira rodada (descartada desta tabela, mas com a mesma conclusão)
mediu addon em 9,35 ms e koffi em 9,70 ms medianos; a variação de ~1–2 ms entre rodadas é
esperada (carga da máquina, scheduler) e não muda a leitura: addon e koffi seguem
estatisticamente equivalentes entre si e ambos claramente mais baratos que o pool PowerShell por
chamada, rodada após rodada.

## Decisão

**N-API addon**, com `koffi` como caminho de fallback documentado se o toolchain nativo deixar
de estar disponível num ambiente de build futuro. **Pool PowerShell é rejeitado** como ponte de
produção.

### Por que addon e koffi empatam em velocidade e isso não decide

Suas medianas (10,82 ms vs 12,07 ms nesta rodada; 9,35 ms vs 9,70 ms na rodada anterior) ficam
dentro da faixa de ruído uma da outra — a ordem entre as duas nem se manteve estável de uma
rodada para a outra, o que por si só mostra que a diferença não é um sinal confiável de que uma
ponte é mais rápida que a outra em regime. Isso é
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

- **~410 ms de custo de startup fixo** — compilar C# via `Add-Type` é caro e não amortiza para
  uma extração pontual (ex.: usuário adiciona 1 app novo ao dock depois do scan inicial). Um
  addon ou koffi já têm o processo Node rodando; não pagam esse custo de novo.
- O throughput agregado de 5,50 ms/ícone vem de **paralelismo de 4 processos**, algo que
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
  11–23 ms/ícone × 136 apps seria ~1,5–3,1 s se feito em série e bloqueante.
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
  o custo fixo de ~410 ms amortiza) — mas não é a ponte de PLAT-03.
- `PLAT-09` (cache de ícone persistente) reduz a relevância de todas essas medições de "custo
  por scan": com cache em disco quente, PLAT-03 paga o custo medido aqui só uma vez por
  app/tema, não a cada abertura do DeckTech.

## Reprodutibilidade

```
cd measure/windows/icon-bench
npm install
node scripts/list-apps.mjs                          # gera data/apps.json a partir desta máquina
cd addon-icon && ../node_modules/.bin/node-gyp configure build && cd ..
node scripts/probe-addon.mjs                         # prova de 1 ícone via addon
node scripts/probe-koffi.mjs                         # prova de 1 ícone via koffi
node scripts/bench.mjs --passes 2 --pool 4           # benchmark completo, grava results.json
```
