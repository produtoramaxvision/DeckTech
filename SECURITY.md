English | [Português (Brasil)](SECURITY.pt-BR.md)

# Security Policy

Responsible party: Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP.

## Supported versions

Only the version published as the [latest release](https://github.com/produtoramaxvision/DeckTech/releases/latest) receives security fixes. Older versions are unsupported.

## Reporting a vulnerability

Do not open a public Issue or Discussion. Open [Security > Advisories](https://github.com/produtoramaxvision/DeckTech/security/advisories) and use the **Report a vulnerability** button (GitHub private vulnerability reporting).

If you do not have a GitHub account, email the report to [contato@decktech.com.br](mailto:contato@decktech.com.br) and identify the message as a security matter. The report must remain private.

Include the version, platform, impact, minimal reproduction steps, and a suggested fix if available. Remove PINs, tokens, keys, personal data, and details of real installations. Maintainers will triage the report through the private channel used; no response SLA is guaranteed.

## Local server hardening

The host server only accepts requests whose `Host` header is `localhost` or an IP address of this machine. When the `Origin` header is present, the server rejects state changes unless its scheme, host and port match the request's own origin; native clients may omit `Origin`, and this does not bypass authentication. This stops a web page from reaching the local server through a name it controls (DNS rebinding). The PIN remains the access control; this hardening does not replace a trusted local network for the browser and PWA HTTP flow.

## Pairing scope

The Android app only accepts a pairing link (`decktech://pair`) whose host is a private-network IPv4 address (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), an address in Tailscale's range (100.64.0.0/10) or a `.local` name; any other address is rejected, even with a validly formed link — DeckTech never pairs over the internet. The app checks the range of the address, not whether it belongs to a specific computer: the security code and the PIN still have to match the computer you mean to pair with. When advertising itself for pairing, Windows and macOS always prefer a private-network address when the computer has more than one, and show a notice on the Connect screen when none is available, instead of offering a QR code the Android app would reject anyway. A pairing link opened outside the app itself (camera, browser, or another app) requires explicit confirmation, with the host and port highlighted and the cancel button focused by default; the only link accepted without that dialog is one identical to the connection the app already has saved.

## PIN lockout and Electron permissions

PIN access is protected against brute force: 5 failures from the same address lock that address for 60 seconds, doubling with each consecutive lockout up to 1h; a global limit blocks new PIN logins from any address for 30 minutes after 5 DISTINCT addresses fail within 2 hours (repeated failures from the same address only count once — a single misbehaving client can never trigger the global lockout on its own), doubling up to 24h with each new trigger (devices already signed in keep working). Even the correct PIN is rejected while one of these lockouts is active, and the response reports how much time is left. In the Windows app (Electron), any permission request from the embedded browser (camera, notifications, geolocation, etc.) is denied by default from before the first window ever opens (including the license agreement screen), as defense in depth — the UI requests none today.
