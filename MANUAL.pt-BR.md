[English](MANUAL.md) | Português (Brasil)

# Manual do DeckTech

Este manual corresponde ao DeckTech v0.1.1. Ele explica o que o DeckTech faz, como instalar e conectar o celular e o que cada toque, cada tecla e cada atalho faz. Se algo no seu aparelho for diferente do que está escrito aqui, fale com o [suporte](SUPPORT.pt-BR.md).

## O que é o DeckTech

O DeckTech deixa o seu celular comandar os apps do computador. Ele roda no computador (Windows ou macOS), mostra no celular um painel de teclas e age no computador quando você toca em uma tecla.

- O painel tem 40 teclas, em 5 páginas de 8, em todos os planos.
- Cada tecla abre um app, abre um site ou troca uma cena do OBS Studio. Com o DeckTech PRO, uma tecla também pode acionar um item da casa.
- No Android, você usa o app. No iPhone, no iPad e em outros navegadores, você usa o painel web: não há app nativo para iPhone.
- Os recursos grátis não pedem conta. Computador e celular conversam pela sua rede local.

## Requisitos

- Computador: Windows 10 ou 11 (64 bits, x64, build 10240 ou superior) ou macOS 14 ou superior. Windows 7, 8, 8.1 e Windows de 32 bits não são suportados.
- Celular: Android 5.0 ou superior para o app; iPhone e outros navegadores usam o painel web.
- Computador e celular na mesma rede local (Wi-Fi ou Ethernet). O app Android também aceita o mesmo Tailscale. Uma VPN comum não serve para parear.
- Para a gaveta do OBS: o OBS Studio aberto no mesmo computador que roda o DeckTech.
- Para o DeckTech PRO: internet no computador, ou em outro aparelho, para ativar e verificar a licença.

## Instalar

Atualizando da v0.1.0: o contrato de licença (EULA 1.1) precisa ser aceito de novo no computador e no app Android. Até o aceite no computador, o servidor não inicia e o celular não se conecta.

