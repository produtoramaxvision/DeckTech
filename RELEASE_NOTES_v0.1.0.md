# DeckTech v0.1.0

Primeira versão pública do DeckTech: um painel de controle no celular para os apps do seu computador.

## O que vem nesta versão

- **App para Windows e macOS** que roda no computador e serve o painel na rede local. Ao iniciar no Windows, se a porta já tiver um servidor DeckTech que só está lento para responder, o app passa a usá-lo em vez de indicar porta ocupada.
- **App Android** que se conecta ao computador somente por HTTPS com o certificado daquela instalação fixado. O pareamento é feito pelo QR "App Android" ou por um código de segurança de 16 caracteres conferido na tela Conectar. O app avisa se o certificado mudar e pede confirmação antes de aceitar um link de pareamento externo.
- **Painel no navegador (PWA)** para iPhone e outros aparelhos, pelo endereço mostrado na tela Conectar. Nesta versão o navegador usa HTTP sem criptografia: use somente em uma rede confiável.
- **Tela inicial** com os seus apps fixados e os ícones reais de cada app, incluindo apps da Microsoft Store, atalhos `.lnk` e inicializadores de apps instalados por usuário.
- **Apps abertos**: um cartão por janela, com monitor e estado:
  - um toque traz a janela para frente ou minimiza;
  - um toque duplo abre uma nova janela;
  - tocar e segurar pede confirmação para fechar.
- **Atalhos de sites**, com o ícone do site e confirmação antes de remover.
- **Cenas do OBS** pelo obs-websocket, com a senha guardada só no computador. O DeckTech conecta mesmo sem senha, quando a autenticação do WebSocket está desativada (com um aviso recomendando ativá-la), e o painel do celular mostra passos numerados para configurar o servidor WebSocket do OBS. A conexão com o OBS acontece em segundo plano, então iniciar o app nunca espera por ela.
- **Acesso protegido por PIN** de 6 dígitos, com bloqueio progressivo por endereço (60s dobrando até 1h a cada novo bloqueio seguido) e um limite global que bloqueia novos logins por PIN de qualquer endereço por 30 minutos após 5 endereços distintos falharem dentro de 2 horas (dobrando até 24h a cada novo gatilho; aparelhos já conectados continuam funcionando). O servidor só aceita requisições para `localhost` ou para um IP do próprio computador e recusa mudanças vindas de outra origem, o que protege contra DNS rebinding.
- **Pareamento restrito à rede local.** Um link de pareamento (`decktech://pair`) só é aceito se apontar para a rede local (LAN) da instalação ou para o Tailscale dela; qualquer outro endereço é recusado, com um aviso explicando o motivo. Se o computador não tiver um endereço de rede local disponível para o app Android, a tela Conectar mostra um aviso em vez de um QR que o telefone recusaria. Um link de pareamento aberto fora do próprio app (câmera, navegador ou outro app) sempre pede confirmação, com o host e a porta em destaque e o botão Cancelar em foco.
- **Descoberta automática** do computador na rede local.
- **Português (Brasil) e inglês** no painel móvel, seguindo o idioma do aparelho; seletor de idioma no macOS e no site. A interface do host Windows está em português nesta versão.
- **Aviso de nova versão** no painel, consultando a página de releases pública do DeckTech.
- **Contrato de licença (EULA)** apresentado na primeira execução dos aplicativos Windows, macOS e Android; no Windows, uma caixa de confirmação precisa estar marcada para habilitar o aceite.
- **Visão "Slots" no desktop**, com as cinco páginas do painel em uma grade de três colunas e uma barra de título mostrando o status de conexão dos celulares.

## Requisitos

- Windows 11 (x64, build 22000 ou superior).
- macOS 14 ou superior.
- Android 5.0 ou superior.
- Computador e celular na mesma rede local.

## Instalação

Baixe o arquivo da sua plataforma nos assets desta release e confira o `SHA256SUMS.txt` antes de instalar.
- O instalador do Windows não tem assinatura de código (o SmartScreen pode continuar avisando na primeira execução), mas as propriedades do instalador e do app instalado, e a entrada em **Configurações › Aplicativos** (ou em Programas e Recursos), já identificam a Produtora MaxVision como editora.
- O app do macOS usa assinatura ad hoc, sem notarização.

