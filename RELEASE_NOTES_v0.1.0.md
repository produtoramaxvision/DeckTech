English | [Português (Brasil)](RELEASE_NOTES_v0.1.0.pt-BR.md)

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
- **OBS scenes** through obs-websocket, with the password kept on the computer only. DeckTech connects even without a password, when the WebSocket authentication is off (with a notice recommending you turn it on), and the mobile deck shows numbered steps to set up the OBS WebSocket server. Connecting to OBS happens in the background, so starting the app never waits on it. The OBS drawer on the phone has one header with the connection status, an **ON AIR** card for the live scene, a **List / Columns / Tabs** switch (remembered on each device), scenes grouped into numbered scenes and "Sources and utilities" (scenes whose names are not numbered), a dock-pin mode to choose scenes for the dock, and recording and streaming controls in the footer. When OBS is not connected, the drawer shows an offline panel with numbered setup steps, the password form and a **Try now** button.
- **6-digit PIN access**, with a progressively escalating per-address lockout (60s doubling up to 1h with each consecutive lockout) and a global limiter that blocks new PIN logins from any address for 30 minutes after 5 distinct addresses fail within 2 hours (doubling up to 24h with each new trigger; devices already signed in keep working). The server accepts requests only for `localhost` or one of the computer's own IPs and refuses state changes from another origin, which protects against DNS rebinding.
- **Pairing restricted to the local network.** The Android app only accepts a pairing link (`decktech://pair`) whose host is a private-network (RFC 1918) address, an address in Tailscale's range or a `.local` name; any other address is rejected, with a notice explaining why. If the computer has no local-network address available for the Android app, the Connect screen shows a notice instead of a QR code the phone would reject anyway. A pairing link opened outside the app itself (camera, browser, or another app) asks for confirmation, with the host and port highlighted and the Cancel button focused; only a link identical to the connection the app already has saved skips that dialog.
- **Automatic discovery** of the computer on the local network.
- **Portuguese (Brazil) and English** in the mobile deck, following the device language; language selection on macOS and the website. The Windows host UI is Portuguese-only in this release.
- **New version notice** in the deck, based on DeckTech's public releases page.
- **License agreement (EULA)** shown on first run of the Windows, macOS and Android applications; on Windows, an agreement checkbox must be ticked to enable acceptance.
- **Desktop "Slots" view**, showing the deck's five pages as an overview grid (three columns, two in windows narrower than 1100 px) where every tile shows its app's name, with a title bar that shows the DeckTech wordmark and the live phone-connection status next to the window buttons.

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
