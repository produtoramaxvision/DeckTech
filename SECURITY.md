# Política de Segurança / Security Policy

Responsável: Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP.

## Versões suportadas

Somente a versão publicada como [release mais recente](https://github.com/produtoramaxvision/DeckTech/releases/latest) recebe correções de segurança. Versões anteriores não são suportadas.

## Relatar uma vulnerabilidade

Não abra Issue ou Discussion pública. Abra a página [Security > Advisories](https://github.com/produtoramaxvision/DeckTech/security/advisories) e use o botão **Report a vulnerability** (relato privado de vulnerabilidade do GitHub).

Se você não tiver uma conta no GitHub, envie o relato para [contato@decktech.com.br](mailto:contato@decktech.com.br) e identifique a mensagem como assunto de segurança. O relato deve continuar privado.

Inclua a versão, plataforma, impacto, passos mínimos para reproduzir e, se possível, uma sugestão de correção. Remova PINs, tokens, chaves, dados pessoais e detalhes de instalações reais. Os mantenedores farão a triagem pelo canal privado utilizado; não há SLA garantido.

## Endurecimento do servidor local

O servidor do host só aceita requisições cujo cabeçalho `Host` seja `localhost` ou um endereço IP desta máquina. Quando o cabeçalho `Origin` está presente, o servidor rejeita mudanças de estado se o esquema, o host e a porta não corresponderem à origem da própria requisição; clientes nativos podem omitir o `Origin`, sem que isso dispense a autenticação. Isso impede que uma página da web use um nome DNS controlado para alcançar o servidor local (DNS rebinding). O PIN continua sendo o controle de acesso; esse endurecimento não substitui uma rede local confiável no fluxo HTTP do navegador e da PWA.

## Escopo do pareamento

Um link de pareamento (`decktech://pair`) só é aceito se o host nele apontar para a rede local (LAN, endereço privado RFC 1918) da própria instalação ou para o Tailscale dela (100.64.0.0/10); qualquer outro endereço é recusado, mesmo que o link tenha uma assinatura válida — o DeckTech nunca pareia pela internet. Ao anunciar o pareamento, o Windows e o macOS preferem sempre um endereço de rede privada quando o computador tem mais de um, e mostram um aviso na tela Conectar quando nenhum está disponível, em vez de oferecer um QR que o app Android recusaria de qualquer forma. Um link de pareamento aberto fora do próprio app (câmera, navegador ou outro app) sempre exige confirmação explícita, com o host e a porta em destaque e o botão de cancelar focado por padrão.

## Bloqueio por PIN e permissões do Electron

O acesso por PIN é protegido contra força bruta: 5 falhas do mesmo endereço bloqueiam esse endereço por 60 segundos, dobrando a cada novo bloqueio seguido até 1h; um limite global bloqueia novos logins por PIN de qualquer endereço por 30 minutos após 5 endereços DISTINTOS falharem dentro de 2 horas (falhas repetidas do mesmo endereço não contam mais de uma vez — um único cliente mal-comportado nunca dispara o bloqueio global sozinho), dobrando até 24h a cada novo gatilho (aparelhos já conectados continuam funcionando). Mesmo o PIN correto é recusado enquanto um desses bloqueios estiver ativo, e a resposta informa quanto tempo falta. No app Windows (Electron), qualquer solicitação de permissão do navegador embutido (câmera, notificações, geolocalização etc.) é negada por padrão desde antes da primeira janela aberta (incluindo a tela do contrato de licença), como defesa em profundidade — a interface hoje não solicita nenhuma.

## Supported versions

Only the version published as the [latest release](https://github.com/produtoramaxvision/DeckTech/releases/latest) receives security fixes. Older versions are unsupported.

## Reporting a vulnerability

Do not open a public Issue or Discussion. Open [Security > Advisories](https://github.com/produtoramaxvision/DeckTech/security/advisories) and use the **Report a vulnerability** button (GitHub private vulnerability reporting).

If you do not have a GitHub account, email the report to [contato@decktech.com.br](mailto:contato@decktech.com.br) and identify the message as a security matter. The report must remain private.

Include the version, platform, impact, minimal reproduction steps, and a suggested fix if available. Remove PINs, tokens, keys, personal data, and details of real installations. Maintainers will triage the report through the private channel used; no response SLA is guaranteed.

## Local server hardening

The host server only accepts requests whose `Host` header is `localhost` or an IP address of this machine. When the `Origin` header is present, the server rejects state changes unless its scheme, host and port match the request's own origin; native clients may omit `Origin`, and this does not bypass authentication. This stops a web page from reaching the local server through a name it controls (DNS rebinding). The PIN remains the access control; this hardening does not replace a trusted local network for the browser and PWA HTTP flow.

## Pairing scope

A pairing link (`decktech://pair`) is only accepted if its host points to the installation's own local network (LAN, an RFC 1918 private address) or its Tailscale overlay (100.64.0.0/10); any other address is rejected, even with a validly formed link — DeckTech never pairs over the internet. When advertising itself for pairing, Windows and macOS always prefer a private-network address when the computer has more than one, and show a notice on the Connect screen when none is available, instead of offering a QR code the Android app would reject anyway. A pairing link opened outside the app itself (camera, browser, or another app) always requires explicit confirmation, with the host and port highlighted and the cancel button focused by default.

## PIN lockout and Electron permissions

PIN access is protected against brute force: 5 failures from the same address lock that address for 60 seconds, doubling with each consecutive lockout up to 1h; a global limit blocks new PIN logins from any address for 30 minutes after 5 DISTINCT addresses fail within 2 hours (repeated failures from the same address only count once — a single misbehaving client can never trigger the global lockout on its own), doubling up to 24h with each new trigger (devices already signed in keep working). Even the correct PIN is rejected while one of these lockouts is active, and the response reports how much time is left. In the Windows app (Electron), any permission request from the embedded browser (camera, notifications, geolocation, etc.) is denied by default from before the first window ever opens (including the license agreement screen), as defense in depth — the UI requests none today.