O [README](https://github.com/produtoramaxvision/DeckTech/blob/main/README.md) explica como abrir pela primeira vez. Em caso de dúvida ou problema, o [SUPPORT](https://github.com/produtoramaxvision/DeckTech/blob/main/SUPPORT.md) tem uma seção de solução de problemas e o [tutorial rápido](https://decktech.com.br/tutorial-decktech) está em português e inglês.

## Checksums

Os checksums SHA-256 estão em `SHA256SUMS.txt`. O DMG também tem `DeckTech-macOS.dmg.sha256`.

## Próxima versão

A v0.1.1 está planejada para ampliar os controles de live com novos botões de microfone, transmissão e gravação, fontes e transições do OBS, sons, abas de navegador e um menu de segurar e arrastar.

---

# DeckTech v0.1.0

The first public release of DeckTech: a control deck on your phone for the apps on your computer.

## What is in this release

- **Windows and macOS app** that runs on the computer and serves the deck on the local network. On Windows, at startup, if the port already has a DeckTech server that is just slow to respond, the app uses it instead of reporting the port as busy.
- **Android app** that connects to the computer only over HTTPS with that installation's certificate pinned. You pair through the "Android app" QR or a 16-character security code checked on the Connect screen. The app warns you if the certificate changes and asks for confirmation before accepting an external pairing link.
- **Browser deck (PWA)** for iPhone and other devices, at the address shown on the Connect screen. In this release the browser uses unencrypted HTTP: use it only on a trusted network.
- **Home screen** with your pinned apps and each app's real icon, including Microsoft Store apps, `.lnk` shortcuts and per-user app launchers.
- **Open apps**: one card per window, with its monitor and state:
  - a tap brings the window forward or minimizes it;
  - a double tap opens a new window;
  - press and hold asks for confirmation before closing.
- **Website shortcuts**, with the site's icon and a confirmation before removal.
- **OBS scenes** through obs-websocket, with the password kept on the computer only. DeckTech connects even without a password, when the WebSocket authentication is off (with a notice recommending you turn it on), and the mobile deck shows numbered steps to set up the OBS WebSocket server. Connecting to OBS happens in the background, so starting the app never waits on it.
- **6-digit PIN access**, with a progressively escalating per-address lockout (60s doubling up to 1h with each consecutive lockout) and a global limiter that blocks new PIN logins from any address for 30 minutes after 5 distinct addresses fail within 2 hours (doubling up to 24h with each new trigger; devices already signed in keep working). The server accepts requests only for `localhost` or one of the computer's own IPs and refuses state changes from another origin, which protects against DNS rebinding.
- **Pairing restricted to the local network.** A pairing link (`decktech://pair`) is only accepted if it points to the installation's own local network (LAN) or its Tailscale overlay; any other address is rejected, with a notice explaining why. If the computer has no local-network address available for the Android app, the Connect screen shows a notice instead of a QR code the phone would reject anyway. A pairing link opened outside the app itself (camera, browser, or another app) always asks for confirmation, with the host and port highlighted and the Cancel button focused.
- **Automatic discovery** of the computer on the local network.
- **Portuguese (Brazil) and English** in the mobile deck, following the device language; language selection on macOS and the website. The Windows host UI is Portuguese-only in this release.
- **New version notice** in the deck, based on DeckTech's public releases page.
- **License agreement (EULA)** shown on first run of the Windows, macOS and Android applications; on Windows, an agreement checkbox must be ticked to enable acceptance.
- **Desktop "Slots" view**, showing the deck's five pages as a three-column overview grid with a title bar reporting phone-connection status.

## Requirements

- Windows 11 (x64, build 22000 or later).
- macOS 14 or later.
- Android 5.0 or later.
- Computer and phone on the same local network.

## Installation

Download your platform's file from this release's assets and check `SHA256SUMS.txt` before installing.
- The Windows installer is not code-signed (SmartScreen may still warn on first run), but the installer's and the installed app's file properties, and the **Settings › Apps** entry (or Programs and Features), now identify Produtora MaxVision as the publisher.
- The macOS app is ad-hoc signed and not notarized.

The [README](https://github.com/produtoramaxvision/DeckTech/blob/main/README.md) explains how to open it the first time. If something goes wrong, [SUPPORT](https://github.com/produtoramaxvision/DeckTech/blob/main/SUPPORT.md) has a troubleshooting section and the [quick-start tutorial](https://decktech.com.br/tutorial-decktech) is in Portuguese and English.

## Checksums

SHA-256 checksums are in `SHA256SUMS.txt`. The DMG also has `DeckTech-macOS.dmg.sha256`.

## Next version

v0.1.1 is planned to expand live controls with new microphone, streaming and recording buttons, OBS sources and transitions, sounds, browser tabs, and a press-and-drag hold menu.
