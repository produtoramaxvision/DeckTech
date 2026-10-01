[English](SUPPORT.md) | Português (Brasil)

# Suporte

Responsável: Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP.

## Instalação e dúvidas

Consulte primeiro o [README em português](README.pt-BR.md), incluindo as orientações de SmartScreen, Gatekeeper, pareamento e checksum.

- Para uma dúvida sem dados sensíveis, use [Discussions](https://github.com/produtoramaxvision/DeckTech/discussions).
- Para um defeito reproduzível, abra o formulário de [bug report](https://github.com/produtoramaxvision/DeckTech/issues/new?template=bug_report.yml).
- Para uma ideia, use a categoria [Ideas](https://github.com/produtoramaxvision/DeckTech/discussions/categories/ideas).
- Para contato direto, escreva para [contato@decktech.com.br](mailto:contato@decktech.com.br).
- Para vulnerabilidades, siga [SECURITY.pt-BR.md](SECURITY.pt-BR.md); nunca publique o relato.

Informe a versão e a plataforma. Antes de anexar logs ou capturas, oculte PIN, IP, nomes de usuário, caminhos pessoais e outros dados sensíveis. O suporte é comunitário e não tem SLA garantido.

## Solução de problemas

- **PIN recusado ou bloqueado.** Se o painel mostrar "Muitas tentativas — aguarde {s}s.", o host bloqueou temporariamente o seu dispositivo após 5 códigos errados, e {s} é o tempo restante em segundos. O bloqueio começa em 60 segundos e dobra a cada novo bloqueio seguido (60s, 2min, 4min... até 1h); tentar de outro dispositivo na mesma rede escapa desse bloqueio específico (cada dispositivo tem o seu), mas não do bloqueio geral: 5 dispositivos DIFERENTES errando o código dentro de 2 horas disparam um bloqueio de 30 minutos para novos logins de qualquer dispositivo (dobrando até 24h a cada novo gatilho; tentativas repetidas do MESMO dispositivo nunca contam mais de uma vez), que recusa até o PIN correto enquanto durar. Aguarde o tempo indicado e confira o PIN na aba **Conectar** do host. Se aparecer "Código errado.", digite o PIN atual mostrado no host.
- **Porta HTTPS em uso.** Se o host mostrar "O HTTPS do app Android não pôde iniciar porque a porta {port} já está em uso. Feche o outro aplicativo que usa essa porta e tente novamente.", feche o outro aplicativo que usa a porta indicada e reinicie o DeckTech. O acesso pelo navegador continua funcionando por HTTP em uma rede confiável. No Windows, essa mensagem aparece sempre em português; no macOS, ela segue o idioma escolhido no app.
- **Certificado alterado.** Se o app Android mostrar "Certificado do computador mudou" e "A conexão foi bloqueada porque o certificado mudou.", compare o novo código com o **Código de segurança** exibido na aba **Conectar** do host. Toque em **Substituir após conferir** somente se os códigos forem iguais.
- **Pareamento recusado por estar em outra rede.** Se a tela **Conectar** do host mostrar "Este computador não tem um endereço de rede local disponível para o app Android — verifique se o computador e o telefone estão na mesma rede local (Wi-Fi ou Ethernet, não uma VPN).", o computador não tem um endereço de rede local (LAN) para oferecer ao app Android; conecte-o à mesma Wi-Fi/Ethernet do telefone (não uma VPN) e recarregue a aba. Se, em vez disso, o telefone mostrar "Este link de pareamento aponta para um endereço fora da sua rede local ou do Tailscale, então foi ignorado por segurança. O DeckTech só pareia dentro da LAN ou do Tailscale.", o link de pareamento usado aponta para um endereço fora da LAN ou do Tailscale desta instalação; gere um novo QR ou código na aba **Conectar** do computador que você realmente quer parear, na mesma rede do telefone.
- **Aviso ao abrir um link de pareamento fora do app.** Se o telefone pedir confirmação com a mensagem "Este link foi aberto fora do app (câmera, navegador ou outro app) — só continue se foi você mesmo, agora, que abriu ou escaneou este link a partir do seu computador.", confirme somente se foi você quem escaneou ou abriu esse QR/link agora mesmo, no seu próprio computador; caso contrário, toque em cancelar (o botão de cancelar já vem selecionado por padrão).
- **Tela de contrato de licença (EULA) na primeira abertura.** Windows, macOS e Android pedem a aceitação do contrato antes do primeiro uso. No Windows, é preciso marcar a caixa de confirmação para habilitar o botão de aceitar; recusar fecha o aplicativo. O texto completo está em [EULA.md](EULA.md), a versão em português, que prevalece ([tradução em inglês](EULA.en.md)).
- **Onde ficam os dados.** No Windows, em `%LOCALAPPDATA%\DeckTech`; na desinstalação eles são preservados, a menos que você marque **Remover também os dados do usuário**. No macOS, em `~/Library/Application Support/DeckTech`.

## OBS Studio

Para configurar o OBS ou resolver senha incorreta, servidor desligado e porta diferente de 4455, siga [OBS Studio no README](README.pt-BR.md#obs-studio). Nunca anexe a senha ou as informações de conexão do OBS a um chamado.
