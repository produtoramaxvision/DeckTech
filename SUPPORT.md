English | [Português (Brasil)](SUPPORT.pt-BR.md)

# Support

Responsible party: Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP.

## Installation and questions

Read the [README](README.md) first, including SmartScreen, Gatekeeper, pairing, and checksum guidance.

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
- **License agreement (EULA) screen on first run.** Windows, macOS, and Android ask you to accept the license agreement before first use. On Windows, you must tick the agreement checkbox to enable the accept button; declining closes the application. The legally binding text is the Portuguese [EULA.md](EULA.md), which prevails; an [English translation](EULA.en.md) is provided for convenience.
- **Where your data lives.** On Windows, in `%LOCALAPPDATA%\DeckTech`; it is preserved on uninstall unless you tick **Remover também os dados do usuário** (the uninstaller is in Portuguese). On macOS, in `~/Library/Application Support/DeckTech`.

## OBS Studio

For OBS setup or troubleshooting a wrong password, a disabled server, or a port other than 4455, see [OBS Studio in the README](README.md#obs-studio). Never attach your OBS password or connection information to a support request.
