<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/decktech-logo-dark.webp 1x, assets/decktech-logo-dark@2x.webp 2x">
    <source media="(prefers-color-scheme: light)" srcset="assets/decktech-logo-light.webp 1x, assets/decktech-logo-light@2x.webp 2x">
    <img src="assets/decktech-logo-light.webp" width="180" alt="DeckTech">
  </picture>
</p>

<h1 align="center">DeckTech</h1>

<p align="center"><a href="README.md">English</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <strong>Español</strong> | <a href="README.ru.md">Русский</a> | <a href="README.zh-CN.md">简体中文</a></p>

DeckTech convierte un Mac o un PC con Windows en el anfitrión de un dock remoto de aplicaciones. La aplicación inicia un servidor Node.js local y ofrece su interfaz a los dispositivos de la misma red mediante el APK de Android, una PWA en iPhone o un navegador.
Con DeckTech PRO, el teléfono también controla la casa mediante Home Assistant y Philips Hue (Beta).

Esta guía corresponde a DeckTech v0.1.1.

Este repositorio público contiene únicamente documentación, soporte de la comunidad y versiones oficiales. DeckTech es software propietario y su código fuente no se publica.

Responsable y licenciante: Produtora MaxVision, São Paulo/Brasil.

> Esta es una traducción al español de la documentación en inglés. La interfaz de DeckTech existe hoy en portugués (Brasil) e inglés, y no en español. En Windows, la ventana del anfitrión está solo en portugués en esta versión; en macOS, el anfitrión tiene un selector de idioma (Português/English); la app de Android y la PWA usan el portugués cuando el idioma del dispositivo empieza por «pt» y el inglés en cualquier otro caso. Por eso, en un dispositivo en español verás la interfaz en inglés, salvo la ventana del anfitrión en Windows, que está en portugués. Los nombres de botones, pestañas y menús de la aplicación se escriben aquí tal como ella los muestra.

## Descargas

| Plataforma | Descarga directa |
|---|---|
| Windows 10 u 11 (64 bits, x64, compilación 10240 o posterior) | [`DeckTech-Setup.exe`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/DeckTech-Setup.exe) |
| Android 5.0+ | [`decktech.apk`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/decktech.apk) |
| macOS 14+ | [`DeckTech-macOS.dmg`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/DeckTech-macOS.dmg) |

