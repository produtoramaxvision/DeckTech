<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/decktech-logo-dark.webp 1x, assets/decktech-logo-dark@2x.webp 2x">
    <source media="(prefers-color-scheme: light)" srcset="assets/decktech-logo-light.webp 1x, assets/decktech-logo-light@2x.webp 2x">
    <img src="assets/decktech-logo-light.webp" width="180" alt="DeckTech">
  </picture>
</p>

<h1 align="center">DeckTech</h1>

<p align="center"><a href="README.md">English</a> | <strong>Português (Brasil)</strong></p>

O DeckTech transforma um Mac ou PC Windows em host de um dock remoto. O aplicativo inicia um servidor Node.js local e entrega a interface aos dispositivos da mesma rede por APK Android, PWA no iPhone ou navegador.

Este repositório público contém somente documentação, suporte à comunidade e releases oficiais. O código-fonte do DeckTech é proprietário e não é publicado.

Responsável e licenciante: Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP.

## Downloads

| Plataforma | Download direto |
|---|---|
| Windows 11 (x64, build 22000 ou superior) | [`DeckTech-Setup.exe`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/DeckTech-Setup.exe) |
| Android 5.0+ | [`decktech.apk`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/decktech.apk) |
| macOS 14+ | [`DeckTech-macOS.dmg`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/DeckTech-macOS.dmg) |

