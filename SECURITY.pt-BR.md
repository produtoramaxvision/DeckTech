[English](SECURITY.md) | Português (Brasil)

# Política de Segurança

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

O app Android só aceita um link de pareamento (`decktech://pair`) cujo host seja um endereço IPv4 de rede privada (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), um endereço da faixa do Tailscale (100.64.0.0/10) ou um nome `.local`; qualquer outro endereço é recusado, mesmo que o link esteja bem formado — o DeckTech nunca pareia pela internet. O app confere a faixa do endereço, não se ele pertence a um computador específico: o código de segurança e o PIN ainda precisam bater com o computador que você quer parear. Ao anunciar o pareamento, o Windows e o macOS preferem sempre um endereço de rede privada quando o computador tem mais de um, e mostram um aviso na tela Conectar quando nenhum está disponível, em vez de oferecer um QR que o app Android recusaria de qualquer forma. Um link de pareamento aberto fora do próprio app (câmera, navegador ou outro app) exige confirmação explícita, com o host e a porta em destaque e o botão de cancelar focado por padrão; o único link aceito sem esse diálogo é um idêntico à conexão que o app já tem salva.

## Bloqueio por PIN e permissões do Electron

O acesso por PIN é protegido contra força bruta: 5 falhas do mesmo endereço bloqueiam esse endereço por 60 segundos, dobrando a cada novo bloqueio seguido até 1h; um limite global bloqueia novos logins por PIN de qualquer endereço por 30 minutos após 5 endereços DISTINTOS falharem dentro de 2 horas (falhas repetidas do mesmo endereço não contam mais de uma vez — um único cliente mal-comportado nunca dispara o bloqueio global sozinho), dobrando até 24h a cada novo gatilho (aparelhos já conectados continuam funcionando). Mesmo o PIN correto é recusado enquanto um desses bloqueios estiver ativo, e a resposta informa quanto tempo falta. No app Windows (Electron), qualquer solicitação de permissão do navegador embutido (câmera, notificações, geolocalização etc.) é negada por padrão desde antes da primeira janela aberta (incluindo a tela do contrato de licença), como defesa em profundidade — a interface hoje não solicita nenhuma.