Os passos completos, os links de download e a conferência de checksums estão no [README](README.pt-BR.md#instalação-e-primeira-execução). Em resumo:

### Windows

1. Baixe `DeckTech-Setup.exe` na [página de versões](https://github.com/produtoramaxvision/DeckTech/releases/latest) e execute.
2. O instalador não tem assinatura de código, então o SmartScreen pode avisar. Confira se o arquivo veio do repositório oficial e se o SHA-256 confere. Só então escolha **Mais informações** e **Executar assim mesmo**.
3. Na primeira abertura, marque a caixa do contrato de licença e escolha **Aceitar e começar**. **Recusar e sair** fecha o app, e o contrato aparece de novo na próxima abertura.
4. Abra a aba **Conectar**: ela mostra o endereço local e o código de acesso de seis dígitos.

A janela do DeckTech no Windows está em português. O painel do celular segue o idioma do aparelho.

### macOS

1. Baixe `DeckTech-macOS.dmg`, abra a imagem e arraste o DeckTech para **Aplicativos**.
2. O app não é notarizado. Abra com o botão direito em **DeckTech** e **Abrir**. Se o Gatekeeper bloquear, use **Ajustes do Sistema > Privacidade e Segurança > Segurança > Abrir Mesmo Assim**.
3. Aceite o contrato de licença e abra a aba **Conectar**. No macOS, essa aba tem um seletor de idioma (Português/English).

### Android

1. Baixe `decktech.apk`, autorize a instalação quando o Android pedir e aceite o contrato de licença.
2. No computador, abra **Conectar > App Android** e escaneie o QR com a câmera do telefone.
3. Se o app mostrar um código de segurança de 16 caracteres, confirme só se for igual, caractere por caractere, ao **Código de segurança** da aba **Conectar**.
4. Digite o código de acesso de seis dígitos.

### iPhone, iPad e navegador

1. No computador, abra **Conectar > Navegador**.
2. No Safari ou em outro navegador, escaneie o QR ou digite o endereço local mostrado.
3. Digite o código de acesso. No Safari, **Compartilhar > Adicionar à Tela de Início** instala o painel como um app.

Essa conexão usa HTTP, sem criptografia. Use só em uma rede local em que você confia.

O [tutorial rápido](https://decktech.com.br/tutorial-decktech) mostra os mesmos passos em seis cartões.

## Parear o celular

O código de acesso tem seis dígitos e fica na aba **Conectar** do computador, em **Código de acesso**.

1. Abra o painel no celular (app Android, ou o endereço da aba **Conectar** no navegador).
2. Digite os seis dígitos. Ao digitar o sexto, o painel conecta sozinho. Tocar em **Conectar** ou apertar Enter também funciona.
3. Para trocar o código, toque em **Gerar novo código** no computador e confirme em **Gerar novo código?**. Os dispositivos conectados precisarão digitar o novo código.

Se o código não for aceito, o painel diz o motivo: **Código inválido** (menos de seis dígitos), **Código errado.** ou **Muitas tentativas — aguarde {s}s.** Depois de 5 códigos errados seguidos, o computador bloqueia as tentativas daquele aparelho por um tempo, a partir de 60 segundos. Os detalhes estão em [Solução de problemas](SUPPORT.pt-BR.md#solução-de-problemas).

Com o celular deitado, o cartão de entrada tem duas colunas: os passos à esquerda e, à direita, o campo do código e o botão **Conectar**. Com o teclado aberto, o cartão se reduz ao campo e ao botão lado a lado, com a mensagem de erro embaixo. No app Android, a tela do código de acesso fica sempre em retrato; depois de conectar, o app volta a seguir a rotação do aparelho.

O painel usa o idioma do navegador ou do aparelho: português quando o idioma começa com pt, inglês nos demais casos.

## O painel

O painel mostra as teclas em 5 páginas de 8. Cada tecla tem o ícone e o nome do app, do site, da cena ou do item. Uma tecla de app que está aberta no computador mostra o texto **aberto**.

- **Abrir.** Toque na tecla. O app abre ou vem para a frente; o site abre no computador. Se o sistema não deixar trazer a janela para a frente, o DeckTech abre uma nova janela do app e avisa: **Não consegui focar "{name}" — abri uma nova instância**.
- **Mudar de página.** Deslize para o lado sobre as teclas. Um deslize rápido troca de página; arrastando devagar, a página muda quando você passa de cerca de um quinto da largura.
- **Ir para Apps abertos.** Deslize para cima, role o mouse para baixo ou toque no ponto de baixo da barra de dois pontos na lateral direita. Para voltar às teclas, deslize para baixo, role para cima ou toque no ponto de cima.
- **Adicionar.** As teclas de app, de site e de item PRO são adicionadas pela janela do DeckTech no computador (veja abaixo). Pelo celular, só se fixa uma cena do OBS, com a estrela da gaveta.
- **Remover.** No celular, segure uma tecla de app, de site ou PRO comum por cerca de meio segundo. Aparece **Remover dos favoritos?** (para um site, **Remover website dos favoritos?**), com **Cancelar** e **Remover**. O app continua instalado no computador. Numa tecla de cena do OBS ou numa tecla que pede confirmação, segurar pode fazer outra coisa: veja **Teclas de cena** e o guia de gestos.
- **Reorganizar.** Só pela janela do computador.

### Adicionar, remover e reorganizar pela janela do computador

No Windows, a janela tem três abas na lateral: **Slots**, **Conectar** e **PRO**.

- Em **Slots**, as cinco páginas aparecem de uma vez, como **Tela 1** a **Tela 5**, com o número de posições em uso.
- Para adicionar, clique no **+** de uma posição vazia (**Adicionar app nesta posição**). O seletor abre com as abas **Apps**, **Sites** e **PRO**. Em **Apps**, busque em **Buscar apps...** e clique em **Adicionar**. Em **Sites**, digite o endereço, o **Nome do site** e clique em **Adicionar**.
- Para remover, passe o mouse sobre a tecla (ou foque nela com o teclado) e clique em **Remover**, ou aperte Delete ou Backspace. O DeckTech pergunta **Remover dos favoritos?** e só remove depois do seu **Remover**.
- Para reorganizar, clique em **Reorganizar apps**, arraste as teclas (ou use as setas do teclado) e clique em **Concluir**. Soltar uma tecla sobre outra troca as duas de lugar.

No macOS, a janela tem as mesmas abas. Passe o mouse sobre uma tecla e clique em **Remover**, ou clique com o botão direito e escolha **Remover do Dock**; a remoção é imediata, sem pergunta. Em **Reorganizar apps**, arraste o ícone para a nova posição e clique em **Concluir**. Os botões PRO são configurados no navegador: a aba **PRO** do seletor leva até lá com **Abrir no navegador**.

Com as 40 posições ocupadas não dá para adicionar outra tecla. Ao fixar uma cena pelo celular, o aviso é **Limite de 5 páginas atingido**. Sem nenhuma tecla, a aba **Slots** mostra **Seu dock está vazio** e o botão **Adicionar app**.

## Apps abertos

Deslize para cima no painel para ver a tela **Apps abertos**. Cada cartão é uma janela aberta no computador. Ele mostra o ícone, o título da janela, o nome do app, o monitor (por exemplo, **Monitor 1**) e o estado: **em foco**, **segundo plano** ou **minimizada**. Quando nada está aberto, a tela diz **Nada aberto ainda — abra um app no computador para ele aparecer aqui**.

- Toque no cartão para trazer a janela para a frente. Toque de novo, com a janela em foco, para minimizar.
- Dois toques rápidos, um logo depois do outro, abrem uma nova janela do app.
- Segure o cartão por cerca de meio segundo para fechar a janela. O painel pergunta **Fechar janela?** e avisa que alterações não salvas podem ser perdidas. Só fecha depois de **Fechar janela**.
- Arraste a fileira de cartões para o lado para ver os que não cabem na tela.

O primeiro toque age depois de uma fração de segundo, para o DeckTech saber se vem um segundo toque.

Na mesma tela fica o cartão **OBS**, que mostra o estado do OBS e abre a gaveta do OBS.

## OBS Studio

A gaveta **OBS Commander** troca cenas, grava, transmite e fixa cenas no painel. O OBS Studio precisa estar aberto no mesmo computador que roda o DeckTech.

### Conectar

1. No OBS, abra **Ferramentas › Configurações do servidor WebSocket**.
2. Marque **Ativar servidor WebSocket** (porta 4455).
3. Mantenha **Habilitar autenticação** marcado e clique em **Mostrar informações da conexão**.
4. Copie a senha, abra a gaveta do OBS no painel, cole em **Senha do WebSocket do OBS** e toque em **Salvar e conectar**.

A senha fica só no computador; o celular não a recebe de volta. Mais detalhes, inclusive porta diferente de 4455, no [README](README.pt-BR.md#obs-studio).

O cartão **OBS** e a gaveta mostram o estado da conexão: **conectado**, **verificando…**, **sem senha**, **senha incorreta**, **WebSocket desligado** ou **OBS offline**. Com o OBS conectado, a engrenagem da gaveta (**Conexão e senha do OBS**) mostra ou esconde o campo da senha; sem conexão, o campo já aparece aberto. **Limpar senha** remove a senha salva.

### A gaveta

- Toque no cartão **OBS** em **Apps abertos** para abrir a gaveta. O ✕ no canto fecha a gaveta.
- No alto, o cartão da cena no programa mostra o selo **PROGRAMA** (nada em andamento), **GRAVANDO** (durante a gravação) ou **AO VIVO** (só durante a transmissão).
- **Modo de exibição**: **Lista**, **Colunas** ou **Abas**. Em **Abas**, as cenas ficam em **Cenas · n** e as fontes em **Fontes · n**.
- Toque numa cena para colocá-la no programa.
- A estrela ao lado de cada cena fixa a cena como tecla do painel; tocar na estrela de novo tira a tecla. Os dois gestos oferecem **Desfazer**.
- Em **Abas**, a estrela do alto (**Escolher cenas para o dock**) liga o modo de fixar: toque nas cenas que viram tecla e toque na estrela de novo para concluir.
- **Gravar** e **Live** ligam e desligam a gravação e a transmissão na hora. Com a gravação ligada, o rótulo vira **Parar**; com a transmissão ligada, vira **Parar live**.
- **Encerrar** para o que estiver em andamento e sempre pergunta antes. O título muda conforme o caso: **Parar gravação?**, **Encerrar live?** ou **Encerrar transmissão?** (as duas). Fica indisponível quando nada está gravando nem ao vivo.

### Teclas de cena

Uma cena fixada vira uma tecla no painel, com uma faixa que mostra o estado da cena.

- Fora de uma transmissão ao vivo, tocar na tecla troca para a cena.
- A tecla de uma cena que não é a que está no ar fica travada durante uma transmissão ao vivo e também enquanto o painel ainda não sabe se há transmissão. Um toque só explica como trocar; para trocar, segure a tecla (Shift+Enter no teclado).
- Depois de trocar por uma tecla travada, se havia outra cena no programa, uma mensagem oferece **Desfazer**, também com Ctrl+Z ou Cmd+Z. O Desfazer devolve a cena anterior ao ar, a menos que o programa já tenha mudado. Enquanto o **Desfazer** está na tela, outra mensagem espera ele sair; um aviso de erro aparece na hora, no lugar dele.
- Se o OBS está desligado, um toque diz **OBS offline**. Se o OBS não tem mais a cena, diz **A cena "nome" não existe mais no OBS**.
- Para tirar a tecla do painel, toque de novo na estrela da cena, na gaveta do OBS. Fora de uma transmissão ao vivo, segurar a tecla abre **Remover dos favoritos?**. Durante uma transmissão, ou enquanto o painel não sabe se há uma, segurar nunca remove: na tecla travada, troca de cena.

## DeckTech PRO

O DeckTech PRO acrescenta o controle de casa inteligente e outras integrações. É uma licença de pagamento único, sem mensalidade e sem conta. Os recursos grátis continuam grátis e nunca dependem da licença.

### Comprar

A compra é feita na [seção de preços do site](https://decktech.com.br/#preco), com cartão ou Pix, pelo checkout da Stripe. Os dois planos incluem todos os recursos do PRO; o que muda é o número de aparelhos: 1 computador mais 1 aparelho, ou 1 computador mais 3 aparelhos. Para mais aparelhos, escreva para [contato@decktech.com.br](mailto:contato@decktech.com.br). Os [Termos do DeckTech PRO](https://decktech.com.br/termos-pro) valem para a compra.

### Ativar

1. Depois do pagamento, o código da licença aparece na página de agradecimento e chega por e-mail.
2. No computador, abra a aba **PRO** da janela do DeckTech, escolha **Colar código da licença**, cole o código e continue.
3. A ativação leva alguns segundos e precisa de internet. Sem internet no computador, use **Ativar sem internet**: copie o pedido de ativação, abra a página indicada em outro aparelho com internet (o QR da tela leva até ela), gere o código de ativação e cole-o de volta no computador.

### Aparelhos

O plano limita quantos aparelhos usam o PRO ao mesmo tempo. Cada computador ativado ocupa um lugar. Um celular, tablet ou navegador pareado só ocupa um lugar quando alguém usa um recurso PRO nele. Na aba **PRO**, a lista **Aparelhos com PRO** mostra quem ocupa um lugar e deixa **Remover do PRO** para liberar. **Liberar este computador** tira o PRO do computador e libera o lugar dele.

Um celular sem lugar vê **Este celular ainda não tem um lugar no PRO**.

### Sem internet

Depois de ativado, o PRO funciona sem internet. O DeckTech verifica a licença sozinho nos dias em que há internet. Se um computador ficar 15 dias seguidos sem concluir uma verificação, o PRO fica em pausa nele, até uma verificação bem-sucedida: **Verificar agora** com internet, ou **Renovar sem internet** por outro aparelho. Os recursos grátis e as configurações salvas não são afetados.

### Desistência

Você pode desistir da compra em até 7 dias depois de receber a licença, mesmo que já tenha ativado ou usado o PRO. Use a página [arrependimento](https://decktech.com.br/arrependimento). Depois que você confirmar pelo e-mail, a devolução do valor total é solicitada à Stripe. Com a devolução total, a licença é cancelada. Os termos completos estão na cláusula 9 dos [Termos do DeckTech PRO](https://decktech.com.br/termos-pro).

## Integrações do PRO

Todas ficam na aba **PRO** da janela do computador. Para pôr uma tecla no painel, clique no **+** de uma posição vazia em **Slots**, abra a aba **PRO** do seletor, escolha a origem (**Home Assistant**, **Philips Hue** ou **Atalhos da Apple**), filtre pelo nome, escolha o item, defina a **Ação ao tocar:**, dê o **Nome do botão no deck** e clique em **Adicionar**. O PRO precisa estar ativo.

### Home Assistant

Controle itens do seu Home Assistant pelas teclas do painel, na rede local.

1. Em **PRO**, no cartão **Home Assistant**, clique em **Procurar Home Assistant na rede** e escolha o que apareceu. Ou clique em **Digitar o endereço manualmente**, informe o endereço (por exemplo, `http://homeassistant.local:8123`) e, se preferir, um **Código de acesso de longa duração (opcional)**, e clique em **Conectar com este endereço**.
2. Sem esse código, uma página de autorização do Home Assistant abre no navegador: entre por lá e confirme o acesso.
3. Na seção **Testar conexão**, **Testar agora** aciona uma luz ou um interruptor para confirmar a comunicação. Fechaduras e portões não aparecem no teste.

O estado do item aparece na tecla (por exemplo, **Ligado**, **Desligado**, **Aberto**, **Trancado**) e se atualiza sozinho. Estes são os tipos aceitos e as ações de cada um; qualquer outro tipo não aparece:

| Tipo | Aparece como | Ações ao tocar | Observação |
|---|---|---|---|
| `light` | Luz | Alternar, Ligar, Desligar | |
| `switch` | Interruptor | Alternar, Ligar, Desligar | Inclui tomadas |
| `input_boolean` | Interruptor | Alternar, Ligar, Desligar | |
| `fan` | Ventilador | Alternar, Ligar, Desligar | |
| `scene` | Cena | Ativar | |
| `script` | Script | Executar | |
| `button` | Botão | Pressionar | |
| `input_button` | Botão | Pressionar | |
| `cover` | Persiana | Alternar | Cobertura motorizada: persiana, porta ou portão. Pede para segurar |
| `lock` | Fechadura | Trancar, Destrancar | Nunca alterna. Pede para segurar |
| `media_player` | Mídia | Alternar | Reproduz ou pausa |

Fechaduras e coberturas motorizadas exigem segurar a tecla para confirmar (veja o guia de gestos). As ações do Home Assistant para fechaduras e coberturas não podem ser acionadas pelo acesso remoto das ações expostas.

A validação em um Home Assistant OS e Mosquitto reais ainda está pendente.

### Aparecer no Home Assistant

O cartão **Aparecer no Home Assistant** mostra no Home Assistant, como botões e interruptores, as ações que você escolher: ações do computador, gravação, transmissão e cenas do OBS Studio. Ele usa um servidor MQTT que você já tem, como o Mosquitto: informe o endereço e as credenciais desse servidor. Nada é exposto por padrão. A validação em um Home Assistant OS e Mosquitto reais ainda está pendente.

### Ações expostas e códigos de acesso

O cartão **Ações expostas e códigos de acesso** controla quais ações do painel outros aparelhos e programas da sua rede local podem acionar. Você escolhe até 100 ações com **Adicionar ação** e cria um código de acesso para cada sistema com **Criar código**. O código aparece uma única vez: copie na hora. Esses códigos são diferentes do código de acesso de seis dígitos do pareamento. Ações acionadas por outro aparelho ainda não foram testadas em aparelhos reais.

### Philips Hue (Beta)

Controle luzes, cômodos e cenas direto por uma ponte Hue na rede local. Em **PRO**, clique em **Procurar ponte Hue na rede** (ou digite o endereço), aperte o botão redondo da ponte quando o DeckTech pedir e use **Testar agora**, na seção **Testar conexão**. A validação em uma ponte física ainda está pendente.

### Atalhos da Apple

Um botão executa um atalho pelo nome. No Mac, o atalho roda direto no computador (**Neste computador**). No iPhone, o botão abre o atalho no próprio iPhone em que foi tocado (**No iPhone**), e o atalho precisa existir lá com exatamente o mesmo nome. O Windows não executa Atalhos da Apple. A validação em um Mac e um iPhone reais ainda está pendente.

### Alexa

A conexão com a Alexa não está disponível nesta versão. O cartão **Conectar com a Alexa** mostra **Indisponível** e não oferece nada para conectar. Ela precisa do serviço online da MaxVision, da certificação da skill pela Amazon e de uma atualização futura do DeckTech; não há data prometida. A página [Usar com a Alexa](https://decktech.com.br/ajuda-alexa) descreve como a conexão vai funcionar.

## Guia de gestos e ações

As tabelas abaixo reúnem tudo o que cada superfície aceita. "Cerca de meio segundo" e "quase um segundo" são tempos fixos do programa.

### Celular: painel

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Tocar numa tecla de app | Abre o app no computador ou o traz para a frente | Computador conectado |
| Tocar numa tecla de site | Abre o site no computador | Computador conectado |
| Segurar uma tecla de app ou de site por cerca de meio segundo | Abre **Remover dos favoritos?** (ou **Remover website dos favoritos?**) | Soltar antes, ou mover o dedo, cancela |
| Enter ou Espaço numa tecla com foco | Igual a tocar | Teclado ligado ao aparelho |
| Deslizar para o lado sobre as teclas | Muda de página (5 páginas de 8) | Deslize rápido, ou arraste de cerca de um quinto da largura |
| Deslizar para cima | Vai para **Apps abertos** | Nenhum diálogo aberto |
| Deslizar para baixo, em **Apps abertos** | Volta ao painel | |
| Rolar o mouse para baixo ou para cima | Vai para **Apps abertos** ou volta ao painel | Navegador no computador |
| Tocar no ponto de cima ou no de baixo da barra lateral | Vai ao painel ou a **Apps abertos** | Barra de dois pontos à direita; escondida com uma janela aberta |
| **Cancelar** / **Remover** (diálogo) | Fecha o diálogo ou tira a tecla do painel | O app continua no computador |
| Digitar o sexto dígito do código de acesso | Conecta sozinho | Tela de entrada aberta |

### Celular: Apps abertos

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Tocar num cartão | Traz a janela para a frente | Janela fora de foco |
| Tocar num cartão em foco | Minimiza a janela | Janela em foco |
| Dois toques rápidos num cartão | Abre uma nova janela do app | Um toque logo depois do outro |
| Segurar um cartão por cerca de meio segundo | Abre **Fechar janela?** | Mover o dedo cancela |
| **Fechar janela** (diálogo) | Fecha a janela no computador | Alterações não salvas podem ser perdidas |
| Arrastar a fileira para o lado | Rola a lista de cartões | Mais cartões do que cabem na tela |
| Enter ou Espaço num cartão com foco | Igual ao toque simples | Teclado ligado ao aparelho |
| Delete ou Backspace num cartão com foco | Abre **Fechar janela?** | Teclado ligado ao aparelho |
| Shift+Enter num cartão com foco | Abre uma nova janela do app | Teclado ligado ao aparelho |
| Tocar no cartão **OBS** | Abre a gaveta do OBS | |
| Deslizar para baixo ou tocar no ponto de cima | Volta ao painel | |

### Celular: gaveta do OBS

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Tocar numa cena | Coloca a cena no programa | OBS conectado |
| Estrela ao lado da cena | Fixa a cena como tecla do painel, ou tira a tecla | Em **Lista** e **Colunas**; oferece **Desfazer** |
| Estrela do alto (**Escolher cenas para o dock**) | Liga e desliga o modo de fixar | Em **Abas** |
| Tocar numa cena no modo de fixar | Fixa ou tira a tecla | Em **Abas**, com o modo ligado |
| **Lista**, **Colunas**, **Abas** | Muda o **Modo de exibição** | |
| **Cenas · n**, **Fontes · n** | Alterna os grupos | Em **Abas** |
| **Gravar** / **Parar** | Liga ou desliga a gravação | OBS conectado |
| **Live** / **Parar live** | Liga ou desliga a transmissão | OBS conectado |
| **Encerrar** | Pergunta e, se confirmado, para a gravação, a live ou as duas | Só com algo em andamento |
| Engrenagem **Conexão e senha do OBS** | Mostra ou esconde o campo da senha | OBS conectado |
| **Salvar e conectar**, **Limpar senha** | Guarda ou remove a senha do WebSocket do OBS | |
| ✕ no canto | Fecha a gaveta | |

### Celular: teclas de cena do OBS

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Tocar na tecla | Troca para a cena | Fora de uma transmissão ao vivo, com o estado conhecido |
| Tocar na tecla travada | Explica como trocar | Cena que não está no ar, durante a live ou sem saber se há live |
| Segurar a tecla travada | Troca para a cena | Mesmo caso |
| Shift+Enter numa tecla travada | Troca para a cena | Teclado ligado ao aparelho |
| **Desfazer** na mensagem, ou Ctrl+Z / Cmd+Z | Devolve a cena anterior ao ar | Após troca por tecla travada, se havia cena anterior e o programa não mudou |
| Tocar com o OBS desligado | Mostra **OBS offline** | |
| Tocar numa cena que não existe mais | Mostra **A cena "nome" não existe mais no OBS** | |

### Celular: teclas PRO

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Tocar numa tecla PRO comum | Executa a ação (por exemplo, ligar ou apagar uma luz) | PRO ativo e lugar para o celular |
| Segurar uma tecla PRO comum por cerca de meio segundo | Abre o diálogo de remover | Teclas que não pedem confirmação |
| Tocar numa tecla que pede confirmação | Mostra **Segure para confirmar** | Fechaduras e coberturas motorizadas |
| Segurar essa tecla por quase um segundo | O anel da tecla se completa e a ação é executada | Soltar antes, ou mover o dedo, cancela |
| Enter ou Espaço, mantido, numa tecla com foco | Igual a segurar | Soltar antes cancela |
| Segurar o nome de uma tecla que pede confirmação | Abre o diálogo de remover | O nome fica abaixo do ícone; segurar o ícone confirma a ação |
| Atalho da Apple no iPhone | Abre o atalho no iPhone em que a tecla foi tocada | O atalho existe no iPhone com o mesmo nome |
| Sem PRO ativo | Mostra **Este recurso exige o DeckTech PRO ativo** | |

### Computador: janela do Windows (aba Slots)

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Clicar no **+** de uma posição vazia | Abre o seletor para essa posição | Fora do modo de reorganizar |
| Passar o mouse ou focar numa tecla e clicar em **Remover** | Abre **Remover dos favoritos?** | |
| Delete ou Backspace numa tecla com foco | Abre o mesmo diálogo | |
| **Remover** / **Cancelar** (diálogo) | Remove a tecla ou fecha o diálogo | O app continua no computador |
| **Reorganizar apps** | Liga o modo de reorganizar; o botão vira **Concluir** | |
| Arrastar uma tecla sobre outra posição | Move a tecla; se a posição estiver ocupada, as duas trocam | Modo de reorganizar |
| Setas do teclado numa tecla com foco | Move uma posição (para cima e para baixo, uma linha) | Modo de reorganizar |
| Clicar numa página | Marca a página como ativa | |
| **Concluir** | Sai do modo de reorganizar | |

### Computador: seletor de teclas

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Abas **Apps**, **Sites**, **PRO** | Troca de origem | Setas esquerda e direita trocam de aba |
| **Buscar apps...** | Filtra a lista de apps | Aba **Apps** |
| **Adicionar** numa linha | Fixa o app na posição escolhida (ou na primeira livre) | Vira **Adicionado** |
| Endereço, **Nome do site** e **Adicionar** | Fixa o site | Aba **Sites** |
| Escolher um item PRO, **Ação ao tocar:**, **Adicionar** | Cria a tecla PRO | PRO ativo e origem conectada |
| ✕ ou clique fora | Fecha o seletor | |
| Esc, dentro de um item PRO | Volta à lista da origem | |

### Computador: teclado

| Gesto ou controle | O que faz | Condição |
|---|---|---|
| Tab e Shift+Tab | Percorrem teclas, botões e diálogos | No diálogo de remover, o foco não sai dele |
| Enter ou Espaço | Aciona o botão ou a tecla com foco | |
| Delete ou Backspace | Pede para remover a tecla com foco | Janela do Windows |
| Setas | Movem a tecla com foco | Modo de reorganizar do Windows |
| Esc | Fecha o diálogo de confirmação | |
| Esc, no seletor, dentro de um item PRO | Volta à lista da origem | |
| Setas esquerda e direita nas abas do seletor | Trocam de aba | |

### Bandeja do Windows

Clique com o botão direito no ícone do DeckTech, perto do relógio.

| Item | O que faz | Condição |
|---|---|---|
| Linha de estado (por exemplo, **DeckTech — rodando**) | Mostra o estado do servidor | Só leitura |
| **Abrir DeckTech** | Abre a janela | |
| **Abrir pasta de logs** | Abre a pasta dos registros | |
| **Iniciar com o Windows** | Liga ou desliga a abertura em segundo plano ao entrar no Windows | Só aparece quando o sistema permite |
| **Atualizar agora**, **Baixar e instalar**, **Adiar 1 hora**, **Verificar atualizações** | Controlam as atualizações | Aparecem conforme o estado da atualização |
| **Sair** | Fecha o DeckTech | Só fechar a janela não encerra o servidor |

### Barra de menus do macOS

| Item | O que faz | Condição |
|---|---|---|
| **Dispositivo: n** e **Fixados: n** | Mostram quantos aparelhos e teclas | Só leitura |
| **Abrir DeckTech** | Abre a janela | |
| **Sincronizar agora** | Recarrega as teclas, os apps instalados e o código de acesso | |
| **Verificar atualizações** | Procura uma versão nova | Sem atualização disponível |
| **Atualização {versão} disponível**, **Baixar e instalar** | Instala a versão nova | Com atualização disponível |
| **Abrir no início da sessão** | Abre o DeckTech só com o ícone, sem janela, ao entrar no Mac | Desligado por padrão; o macOS pode pedir aprovação |
| **Sair** | Fecha o DeckTech | |
| **Versão {versão}** | Mostra a versão instalada | Só leitura |

## Teclado e acessibilidade

- Toda tecla, todo cartão e todo botão do painel, inclusive os dois pontos da barra lateral, recebem foco por Tab, têm nome para leitores de tela e respondem a Enter e Espaço. O controle com o foco do teclado mostra um contorno; um toque ou um clique não mostra.
- Nas teclas que pedem confirmação, mantenha Enter ou Espaço pressionado; soltar antes cancela.
- Numa tecla de cena travada, Shift+Enter troca de cena. Ctrl+Z ou Cmd+Z aciona o **Desfazer** da mensagem na tela, fora de um campo de texto.
- Num cartão de **Apps abertos** com foco, Delete ou Backspace abre **Fechar janela?** e Shift+Enter abre uma nova janela do app.
- Nos diálogos de confirmação, Tab e Shift+Tab ficam dentro do diálogo e Esc fecha. Tocar fora do diálogo também fecha.
- Com a configuração "reduzir movimento" do aparelho ligada, a gaveta, os diálogos, os avisos, a tela de entrada e os indicadores de gravação e de live deixam de ser animados.
- O painel funciona em retrato e deitado.

## Solução de problemas

Os casos de instalação, bloqueio do código de acesso, certificado e rede estão em [Solução de problemas](SUPPORT.pt-BR.md#solução-de-problemas). O painel mostra estas mensagens:

| Mensagem | O que significa | O que fazer |
|---|---|---|
| **Código errado.** | O código de acesso não confere | Digite o código atual da aba **Conectar** |
| **Muitas tentativas — aguarde {s}s.** | O computador bloqueou o aparelho por um tempo | Espere o tempo indicado |
| **Computador desconectado** | O painel perdeu o computador | Confira se o DeckTech está aberto e se os dois estão na mesma rede |
| **Não consegui abrir "{name}"** | O app ou o site não abriu | Confira se o app ainda está instalado |
| **"{name}" não está mais instalado** | O app foi removido do computador | Remova a tecla e fixe outro app |
| **O dock mudou; tente novamente** | A configuração mudou em outro lugar | Repita a ação |
| **Limite de 5 páginas atingido** | As 40 posições estão ocupadas | Remova uma tecla |
| **OBS offline** | Não há conexão com o OBS | Abra o OBS e confira o servidor WebSocket |
| **OBS indisponível — verifique o WebSocket** | O OBS respondeu, mas não devolveu o estado | Confira o servidor WebSocket do OBS |
| **Senha do OBS incorreta — verifique a senha no OBS** | A senha salva não confere | Copie a senha atual do OBS e use **Salvar e conectar** |
| **Servidor WebSocket do OBS desligado ou inacessível — verifique o OBS** | O servidor WebSocket está desligado | Ative-o em **Ferramentas › Configurações do servidor WebSocket** |
| **Comando OBS falhou** | O OBS recusou o comando | Tente de novo |
| **Este recurso exige o DeckTech PRO ativo** | A licença não está ativa neste computador | Veja a aba **PRO** |
| **Este celular ainda não tem um lugar no PRO** | Todos os lugares do plano estão em uso | Libere um aparelho na aba **PRO** |
| **O Home Assistant não está conectado agora.** | O DeckTech perdeu o Home Assistant | Conecte de novo na aba **PRO** |
| **O Home Assistant recusou o acesso.** | O acesso foi recusado ou expirou | Conecte de novo na aba **PRO** |
| **A ponte Philips Hue não está acessível.** | A ponte não respondeu | Confira se está ligada e na mesma rede |

Em último caso, escreva para [contato@decktech.com.br](mailto:contato@decktech.com.br) com a versão e a plataforma. Antes de anexar logs ou capturas, esconda códigos de acesso, senhas e dados pessoais.

## Privacidade

O DeckTech grátis não pede conta e controla o computador pela sua rede local; o que o PRO e as atualizações enviam ou consultam pela internet está no [Aviso de Privacidade](PRIVACY.pt-BR.md).
