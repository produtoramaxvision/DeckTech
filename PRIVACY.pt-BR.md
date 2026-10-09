[English](PRIVACY.md) | Português (Brasil)

# Aviso de Privacidade

Versão 1.0. Vigente a partir de 2 de outubro de 2026. Substitui o aviso de 27 de setembro de 2026.

**O que mudou em relação ao aviso de 27 de setembro de 2026:**

- o aviso passa a cobrir o DeckTech PRO: compra, entrega da licença, ativação e verificações da licença, vagas de aparelhos, o complemento para a Alexa e as integrações locais;
- novas tabelas mostram o que a versão gratuita envia e o que o PRO envia, com destinatário, motivo, prazo e base legal;
- a verificação de atualizações passa a ser feita ao iniciar com internet, e no Windows a atualização é baixada e instalada pelo aplicativo;
- entram os registros de acesso que o Marco Civil da Internet exige e os prazos de guarda do registro da venda e da desistência;
- entram a lista de fornecedores (Stripe, Resend, Cloudflare, Amazon Web Services), a transferência internacional e os seus direitos sem conta.

O responsável por este aviso (o controlador, na LGPD) é Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP. Endereço do fornecedor: Rua Orense, 41, Diadema/SP, Brasil. Para qualquer assunto de privacidade, inclusive para exercer os seus direitos, escreva para [contato@decktech.com.br](mailto:contato@decktech.com.br) e identifique a mensagem como assunto de privacidade. A MaxVision é um agente de tratamento de pequeno porte e não nomeou encarregado pelo tratamento de dados pessoais, conforme a Resolução CD/ANPD nº 2/2022. Esse e-mail é o canal de comunicação com os titulares dos dados.

## Em resumo

O DeckTech não tem conta e não tem telemetria da Produtora MaxVision. A versão gratuita funciona na sua rede local e só usa a internet para as consultas listadas abaixo. O DeckTech PRO acrescenta uma compra, uma ativação da licença, verificações em segundo plano e, se você quiser, o complemento para a Alexa. Cada um deles está descrito abaixo: o que sai da sua rede, para quem, para quê e por quanto tempo.

## O que a versão gratuita envia

| Quando | O que o DeckTech faz | Para onde | O que vai junto |
|---|---|---|---|
| No Windows, ao iniciar com internet e quando o painel pergunta se há versão nova (no máximo uma vez a cada 10 minutos) | Consulta a página da última versão | GitHub | Uma conexão segura comum, sem conta, código de acesso, lista de apps ou configurações. O GitHub vê os dados técnicos normais da conexão, como o endereço IP |
| No macOS, quando a janela principal abre e quando você pede | Consulta as informações públicas da última versão | GitHub | O nome do app e a versão instalada, no cabeçalho de identificação do pedido, e os dados técnicos da conexão |
| No Android, quando você toca em atualizar | Baixa o instalador da versão nova | GitHub | O pedido de download e os dados técnicos da conexão |
| No macOS, quando você escolhe instalar uma atualização | Baixa o arquivo da versão nova | GitHub | O pedido de download e os dados técnicos da conexão |
| No Windows, quando há versão nova | Baixa o instalador e o instala quando você fecha o aplicativo ou pelo botão de atualizar | GitHub | O pedido de download e os dados técnicos da conexão |
| Ao exibir atalhos de sites no painel do celular | Busca o ícone do site | Serviço de ícones do Google, ou arquivos do GitHub nos atalhos do GitHub; o ícone do próprio site é uma alternativa | O domínio do site (Google) ou o endereço do ícone, e os dados técnicos da conexão |
| No macOS, ao exibir atalhos de sites | Busca a página do site e os ícones | O site, os endereços de ícones que ele indica e, para alguns sites conhecidos, um endereço fixo de ícone | O endereço pedido e os dados técnicos da conexão |
| Quando você abre sites e links pelo DeckTech | Abre o site ou o link | O site que você abriu | O que o navegador e o site normalmente trocam; vale a política de cada site |

No Windows, os atalhos de sites do computador usam monogramas, sem essas consultas. O DeckTech não envia à Produtora MaxVision conta, código de acesso, lista de apps, configurações nem dados de uso. A verificação de atualizações está descrita na seção própria abaixo.

## O que o PRO envia