También puedes consultar la [última versión publicada](https://github.com/produtoramaxvision/DeckTech/releases/latest) y el archivo [`SHA256SUMS.txt`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/SHA256SUMS.txt). No instales nunca un APK de depuración (Debug) ni archivos recibidos por canales no oficiales.

## Instalar con un agente de IA

Pega el siguiente prompt en tu agente de programación o de escritorio para instalar DeckTech y aprender a usarlo.
El agente debe pedir permiso antes de los cambios y dejar las contraseñas y las confirmaciones de seguridad en tus manos.

```text
Help me install and set up DeckTech. Respond in my language and ask before each step that changes my system. Detect my OS: Windows 10/11, 64-bit x64, build 10240 or later, or macOS 14 or later; stop if unsupported. Read the README and manual from the official produtoramaxvision/DeckTech GitHub repository, and follow their documented installation steps without inventing command flags. Download release files ONLY from https://github.com/produtoramaxvision/DeckTech/releases/latest: DeckTech-Setup.exe for Windows, DeckTech-macOS.dmg for macOS, decktech.apk only if I want Android, SHA256SUMS.txt, and optionally DeckTech-macOS.dmg.sha256. Verify each artifact's SHA-256 against SHA256SUMS.txt BEFORE running or opening it; stop if a checksum is missing or differs. On Windows, run the installer; if SmartScreen appears, let me confirm the official source and matching hash and select More info / Run anyway only if I accept the risk. On macOS, open the DMG and drag DeckTech to Applications; let me Control-click DeckTech, choose Open and confirm; if Gatekeeper blocks it, try once and use System Settings > Privacy & Security > Security > Open Anyway. Never ask for, receive or type passwords; never disable security software or run as administrator beyond what the installer itself asks. Leave password entry and security confirmations to me. Guide first use in order: open DeckTech, let me read and accept the licence, pair my phone using the QR code / six-digit access code on the same Wi-Fi, pin my first apps, optionally connect OBS with me entering its password privately, optionally activate PRO with me entering my licence privately, and show me the manual in the same repository. Explain each step and stop for my approval before changes.
```

## Instalación y primer uso

### Windows

1. Descarga y ejecuta `DeckTech-Setup.exe`.
2. El instalador actual no está firmado. Si aparece Microsoft Defender SmartScreen, comprueba que el archivo procede de este repositorio y que su SHA-256 coincide; selecciona **More info** y **Run anyway** solo si aceptas el riesgo. Si Windows está en otro idioma, SmartScreen mostrará esos nombres traducidos.
3. En el primer inicio, DeckTech muestra el contrato de licencia (EULA): marca la casilla de aceptación para habilitar **Accept and start** o elige **Decline and quit** para cerrar la aplicación. Rechazar no se recuerda: el contrato se vuelve a mostrar en el siguiente inicio, y la aplicación sigue instalada hasta que la quites en **Settings > Apps**. Los textos de los botones están en portugués (**Aceitar e começar** / **Recusar e sair**) cuando el idioma de tu sistema es el portugués.
4. DeckTech requiere Windows 10 u 11 (64 bits, x64, compilación 10240 o posterior); el instalador rechaza versiones anteriores y Windows de 32 bits. La interfaz del anfitrión en Windows está solo en portugués en esta versión: su pestaña **Conectar** (Connect) muestra la dirección local y el código de acceso de seis dígitos; una dirección solo aparece aquí si el equipo está en una red local (Wi-Fi o Ethernet), no solo en una VPN.

### macOS

1. Descarga `DeckTech-macOS.dmg`, ábrelo y arrastra DeckTech a **Applications**.
2. La app tiene firma ad hoc y no está notarizada. Haz clic en **DeckTech** con la tecla Control pulsada, elige **Open** y confirma. Si Gatekeeper la bloquea, inténtalo una vez y usa **System Settings > Privacy & Security > Security > Open Anyway**. Estos nombres de macOS aparecen en el idioma de tu sistema.
3. En el primer inicio, acepta el contrato de licencia (EULA) que se muestra antes de la ventana principal.
4. Abre la pestaña **Connect** para ver la dirección local y el código de acceso. A diferencia de Windows, la app de macOS tiene un selector de idioma (Português/English) en esa misma pestaña, y sus textos siguen el idioma que elijas allí.

### Android

1. Descarga `decktech.apk` de este repositorio y permite la instalación desde el navegador cuando Android lo pida.
2. En el primer inicio, acepta el contrato de licencia (EULA) que se muestra en la app.
3. En un anfitrión con Windows o macOS, abre **Connect > Android app** (en Windows: **Conectar > App Android**) y escanea el código QR con la cámara del teléfono. A partir de entonces, el APK confía únicamente en el certificado HTTPS de ese equipo. El equipo y el teléfono deben estar en la misma red local (LAN) o en la misma Tailscale; un enlace de emparejamiento que apunte a cualquier otro lugar se rechaza por seguridad (consulta [Solución de problemas en SUPPORT.es.md](SUPPORT.es.md#solución-de-problemas)).
4. Cuando la app encuentra el equipo mediante la detección automática, muestra un código de seguridad de 16 caracteres (`XXXX-XXXX-XXXX-XXXX`). Confirma solo si coincide, carácter por carácter, con el **Security code** (en Windows: **Código de segurança**) de la pestaña **Connect** del anfitrión.
5. Introduce el código de acceso de seis dígitos. Si el certificado del equipo cambia, la app te pide confirmar de nuevo. Si abres el enlace de emparejamiento fuera de la app (con la cámara, un navegador u otra app), DeckTech pide una confirmación adicional antes de conectar (la única excepción es un enlace idéntico a la conexión que la app ya tiene guardada); confirma solo si eres tú quien acaba de abrir o escanear el enlace.

### iPhone, iPad y navegadores

1. En el anfitrión, abre **Connect > Browser** (en Windows: **Conectar > Navegador**).
2. Escanea o introduce la URL HTTP local en Safari u otro navegador.
3. Introduce el código de acceso de seis dígitos. En Safari, usa **Share > Add to Home Screen** para instalar la PWA.

La conexión desde el navegador usa HTTP en la red local. Usa la PWA solo en una LAN de confianza: el código de acceso controla el acceso, pero HTTP no puede impedir que otro participante de la red observe o modifique el tráfico. En Android, da siempre preferencia al flujo HTTPS fijado del código QR de **Android app**.

## OBS Studio

El panel **OBS Commander** puede cambiar de escena, iniciar y detener la grabación y la transmisión, y fijar escenas en el dock con la estrella junto a cada escena. Ejecuta OBS en el mismo equipo que aloja DeckTech.

1. En OBS, abre **Tools › WebSocket Server Settings** (OBS muestra estos nombres en su propio idioma).
2. Marca **Enable WebSocket server** y usa **Server Port: 4455**.
3. Deja marcada **Enable Authentication** y haz clic en **Show Connect Info**.
4. Copia la contraseña, pégala en el panel de OBS de DeckTech y toca **Save and connect**.

DeckTech también se conecta cuando la autenticación de OBS está desactivada, pero recomendamos dejarla activada. La contraseña guardada permanece solo en el equipo anfitrión, en `.obs-password`; nunca se devuelve al teléfono en las respuestas de la API ni en el flujo WebSocket. Si la introduces en el teléfono, se envía al anfitrión al guardarla; para esta configuración, da preferencia a Android con HTTPS. El archivo usa una ACL exclusiva del propietario en Windows y permisos `0600` en macOS; DeckTech vuelve a aplicar esta protección al iniciarse. Los fallos de ACL se registran, y un administrador puede recuperar el acceso al archivo.

Si la conexión falla, comprueba que OBS esté abierto y que su servidor WebSocket esté habilitado. Si el problema es una **contraseña incorrecta**, vuelve a copiar la contraseña actual de OBS y guárdala. Si el puerto es distinto de **4455**, cámbialo en los ajustes de OBS. No hace falta ninguna regla de firewall para la conexión entre DeckTech y OBS: permanece local en `127.0.0.1`, en el mismo equipo (esto no cambia los requisitos de red entre el teléfono y DeckTech).

## Verificar las sumas de comprobación

Descarga el artefacto y `SHA256SUMS.txt` en la misma carpeta y compara el hash del archivo con su línea:

```powershell
certutil -hashfile DeckTech-Setup.exe SHA256
```

```sh
shasum -a 256 DeckTech-macOS.dmg
sha256sum decktech.apk
```

[`DeckTech-macOS.dmg.sha256`](https://github.com/produtoramaxvision/DeckTech/releases/latest/download/DeckTech-macOS.dmg.sha256) también verifica específicamente el DMG.

## Términos, privacidad y componentes de terceros

- [Contrato de licencia de usuario final (EULA), en portugués](EULA.md): la versión jurídicamente vinculante; el texto en inglés es [EULA.en.md](EULA.en.md), una traducción de cortesía. La pantalla de primer inicio de Windows muestra ambos textos (primero el inglés, salvo que el idioma de tu sistema sea el portugués); si los dos difieren, prevalece el texto en portugués.
- [Aviso de privacidad](PRIVACY.md)
- [Avisos de terceros](THIRD_PARTY_NOTICES.md)
- [Licencia de esta documentación](LICENSE)

Los binarios son gratuitos, propietarios y se licencian bajo el EULA. Las licencias de terceros siguen aplicándose a sus respectivos componentes.

Los documentos legales y de seguridad (EULA, aviso de privacidad y política de seguridad) no se traducen: los textos de referencia son los redactados en portugués e inglés ([EULA.md](EULA.md), [EULA.en.md](EULA.en.md), [PRIVACY.md](PRIVACY.md), [PRIVACY.pt-BR.md](PRIVACY.pt-BR.md), [SECURITY.md](SECURITY.md), [SECURITY.pt-BR.md](SECURITY.pt-BR.md)), y en el EULA prevalece el texto en portugués.

## Apoya el proyecto

Consulta [cómo apoyar DeckTech y proponer colaboraciones](SUPPORT_THE_PROJECT.es.md).
El apoyo financiero es opcional y separado del soporte técnico.

## Hecho por Produtora MaxVision

Produtora MaxVision es el estudio detrás de DeckTech, en São Paulo/Brasil. También puedes contratar
al estudio para proyectos y servicios separados; consulta la
[guía de apoyo al proyecto](SUPPORT_THE_PROJECT.es.md).
Conoce DeckTech en [decktech.com.br](https://decktech.com.br).

## Soporte y seguridad

- Errores reproducibles: [abre un Issue](https://github.com/produtoramaxvision/DeckTech/issues/new?template=bug_report.yml)
- Ideas: [inicia una Discussion](https://github.com/produtoramaxvision/DeckTech/discussions/categories/ideas)
- Instalación y preguntas: [SUPPORT.es.md](SUPPORT.es.md)
- Contacto directo: [contato@decktech.com.br](mailto:contato@decktech.com.br)
- Vulnerabilidades: [SECURITY.md](SECURITY.md); no publiques detalles sensibles en los Issues

La participación se rige por el [Código de conducta](CODE_OF_CONDUCT.es.md). El repositorio no acepta pull requests de código fuente; consulta [CONTRIBUTING.es.md](CONTRIBUTING.es.md).
