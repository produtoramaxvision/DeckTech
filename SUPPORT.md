# Suporte / Support

Responsável: Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP.

## Instalação e dúvidas

Consulte primeiro o [README em português](README.md) ou [em inglês](README.en.md), incluindo as orientações de SmartScreen, Gatekeeper, pareamento e checksum.

- Para uma dúvida sem dados sensíveis, use [Discussions](https://github.com/produtoramaxvision/DeckTech/discussions).
- Para um defeito reproduzível, abra o formulário de [bug report](https://github.com/produtoramaxvision/DeckTech/issues/new?template=bug_report.yml).
- Para uma ideia, use a categoria [Ideas](https://github.com/produtoramaxvision/DeckTech/discussions/categories/ideas).
- Para contato direto, escreva para [contato@decktech.com.br](mailto:contato@decktech.com.br).
- Para vulnerabilidades, siga [SECURITY.md](SECURITY.md); nunca publique o relato.

Informe a versão e a plataforma. Antes de anexar logs ou capturas, oculte PIN, IP, nomes de usuário, caminhos pessoais e outros dados sensíveis. O suporte é comunitário e não tem SLA garantido.

## Solução de problemas

- **PIN recusado ou bloqueado.** Se o painel mostrar "Muitas tentativas — aguarde {s}s.", o host bloqueou temporariamente o seu dispositivo após 5 códigos errados, e {s} é o tempo restante em segundos. O bloqueio começa em 60 segundos e dobra a cada novo bloqueio seguido (60s, 2min, 4min... até 1h); tentar de outro dispositivo na mesma rede escapa desse bloqueio específico (cada dispositivo tem o seu), mas não do bloqueio geral: 5 dispositivos DIFERENTES errando o código dentro de 2 horas disparam um bloqueio de 30 minutos para novos logins de qualquer dispositivo (dobrando até 24h a cada novo gatilho; tentativas repetidas do MESMO dispositivo nunca contam mais de uma vez), que recusa até o PIN correto enquanto durar. Aguarde o tempo indicado e confira o PIN na aba **Conectar** do host. Se aparecer "Código errado.", digite o PIN atual mostrado no host.
- **Porta HTTPS em uso.** Se o host mostrar "O HTTPS do app Android não pôde iniciar porque a porta {port} já está em uso. Feche o outro aplicativo que usa essa porta e tente novamente.", feche o outro aplicativo que usa a porta indicada e reinicie o DeckTech. O acesso pelo navegador continua funcionando por HTTP em uma rede confiável. No Windows, essa mensagem aparece sempre em português; no macOS, ela segue o idioma escolhido no app.
- **Certificado alterado.** Se o app Android mostrar "Certificado do computador mudou" e "A conexão foi bloqueada porque o certificado mudou.", compare o novo código com o **Código de segurança** exibido na aba **Conectar** do host. Toque em **Substituir após conferir** somente se os códigos forem iguais.
- **Pareamento recusado por estar em outra rede.** Se a tela **Conectar** do host mostrar "Este computador não tem um endereço de rede local disponível para o app Android — verifique se o computador e o telefone estão na mesma rede local (Wi-Fi ou Ethernet, não uma VPN).", o computador não tem um endereço de rede local (LAN) para oferecer ao app Android; conecte-o à mesma Wi-Fi/Ethernet do telefone (não uma VPN) e recarregue a aba. Se, em vez disso, o telefone mostrar "Este link de pareamento aponta para um endereço fora da sua rede local ou do Tailscale, então foi ignorado por segurança. O DeckTech só pareia dentro da LAN ou do Tailscale.", o link de pareamento usado aponta para um endereço fora da LAN ou do Tailscale desta instalação; gere um novo QR ou código na aba **Conectar** do computador que você realmente quer parear, na mesma rede do telefone.
- **Aviso ao abrir um link de pareamento fora do app.** Se o telefone pedir confirmação com a mensagem "Este link foi aberto fora do app (câmera, navegador ou outro app) — só continue se foi você mesmo, agora, que abriu ou escaneou este link a partir do seu computador.", confirme somente se foi você quem escaneou ou abriu esse QR/link agora mesmo, no seu próprio computador; caso contrário, toque em cancelar (o botão de cancelar já vem selecionado por padrão).
- **Tela de contrato de licença (EULA) na primeira abertura.** Windows, macOS e Android pedem a aceitação do contrato antes do primeiro uso. No Windows, é preciso marcar a caixa de confirmação para habilitar o botão de aceitar; recusar fecha o aplicativo. O texto completo está em [EULA.md](EULA.md) ([English translation](EULA.en.md)).
- **Onde ficam os dados.** No Windows, em `%LOCALAPPDATA%\DeckTech`; na desinstalação eles são preservados, a menos que você marque **Remover também os dados do usuário**. No macOS, em `~/Library/Application Support/DeckTech`.

## OBS Studio

Para configurar o OBS ou resolver senha incorreta, servidor desligado e porta diferente de 4455, siga [OBS Studio no README](README.md#obs-studio). Nunca anexe a senha ou as informações de conexão do OBS a um chamado.

For OBS setup or troubleshooting a wrong password, a disabled server, or a port other than 4455, see [OBS Studio in the README](README.en.md#obs-studio). Never attach your OBS password or connection information to a support request.

## Installation and questions

Read the [English README](README.en.md) or [Portuguese README](README.md) first, including SmartScreen, Gatekeeper, pairing, and checksum guidance.

- For a non-sensitive question, use [Discussions](https://github.com/produtoramaxvision/DeckTech/discussions).
- For a reproducible defect, open the [bug report form](https://github.com/produtoramaxvision/DeckTech/issues/new?template=bug_report.yml).
- For an idea, use the [Ideas](https://github.com/produtoramaxvision/DeckTech/discussions/categories/ideas) category.
- For direct contact, email [contato@decktech.com.br](mailto:contato@decktech.com.br).
- For vulnerabilities, follow [SECURITY.md](SECURITY.md); never publish the report.

Include the version and platform. Before attaching logs or screenshots, hide PINs, IP addresses, usernames, personal paths, and other sensitive data. Support is community-based and has no guaranteed SLA.

## Troubleshooting

- **PIN rejected or locked.** If the deck shows "Too many attempts — wait {s}s.", the host has temporarily blocked your device after 5 wrong codes, and {s} is the remaining time in seconds. The block starts at 60 seconds and doubles with each consecutive lockout (60s, 2min, 4min... up to 1h); trying from another device on the same network escapes that specific lockout (each device has its own), but not the global one: 5 DIFFERENT devices getting the code wrong within 2 hours trigger a 30-minute lockout on new logins from any device (doubling up to 24h with each new trigger; repeated attempts from the SAME device never count more than once), which rejects even the correct PIN while it lasts. Wait the indicated time and check the PIN on the host's **Connect** tab. If it shows "Wrong code.", enter the current PIN shown on the host.
- **HTTPS port in use.** If the host shows "HTTPS for the Android app could not start because port {port} is already in use. Close the other app using that port and try again.", close the other application using the reported port and restart DeckTech. Browser access still works over HTTP on a trusted network. On Windows this message always appears in Portuguese; on macOS it follows the language chosen in the app.
- **Certificate changed.** If the Android app shows "The computer certificate changed" and "The connection was blocked because the certificate changed.", compare the new code with the **Security code** on the host's **Connect** tab. Tap **Replace after checking** only if the codes match.
- **Pairing rejected for being on another network.** If the host's **Connect** tab shows "This computer has no local-network address available for the Android app — check that the computer and phone are on the same local network (Wi-Fi or Ethernet, not a VPN).", the computer has no local-network (LAN) address to offer the Android app; connect it to the same Wi-Fi/Ethernet as the phone (not a VPN) and reload the tab. If instead the phone shows "This pairing link points to an address outside your local network or Tailscale, so it was ignored for security. DeckTech only pairs within the LAN or Tailscale.", the pairing link you used points to an address outside this installation's LAN or Tailscale; generate a fresh QR code or code on the **Connect** tab of the computer you actually want to pair with, on the same network as the phone.
- **Warning when opening a pairing link outside the app.** If the phone asks for confirmation with "This link was opened outside the app (camera, browser, or another app) — only continue if you just opened or scanned it yourself, right now, from your own computer.", confirm only if you are the one who just scanned or opened that QR code/link, on your own computer; otherwise tap cancel (the cancel button is already selected by default).
- **License agreement (EULA) screen on first run.** Windows, macOS, and Android ask you to accept the license agreement before first use. On Windows, you must tick the agreement checkbox to enable the accept button; declining closes the application. The full text is in [EULA.en.md](EULA.en.md) ([Portuguese, prevailing](EULA.md)).
- **Where your data lives.** On Windows, in `%LOCALAPPDATA%\DeckTech`; it is preserved on uninstall unless you tick **Remover também os dados do usuário** (the uninstaller is in Portuguese). On macOS, in `~/Library/Application Support/DeckTech`.