Consulte também a [release mais recente](https://github.com/produtoramaxvision/DeckTech/releases/latest) e o arquivo [`SHA256SUMS.txt`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/SHA256SUMS.txt). Não instale APK Debug nem arquivos recebidos por canais não oficiais.

## Instalação e primeira execução

### Windows

1. Baixe e execute `DeckTech-Setup.exe`.
2. O instalador atual não tem assinatura de código. Se o Microsoft Defender SmartScreen aparecer, confira se o arquivo veio deste repositório e se o SHA-256 confere; então selecione **Mais informações** e **Executar assim mesmo** somente se aceitar o risco.
3. Na primeira abertura, o DeckTech mostra o contrato de licença (EULA): marque a caixa de confirmação para habilitar **Aceitar e começar**, ou escolha **Recusar e sair** para fechar o aplicativo. A recusa não fica guardada: o contrato aparece de novo na próxima abertura, e o app continua instalado até você removê-lo em **Configurações > Aplicativos**. Os rótulos dos botões aparecem em inglês (**Accept and start** / **Decline and quit**) quando o idioma do sistema não é o português.
4. O DeckTech requer Windows 11 (build 22000 ou superior); o instalador recusa versões anteriores. Na aba **Conectar**, o host mostra o endereço local e o código de acesso (PIN) de seis dígitos — só aparece um endereço aqui se o computador estiver numa rede local (Wi-Fi ou Ethernet), não apenas numa VPN.

### macOS

1. Baixe `DeckTech-macOS.dmg`, abra a imagem e arraste o DeckTech para **Aplicativos**.
2. O aplicativo usa assinatura ad hoc e não é notarizado. Tente abrir com clique direito em **DeckTech** e **Abrir**. Se o Gatekeeper bloquear, tente abrir uma vez e use **Ajustes do Sistema > Privacidade e Segurança > Segurança > Abrir Mesmo Assim**.
3. Na primeira abertura, aceite o contrato de licença (EULA) exibido antes da janela principal.
4. Abra a aba **Conectar** para ver o endereço local e o PIN. Diferente do Windows, o app de macOS tem um seletor de idioma (Português/English) nessa mesma aba, e os rótulos seguem o idioma escolhido ali.

### Android

1. Baixe `decktech.apk` neste repositório e autorize a instalação pelo navegador quando o Android solicitar.
2. Na primeira abertura, aceite o contrato de licença (EULA) exibido no app.
3. No host Windows ou macOS, abra **Conectar > App Android** e escaneie o QR com a câmera do telefone. O APK passa a confiar somente no certificado HTTPS daquele computador. O computador e o telefone precisam estar na mesma rede local (LAN) ou no mesmo Tailscale: um link de pareamento apontando para qualquer outro endereço é recusado por segurança (veja [SUPPORT.pt-BR.md](SUPPORT.pt-BR.md#solução-de-problemas)).
4. Se o app encontrar o computador pela descoberta automática, ele mostra um código de segurança de 16 caracteres (`XXXX-XXXX-XXXX-XXXX`). Confirme somente se for igual, caractere por caractere, ao **Código de segurança** exibido na aba **Conectar** do host.
5. Digite o PIN de seis dígitos. Se o certificado do computador mudar, o app pede uma nova confirmação. Se você abrir o link de pareamento fora do app (pela câmera, pelo navegador ou por outro app), o DeckTech pede uma confirmação extra antes de conectar (a única exceção é um link idêntico à conexão que o app já tem salva) — só confirme se foi você mesmo que abriu ou escaneou o link agora.

### iPhone, iPad e navegador

1. No host, abra **Conectar > Navegador**.
2. Escaneie ou digite a URL HTTP local no Safari ou navegador.
3. Informe o PIN de seis dígitos. No Safari, use **Compartilhar > Adicionar à Tela de Início** para instalar a PWA.

O navegador usa HTTP na rede local. Use a PWA somente em uma LAN confiável: o PIN controla o acesso, mas HTTP não impede que outro participante da rede observe ou altere o tráfego. Para o Android, prefira sempre o fluxo HTTPS fixado do QR **App Android**.

## OBS Studio

Na v0.1.0, a gaveta **OBS Commander** permite trocar cenas, iniciar e parar gravações e transmissões e fixar cenas no dock pela estrela ao lado de cada cena. Execute o OBS no mesmo computador que hospeda o DeckTech.

1. No OBS, abra **Ferramentas › Configurações do servidor WebSocket**.
2. Marque **Ativar servidor WebSocket** e use **Porta do servidor: 4455**.
3. Mantenha **Habilitar autenticação** marcado e clique em **Mostrar informações da conexão**.
4. Copie a senha, cole no campo da gaveta OBS do DeckTech e toque em **Salvar e conectar**.

O DeckTech também conecta se a autenticação do OBS estiver desativada, mas recomendamos mantê-la ativada. A senha salva fica somente no computador host, em `.obs-password`, nunca é devolvida ao telefone pelas respostas da API ou pelo feed WebSocket. Se você digitá-la no telefone, ela é enviada ao host ao salvar; prefira o Android com HTTPS para essa configuração. O arquivo usa ACL restrita ao usuário proprietário no Windows e permissão `0600` no macOS; o DeckTech reaplica essa proteção ao iniciar. Uma falha na aplicação da ACL é registrada no log, e um administrador pode retomar acesso ao arquivo.

Se não conectar, confirme que o OBS está aberto e o servidor WebSocket ativado. Para **senha incorreta**, copie novamente a senha atual do OBS e salve. Se a porta for diferente de **4455**, ajuste-a nas configurações do OBS. Não é necessária uma regra de firewall para a ligação DeckTech–OBS: ela é local, em `127.0.0.1`, no mesmo computador (isso não altera os requisitos de rede entre telefone e DeckTech).

## Verificar os checksums

Baixe o artefato e `SHA256SUMS.txt` na mesma pasta. Compare o hash do arquivo com a linha correspondente:

```powershell
certutil -hashfile DeckTech-Setup.exe SHA256
```

```sh
shasum -a 256 DeckTech-macOS.dmg
sha256sum decktech.apk
```

O arquivo [`DeckTech-macOS.dmg.sha256`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/DeckTech-macOS.dmg.sha256) também verifica especificamente o DMG.

## Termos, privacidade e componentes de terceiros

- [Contrato de Licença de Uso (EULA)](EULA.md): a versão em português é a juridicamente vinculante; o texto em inglês, [EULA.en.md](EULA.en.md), é uma tradução de cortesia. A tela de primeira abertura do Windows mostra os dois textos (o inglês primeiro, a menos que o idioma do sistema seja o português); em caso de divergência, prevalece o texto em português.
- [Aviso de Privacidade](PRIVACY.pt-BR.md)
- [Avisos de terceiros](THIRD_PARTY_NOTICES.md)
- [Licença desta documentação](LICENSE)

Os binários são gratuitos, proprietários e licenciados pelo EULA. Licenças de componentes de terceiros continuam valendo para esses componentes.

## Suporte e segurança

- Bugs reproduzíveis: [abrir uma Issue](https://github.com/produtoramaxvision/DeckTech/issues/new?template=bug_report.yml)
- Ideias: [abrir uma Discussion](https://github.com/produtoramaxvision/DeckTech/discussions/categories/ideas)
- Instalação e dúvidas: [SUPPORT.pt-BR.md](SUPPORT.pt-BR.md)
- Contato direto: [contato@decktech.com.br](mailto:contato@decktech.com.br)
- Vulnerabilidades: [SECURITY.pt-BR.md](SECURITY.pt-BR.md), sem publicar detalhes sensíveis em Issues

Ao participar, siga o [Código de Conduta](CODE_OF_CONDUCT.pt-BR.md). O repositório não recebe Pull Requests de código; veja [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md).
