[English](RELEASE_NOTES_v0.1.0.md) | Português (Brasil)

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
- **Cenas do OBS** pelo obs-websocket, com a senha guardada só no computador. O DeckTech conecta mesmo sem senha, quando a autenticação do WebSocket está desativada (com um aviso recomendando ativá-la), e o painel do celular mostra passos numerados para configurar o servidor WebSocket do OBS. A conexão com o OBS acontece em segundo plano, então iniciar o app nunca espera por ela. A gaveta do OBS no celular tem um único cabeçalho com o status da conexão, um cartão **NO AR** para a cena ao vivo, um seletor **Lista / Colunas / Abas** (lembrado em cada aparelho), cenas agrupadas em numeradas e "Fontes e utilitários" (cenas cujo nome não é numerado), um modo de fixar cenas no dock e os controles de gravação e transmissão no rodapé. Com o OBS desconectado, a gaveta mostra um painel offline com passos numerados de configuração, o formulário de senha e o botão **Tentar agora**.
- **Acesso protegido por PIN** de 6 dígitos, com bloqueio progressivo por endereço (60s dobrando até 1h a cada novo bloqueio seguido) e um limite global que bloqueia novos logins por PIN de qualquer endereço por 30 minutos após 5 endereços distintos falharem dentro de 2 horas (dobrando até 24h a cada novo gatilho; aparelhos já conectados continuam funcionando). O servidor só aceita requisições para `localhost` ou para um IP do próprio computador e recusa mudanças vindas de outra origem, o que protege contra DNS rebinding.
- **Pareamento restrito à rede local.** O app Android só aceita um link de pareamento (`decktech://pair`) cujo host seja um endereço de rede privada (RFC 1918), um endereço da faixa do Tailscale ou um nome `.local`; qualquer outro endereço é recusado, com um aviso explicando o motivo. Se o computador não tiver um endereço de rede local disponível para o app Android, a tela Conectar mostra um aviso em vez de um QR que o telefone recusaria. Um link de pareamento aberto fora do próprio app (câmera, navegador ou outro app) pede confirmação, com o host e a porta em destaque e o botão Cancelar em foco; só um link idêntico à conexão que o app já tem salva dispensa esse diálogo.
- **Descoberta automática** do computador na rede local.
- **Português (Brasil) e inglês** no painel móvel, seguindo o idioma do aparelho; seletor de idioma no macOS e no site. A interface do host Windows está em português nesta versão.
- **Aviso de nova versão** no painel, consultando a página de releases pública do DeckTech.
- **Contrato de licença (EULA)** apresentado na primeira execução dos aplicativos Windows, macOS e Android; no Windows, uma caixa de confirmação precisa estar marcada para habilitar o aceite.
- **Visão "Slots" no desktop**, com as cinco páginas do painel em uma grade de visão geral (três colunas, duas em janelas mais estreitas que 1100 px) em que cada peça mostra o nome do app, e uma barra de título com a marca DeckTech e o status de conexão dos celulares ao lado dos botões da janela.

## Requisitos

- Windows 11 (x64, build 22000 ou superior).
- macOS 14 ou superior.
- Android 5.0 ou superior.
- Computador e celular na mesma rede local.

## Instalação

Baixe o arquivo da sua plataforma nos assets desta release e confira o `SHA256SUMS.txt` antes de instalar.
- O instalador do Windows não tem assinatura de código (o SmartScreen pode continuar avisando na primeira execução), mas as propriedades do instalador e do app instalado, e a entrada em **Configurações › Aplicativos** (ou em Programas e Recursos), já identificam a Produtora MaxVision como editora.
- O app do macOS usa assinatura ad hoc, sem notarização.

O [README](https://github.com/produtoramaxvision/DeckTech/blob/main/README.pt-BR.md) explica como abrir pela primeira vez. Em caso de dúvida ou problema, o [SUPPORT](https://github.com/produtoramaxvision/DeckTech/blob/main/SUPPORT.pt-BR.md) tem uma seção de solução de problemas e o [tutorial rápido](https://decktech.com.br/tutorial-decktech) está em português e inglês.

## Checksums

Os checksums SHA-256 estão em `SHA256SUMS.txt`. O DMG também tem `DeckTech-macOS.dmg.sha256`.
