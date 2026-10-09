[English](SUPPORT.md) | [Português (Brasil)](SUPPORT.pt-BR.md) | Español | [Русский](SUPPORT.ru.md) | [简体中文](SUPPORT.zh-CN.md)

# Soporte

Responsable: Produtora MaxVision, São Paulo/Brasil.

Esta es una traducción al español de SUPPORT.md. Los mensajes de la aplicación que se citan entre comillas se reproducen tal como los muestra la app, en inglés o en portugués, porque DeckTech no tiene interfaz en español (consulta la nota de idiomas en el [README](README.es.md)).

## Instalación y preguntas

Lee primero el [README](README.es.md), incluidas las indicaciones sobre SmartScreen, Gatekeeper, el emparejamiento y las sumas de comprobación.

- Para una pregunta que no sea sensible, usa [Discussions](https://github.com/produtoramaxvision/DeckTech/discussions).
- Para un defecto reproducible, abre el [formulario de informe de errores](https://github.com/produtoramaxvision/DeckTech/issues/new?template=bug_report.yml).
- Para una idea, usa la categoría [Ideas](https://github.com/produtoramaxvision/DeckTech/discussions/categories/ideas).
- Para contacto directo, escribe a [contato@decktech.com.br](mailto:contato@decktech.com.br).
- Para vulnerabilidades, sigue [SECURITY.md](SECURITY.md); nunca publiques el informe.

Indica la versión y la plataforma. Antes de adjuntar registros o capturas de pantalla, oculta los códigos de acceso, las direcciones IP, los nombres de usuario, las rutas personales y otros datos sensibles. El soporte es comunitario y no tiene un SLA garantizado.

## Solución de problemas

- **Código de acceso rechazado o bloqueado.** Si el deck muestra "Too many attempts — wait {s}s.", el anfitrión ha bloqueado temporalmente tu dispositivo tras 5 códigos incorrectos, y {s} es el tiempo restante en segundos. El bloqueo empieza en 60 segundos y se duplica con cada bloqueo consecutivo (60 s, 2 min, 4 min... hasta 1 h); probar desde otro dispositivo de la misma red evita ese bloqueo concreto (cada dispositivo tiene el suyo), pero no el global: 5 dispositivos DISTINTOS que fallen el código en un plazo de 2 horas provocan un bloqueo de 30 minutos para los nuevos inicios de sesión desde cualquier dispositivo (que se duplica hasta 24 h con cada nuevo disparo; los intentos repetidos desde el MISMO dispositivo nunca cuentan más de una vez), y durante ese tiempo se rechaza incluso el código de acceso correcto. Espera el tiempo indicado y comprueba el código de acceso en la pestaña **Connect** del anfitrión. Si aparece "Wrong code.", introduce el código de acceso actual que muestra el anfitrión.
- **Puerto HTTPS en uso.** Si el anfitrión muestra "HTTPS for the Android app could not start because port {port} is already in use. Close the other app using that port and try again.", cierra la otra aplicación que usa el puerto indicado y reinicia DeckTech. El acceso desde el navegador sigue funcionando por HTTP en una red de confianza. En Windows este mensaje aparece siempre en portugués; en macOS sigue el idioma elegido en la app.
- **Certificado cambiado.** Si la app de Android muestra "The computer certificate changed" y "The connection was blocked because the certificate changed.", compara el nuevo código con el **Security code** de la pestaña **Connect** del anfitrión. Toca **Replace after checking** solo si los códigos coinciden.
- **Emparejamiento rechazado por estar en otra red.** Si la pestaña **Connect** del anfitrión muestra "This computer has no local-network address available for the Android app — check that the computer and phone are on the same local network (Wi-Fi or Ethernet, not a VPN).", el equipo no tiene una dirección de red local (LAN) que ofrecer a la app de Android; conéctalo al mismo Wi-Fi o Ethernet que el teléfono (no a una VPN) y vuelve a cargar la pestaña. Si, en cambio, el teléfono muestra "This pairing link points to an address outside your local network or Tailscale, so it was ignored for security. DeckTech only pairs within the LAN or Tailscale.", el enlace de emparejamiento que usaste apunta a una dirección fuera de la LAN o de la Tailscale de esta instalación; genera un nuevo código QR o código en la pestaña **Connect** del equipo con el que realmente quieres emparejar, en la misma red que el teléfono.
- **Aviso al abrir un enlace de emparejamiento fuera de la app.** Si el teléfono pide confirmación con "This link was opened outside the app (camera, browser, or another app) — only continue if you just opened or scanned it yourself, right now, from your own computer.", confirma solo si eres tú quien acaba de escanear o abrir ese código QR o enlace, en tu propio equipo; en caso contrario, toca cancelar (el botón de cancelar ya está seleccionado por defecto).
- **Pantalla del contrato de licencia (EULA) en el primer inicio.** Windows, macOS y Android piden que aceptes el contrato de licencia antes del primer uso. En Windows, debes marcar la casilla de aceptación para habilitar el botón de aceptar; rechazar cierra la aplicación. El texto jurídicamente vinculante es el [EULA.md](EULA.md) en portugués, que prevalece; se ofrece una [traducción al inglés](EULA.en.md) por comodidad.
- **Dónde están tus datos.** En Windows, en `%LOCALAPPDATA%\DeckTech`; se conservan al desinstalar, a menos que marques **Remover também os dados do usuário** (el desinstalador está en portugués). En macOS, en `~/Library/Application Support/DeckTech`.

## Apoya el proyecto

Para aportes voluntarios, patrocinios, alianzas o contratar al estudio,
consulta [Apoya el proyecto](SUPPORT_THE_PROJECT.es.md). Son asuntos separados
del soporte técnico; no necesitas aportar dinero para pedir ayuda.

## OBS Studio

Para configurar OBS o resolver una contraseña incorrecta, un servidor desactivado o un puerto distinto de 4455, consulta [OBS Studio en el README](README.es.md#obs-studio). No adjuntes nunca tu contraseña de OBS ni la información de conexión a una solicitud de soporte.