| Recurso | O que sai da sua rede | Para quem | Quando |
|---|---|---|---|
| Compra | O que você digitar na página de pagamento (por exemplo, e-mail, nome, país e dados do meio de pagamento) | Stripe | Na compra |
| Entrega da licença | O seu e-mail e o código da licença, para enviar a mensagem | Resend, provedor de e-mail | Depois do pagamento e quando você pedir o reenvio |
| Ativação | O código da licença, uma chave pública criada no seu computador para esse fim, a versão do DeckTech e o tipo de sistema (Windows ou macOS) | Serviço de licenças da MaxVision, na Cloudflare | Uma vez por computador |
| Verificações | Um número aleatório que identifica a vaga do computador, um contador, a versão do DeckTech, o tipo de sistema e uma assinatura feita no computador | Serviço de licenças da MaxVision, na Cloudflare | Quando o DeckTech inicia com internet |
| Liberar ou trocar vagas | O número aleatório da vaga e a quantidade de vagas de celulares | Serviço de licenças da MaxVision, na Cloudflare | Quando você libera ou troca |
| Gerenciar vagas pelo site | O e-mail que você digitar, só para receber um link de uso único | Serviço de licenças da MaxVision, na Cloudflare; e-mail pela Resend | Quando você pedir |
| Complemento para a Alexa (só se você ativar) | O código da licença e a prova da ativação do computador (uma vez), a versão do DeckTech, o nome, o tipo e o código das ações que você liberar para a Alexa, o estado ligado ou desligado da gravação e da transmissão, e os comandos recebidos | Nuvem da MaxVision, na Cloudflare, e adaptador na Amazon Web Services. A Amazon trata o que você diz à Alexa | Enquanto o complemento estiver ativo |
| Home Assistant, "Aparecer no Home Assistant", Philips Hue e pedidos de fora | Nada vai para a MaxVision. Os dados vão para o que você configurar: o seu Home Assistant, o seu servidor de mensagens, a sua ponte Hue | Esses serviços, no endereço que você informar, que pode estar fora da sua rede | Quando você usa |

As conexões desta tabela só acontecem quando você compra, ativa ou usa o PRO. O DeckTech PRO não tem conta de usuário: depois da compra, a MaxVision não pede cadastro nem senha para o PRO funcionar. O complemento para a Alexa só usa a nuvem do DeckTech se você o ativar.

## Verificação de atualizações

O DeckTech verifica se há versão nova ao iniciar com internet, consultando o GitHub, onde as versões são publicadas, como descrito na primeira tabela. No Windows, o DeckTech baixa a atualização do GitHub e a instala quando você fecha o aplicativo ou pelo botão de atualizar; no macOS e no Android, a instalação continua dependendo da sua confirmação. O GitHub pode registrar dados técnicos dessas conexões, como endereço IP, data, hora e agente do usuário, atuando como controlador independente conforme a sua [Declaração de Privacidade](https://docs.github.com/pt/site-policy/privacy-policies/github-general-privacy-statement). A Produtora MaxVision não recebe esses registros de forma individualizada, e o pedido não leva conta, licença, lista de apps nem dados de uso.

A MaxVision pode definir uma versão mínima do DeckTech por motivo de segurança, correção grave de defeito ou compatibilidade, nos termos do EULA. Essa regra não está ativa no lançamento.

## No seu computador e na sua rede

O DeckTech funciona prioritariamente na rede local, sem conta e sem telemetria da Produtora MaxVision. O computador guarda a configuração principal, o código de acesso, a chave privada do certificado de segurança e, se você configurar, a senha do WebSocket do OBS (em `.obs-password`, legível só pela sua conta de usuário). A senha do OBS nunca é devolvida aos clientes. Os clientes recebem os dados necessários ao painel e guardam a sessão; o Android também guarda o endereço do computador e o código de segurança do certificado. A chave privada do certificado não é enviada aos clientes. Esses dados trafegam somente entre os dispositivos que você conectar à sua rede local.

No DeckTech PRO, o computador guarda também o código da licença, a prova da ativação e, cifrados, os acessos às integrações que você configurar (por exemplo, o acesso ao seu Home Assistant). Esses dados ficam no computador e não são enviados à MaxVision.

## Compra do DeckTech PRO

- **Quando você clica em comprar**, sai do site da MaxVision e vai para a página de pagamento da Stripe, que tem política e cookies próprios. A MaxVision não recebe os dados do cartão.
- **Dados:** o que a página de pagamento pedir (por exemplo, e-mail, nome, país e dados do meio de pagamento, e o endereço IP). A MaxVision vê o e-mail e o estado do pagamento no painel da Stripe, e recebe da Stripe avisos de pagamento, estorno e contestação. A Stripe guarda os dados do pagamento pelo prazo que a lei exige dela, conforme a [política da Stripe](https://stripe.com/privacy#security-and-retention).
- **O que o serviço de licenças da MaxVision guarda:** o identificador da licença, os identificadores da sessão e do pagamento na Stripe, um valor embaralhado do e-mail (um hash feito com uma chave secreta, não o e-mail), o código da licença emitido, datas, o estado (ativa, cancelada ou em contestação) e se o e-mail foi enviado. O e-mail em si não é guardado nesse serviço nem escrito nos seus registros. Esse valor embaralhado ainda é dado pessoal, porque a MaxVision consegue recalculá-lo a partir do e-mail; por isso o tratamos como tal.
- **Resend:** recebe o seu e-mail e o código da licença para enviar a mensagem, e pode guardar registros do envio conforme a [política da Resend](https://resend.com/security/gdpr).
- **Para quê:** vender, entregar a licença, reenviá-la quando você pedir, cancelá-la em caso de devolução total do pagamento ou contestação perdida, e atender você.
- **Desistência pela página:** o e-mail informado é usado para enviar imediatamente, pela Resend, um recibo e um link de confirmação, como exige o Decreto 7.962/2013 (art. 5º, § 4º). Por 30 minutos, o serviço guarda o valor embaralhado do e-mail e o resumo criptográfico do link; o resumo é apagado quando o link é usado ou, se não for, na próxima manutenção depois que expira (a rotina roda a cada 10 minutos). O e-mail e o link em si não são guardados. Depois da confirmação, fica registrado o pedido, com a data, os identificadores da compra e do estorno e o estado do processamento, sem o e-mail. Esse registro permite devolver o pagamento pela Stripe, cancelar a licença e comprovar que o pedido foi atendido, e é mantido por 5 anos, como o registro da venda. Base legal: cumprimento de obrigação legal (LGPD, art. 7º, II; Código de Defesa do Consumidor, art. 49; Decreto 7.962/2013, art. 5º) e execução de contrato (art. 7º, V).
- **Por quanto tempo:** o registro da venda (a licença, os identificadores do pagamento na Stripe, as datas e o estado) é mantido por 5 anos, contados do início do ano seguinte ao da compra, mesmo que a licença seja cancelada (Código Tributário Nacional, art. 173; Código de Defesa do Consumidor, art. 27; LGPD, art. 16, I). Os demais dados desta seção ficam enquanto a licença existir. Apagamos a pedido verificado tudo o que a lei não nos obriga a guardar.
- **Base legal:** execução de contrato (LGPD, art. 7º, V), para vender e entregar a licença; cumprimento de obrigação legal ou regulatória (art. 7º, II), para guardar o registro da venda e os documentos fiscais.
- **Limite de pedidos:** nos pedidos de reenvio da licença, de gerenciamento de aparelhos e de desistência, o serviço guarda, por dia, um contador ligado ao valor embaralhado do e-mail digitado, só para limitar abusos (legítimo interesse, LGPD, art. 7º, IX). Esse contador é apagado depois de 30 dias.

## Ativação, verificações e vagas

- **Dados enviados:** os da tabela do PRO. A chave pública é gerada pelo DeckTech no seu computador; a chave privada fica lá e nunca sai. O DeckTech não envia o nome do computador, o número de série nem identificadores do equipamento. Celulares e tablets não enviam nada ao serviço de licenças: quem controla as vagas deles é o computador.
- **O que o serviço de licenças guarda:** o número aleatório da vaga, o identificador da licença, a chave pública do computador, a quantidade de vagas de celulares, um contador, o estado da vaga (ativa, liberada ou cancelada), o tipo de sistema, a versão do DeckTech, e os dias (sem hora) da ativação, da última verificação (no máximo uma vez por dia) e da liberação. Guarda também um registro de eventos de vagas (tipo e dia) para aplicar os limites de ativação. Um valor embaralhado do link de uso único enviado por e-mail fica guardado por 30 minutos.
- **Para quê:** contar os aparelhos do plano, aplicar o limite de aparelhos, saber se a licença foi cancelada e evitar o uso do mesmo código por muitas pessoas.
- **Por quanto tempo:** enquanto a licença existir; uma vaga liberada é apagada 180 dias depois da liberação; o registro de eventos de vagas é guardado por 400 dias.
- **Endereço IP:** a Cloudflare processa o endereço IP para entregar a conexão. Para limitar abusos, o serviço de licenças usa o endereço IP como chave de contagem de pedidos por alguns minutos (cerca de 5) e não o escreve nos registros de funcionamento do serviço. O endereço IP também é guardado como registro de acesso, descrito na seção "Registros de acesso".
- **Base legal:** execução de contrato (LGPD, art. 7º, V); prevenção de fraude e de uso indevido da licença, como finalidade informada (art. 6º, I) e, para os limites contra abuso, legítimo interesse (art. 7º, IX).

## Registros de acesso

- **Escopo da nuvem Alexa:** a nuvem do DeckTech também guarda o endereço IP, a data e a hora em UTC e o tipo de serviço somente para o aplicativo do computador e a página de conexão com a Alexa (operações validadas do computador, formulários válidos de conexão e conexão concluída). Pedidos dos servidores da Amazon ou do adaptador na AWS, incluindo comandos Alexa e trocas de acesso, não geram registros de acesso do usuário. Verificações de funcionamento, desafios sem armazenamento, páginas desconhecidas, métodos incorretos e pedidos recusados não geram registros de acesso na nuvem. Esses registros não guardam conteúdo do pedido, parâmetros nem códigos de acesso. A mesma exclusão após 183 dias e o acesso restrito descritos abaixo se aplicam, inclusive após remover o computador do serviço.

- **O que é guardado:** a cada uso das páginas e dos serviços do endereço decktech.com.br/pro (compra concluída, recuperação da licença, desistência, gerenciamento de aparelhos, ativação sem internet, as conexões do DeckTech para ativar, verificar e liberar a licença, e os avisos de pagamento da Stripe), o serviço de licenças da MaxVision guarda o endereço IP, a data e a hora (em UTC) e o tipo de página ou serviço usado. Não guarda e-mail, conteúdo do pedido, código da licença nem o endereço completo com parâmetros.
- **Para quê e base legal:** cumprimento de obrigação legal (LGPD, art. 7º, II). O Marco Civil da Internet (Lei 12.965/2014, art. 15) manda o provedor de aplicações de internet constituído como pessoa jurídica, que exerce a atividade de forma organizada, profissional e com fins econômicos, guardar os registros de acesso, sob sigilo, em ambiente controlado e seguro, por 6 meses.
- **Por quanto tempo:** 6 meses. A rotina automática do serviço apaga os registros com mais de 183 dias.
- **Quem pode ver:** nenhuma página nem serviço do site mostra esses registros. Ficam em banco de dados criptografado (Cloudflare D1) e só a MaxVision, que o administra, tem acesso. A MaxVision só os entrega a terceiros por ordem judicial (Lei 12.965/2014, arts. 10, § 1º, e 15, § 3º). A autoridade policial ou administrativa e o Ministério Público podem pedir, como medida cautelar, que sejam guardados por mais tempo (art. 15, § 2º); a entrega continua dependendo de ordem judicial.

## Complemento para a Alexa

- **Só se você ativar.** O complemento é opcional. O DeckTech gratuito, e o PRO sem o complemento, não usam a nuvem do DeckTech.
- **Dados enviados quando você ativa:** o código da licença e a prova da ativação do computador (usados uma vez no registro; a nuvem guarda apenas valores embaralhados do identificador da licença e do identificador da vaga), a versão do DeckTech, e o nome, o tipo e o código de cada ação que você liberar para a Alexa. O nome é um texto que você escreve e pode conter dados pessoais.
- **O que a nuvem guarda:** o identificador do computador na nuvem, um valor embaralhado da chave dele, o valor embaralhado do identificador da licença, o estado, as datas de criação e da última conexão (gravada no máximo uma vez por hora), a versão do DeckTech, as ações liberadas (nome e tipo), as ligações com a Alexa (identificador, data de criação e dia do último uso, e valores embaralhados dos códigos de acesso), o estado ligado ou desligado da gravação e da transmissão, e, por 10 minutos, um registro para não repetir o mesmo comando. Não guardamos histórico de comandos.
- **Quando você pede algo à Alexa:** a Alexa envia o pedido ao adaptador, que o repassa à nossa nuvem como o código de uma ação, não como o texto falado, e a nuvem o repassa ao seu computador. A MaxVision não recebe a sua conta, e-mail ou senha da Amazon.
- **Endereço IP:** a Cloudflare o processa para entregar a conexão. Para limitar tentativas de abuso, a nuvem usa uma versão embaralhada do IP, com chave que muda todo dia, por até 24 horas. Separadamente, os registros de acesso somente do aplicativo do computador e da página de conexão com a Alexa guardam o IP real por 6 meses (exclusão após 183 dias), conforme o art. 15 do Marco Civil da Internet. Pedidos dos servidores da Amazon e do adaptador na AWS ficam excluídos; remover o computador não apaga esses registros sujeitos à retenção legal.
- **Amazon:** a Amazon trata o que você diz à Alexa e os nomes das ações, como controladora independente, conforme a [política de privacidade dela](https://www.amazon.com/gp/help/customer/display.html?nodeId=GX7NJQ4ZB8MHFRNJ). O adaptador do complemento roda na Amazon Web Services (região Leste dos EUA, Norte da Virgínia), vê os códigos de acesso e os códigos das ações em trânsito e não guarda histórico de comandos.
- **Por quanto tempo:** enquanto a conexão existir. Conexões do computador sem uso por 180 dias são apagadas; ligações com a Alexa sem uso por 365 dias também. Você apaga tudo, exceto os registros de acesso, guardados por lei por 6 meses (art. 15 do Marco Civil da Internet), a qualquer momento, no DeckTech, em "Esquecer este computador".
- **Base legal:** execução de contrato (LGPD, art. 7º, V), porque o complemento faz parte da licença; legítimo interesse (art. 7º, IX) para os limites contra abuso.

## Integrações locais

Home Assistant, "Aparecer no Home Assistant", Philips Hue e os pedidos de fora do DeckTech não passam pela MaxVision. O DeckTech se conecta ao endereço que você informar: o seu Home Assistant, o seu servidor de mensagens e a sua ponte Hue. Quem escolhe esse endereço é você, e ele pode estar fora da sua rede; então os dados trafegam até lá pela internet e passam a seguir as regras de quem os recebe. O DeckTech não usa o serviço da Philips Hue que localiza pontes pela internet: a ponte é encontrada na sua rede local ou pelo endereço que você digitar. Os acessos a esses serviços ficam guardados, cifrados, só no seu computador.

Os pedidos de fora (por exemplo, de um atalho do iPhone ou de uma regra do Home Assistant) chegam ao seu computador pela rede local e só executam as ações que você liberar, com um código de acesso que você cria. Em conexões sem criptografia, esse código pode ser lido por outros aparelhos da mesma rede; use somente em rede confiável e revogue o código se desconfiar.

## Fornecedores e seus papéis

| Fornecedor | Para quê | Papel | Política |
|---|---|---|---|
| Stripe | Pagamento e estorno | Controladora independente para os dados de pagamento; a MaxVision recebe o resultado | [Política da Stripe](https://stripe.com/br/privacy) |
| Resend | Envio do e-mail com a licença | Operadora | [Política da Resend](https://resend.com/legal/privacy-policy) |
| Cloudflare | Hospedagem do site, serviço de licenças, nuvem do complemento para a Alexa, recebimento do e-mail de contato | Operadora | [Política da Cloudflare](https://www.cloudflare.com/privacypolicy/) |
| Amazon Web Services | Adaptador do complemento para a Alexa | Operadora | [Política da AWS](https://aws.amazon.com/privacy/) |
| Amazon (Alexa) | Voz e nomes das ações | Controladora independente | [Política da Amazon](https://www.amazon.com/gp/help/customer/display.html?nodeId=GX7NJQ4ZB8MHFRNJ) |
| GitHub | Versões e atualizações; relatos públicos | Controlador independente | [Declaração do GitHub](https://docs.github.com/pt/site-policy/privacy-policies/github-general-privacy-statement) |
| Google | Ícones de sites no painel do celular | Controlador independente | [Política do Google](https://policies.google.com/privacy?hl=pt-BR) |

As mensagens enviadas para contato@decktech.com.br chegam pelo serviço de encaminhamento de e-mail da Cloudflare até a caixa da MaxVision.

## Transferência internacional

Esses fornecedores podem tratar dados fora do Brasil, em especial nos Estados Unidos: a rede da Cloudflare é global, e o adaptador do complemento para a Alexa roda na região Leste dos EUA da Amazon Web Services. Base: transferência necessária para a execução do contrato (LGPD, art. 33, IX, combinado com o art. 7º, V), ou garantias contratuais (art. 33, II), conforme o fornecedor.

## Seus direitos, sem conta

A LGPD (Lei 13.709/2018, art. 18) garante a você, a qualquer momento e mediante requisição: confirmar se tratamos dados seus; acessar os dados; corrigir dados incompletos, inexatos ou desatualizados; pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei; pedir a portabilidade a outro fornecedor; pedir a eliminação dos dados tratados com o seu consentimento; saber com quais entidades compartilhamos os dados; saber que pode não dar consentimento e quais as consequências; e revogar o consentimento.

Os dados que a lei obriga a MaxVision a guardar (o registro da venda e os registros de acesso) não podem ser apagados antes do fim do prazo legal (LGPD, art. 16, I).

Como o DeckTech não tem conta, a MaxVision não tem um cadastro seu. Para exercer os seus direitos:

- escreva para [contato@decktech.com.br](mailto:contato@decktech.com.br) com o assunto "Privacidade", a partir do e-mail usado na compra; calculamos o valor embaralhado desse e-mail e procuramos a compra e os computadores ligados à licença; você não precisa enviar documentos;
- se você ativou o complemento para a Alexa, pode apagar tudo, exceto os registros de acesso, guardados por lei por 6 meses (art. 15 do Marco Civil da Internet), no próprio DeckTech, em "Esquecer este computador", ou pedir por e-mail informando o código do computador que o DeckTech mostra;
- a confirmação de que tratamos os seus dados ou o acesso a eles é dada de forma simplificada, na hora, ou por declaração completa em até 15 dias, contados do pedido (LGPD, art. 19);
- pedidos sobre dados que estão na Stripe, na Resend, na Amazon, no GitHub ou no Google também podem ser feitos a elas;
- o titular também pode peticionar contra o controlador perante a Autoridade Nacional de Proteção de Dados (LGPD, art. 18, § 1º).

## Crianças

O DeckTech não é dirigido a crianças.

## Este site

O site decktech.com.br é hospedado na Cloudflare, que processa dados técnicos das requisições, como endereço IP, para entregar e proteger o site, conforme a [Política de Privacidade da Cloudflare](https://www.cloudflare.com/privacypolicy/). Sem consentimento de marketing, as páginas não carregam recursos de rastreamento de marketing de terceiros; a Cloudflare pode definir cookies técnicos próprios de segurança conforme a política dela. O Cloudflare Web Analytics mede visitas ao site sem cookies e sem identificar o visitante. As preferências de tema e idioma ficam salvas apenas no seu navegador. Os links para a compra levam à página de pagamento da Stripe, e os links para o GitHub (Issues, Discussions e versões) levam a páginas do GitHub; o que você publicar lá fica público e segue os termos e a política de privacidade do GitHub.

## Cookies opcionais de marketing

O site usa o Meta Pixel, somente com seu consentimento (LGPD art. 7º, I), para medir visitas e cliques em baixar, medir campanhas publicitárias e personalizar anúncios. Nenhum recurso da Meta é carregado antes de você aceitar os cookies de marketing. Após o aceite, o Pixel usa o cookie próprio `_fbp`, com duração de 90 dias, conforme a [Política de Cookies da Meta](https://www.facebook.com/privacy/policies/cookies/). A Meta Platforms recebe os eventos de visita e de download e informações relacionadas ao navegador, conforme a [Política de Privacidade da Meta](https://www.facebook.com/privacy/policy/); isso pode envolver transferência internacional e tratamento fora do Brasil. Recusar é tão fácil quanto aceitar, e você pode retirar o consentimento em "Preferências de cookies" no rodapé. A escolha fica apenas no seu navegador por 12 meses, separadamente da duração do cookie. A retirada interrompe o rastreamento seguinte e remove os cookies próprios do Pixel; não desfaz informações já enviadas à Meta após o aceite nem remove cookies nos domínios da Meta.

## Issues e relatos no GitHub

Ao abrir Issues, Discussions ou relatos privados de vulnerabilidade, você fornece ao GitHub e aos mantenedores o conteúdo e os dados de perfil que decidir publicar. Não inclua certificados privados, códigos de acesso, senhas, códigos de licença, endereços pessoais ou logs não revisados.

## Alterações deste aviso

A Produtora MaxVision pode alterar este aviso. A nova versão será publicada nos canais oficiais com a data de vigência.

## Contato

Para dúvidas sobre privacidade, escreva para [contato@decktech.com.br](mailto:contato@decktech.com.br) e identifique a mensagem como assunto de privacidade. O uso do DeckTech PRO é regido pelos [Termos do DeckTech PRO](https://decktech.com.br/termos-pro) e o uso do DeckTech pelo Contrato de Licença de Uso (EULA).
