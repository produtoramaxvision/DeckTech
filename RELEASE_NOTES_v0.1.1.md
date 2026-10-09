English | [Português (Brasil)](RELEASE_NOTES_v0.1.1.pt-BR.md)

# DeckTech v0.1.1

DeckTech v0.1.1 introduces DeckTech PRO, adds Windows 10 support, and improves reliability and readability. Purchase is open through Stripe checkout, with card or Pix. Free DeckTech features remain free, with no account to create.

Updating from v0.1.0: accept the license agreement (EULA 1.1) again on the computer and in the Android app. Until it is accepted on the computer, the server does not start and the phone cannot connect.

## Added

- DeckTech PRO: optional smart-home control, with a one-time payment and no subscription. You buy it from the price section of the website, https://decktech.com.br/#preco. The website provides separate buttons for card purchase and Pix payment. The card prices are R$ 149.90 for 1 computer + 1 device and R$ 299.00 for 1 computer + 3 devices. The Pix prices are R$ 145.90 and R$ 290.00, respectively. Both plans include every PRO feature; larger deployments are available through commercial contact. These are total limits of 2 and 4 devices: each activated computer and each paired phone, tablet, or browser on another computer using PRO takes one place. Places allocated to paired devices count toward the same license limit.
- Withdrawal: within 7 days of receiving the license you can withdraw from the purchase at https://decktech.com.br/arrependimento; once you confirm by e-mail, the return of the full amount is requested from Stripe automatically (PRO terms, clause 9).
- PRO page: the integration cards appear on a computer with a valid license and keep their state up to date: they read it again about every 30 seconds while the page is open and when you come back to it, without losing what you are typing or the keyboard focus. Automatic card refresh waits while you edit a field, keep a form open or confirm an action. The lists inside the cards keep their scroll position when the page is redrawn, and keyboard focus returns to the card after an action.
- License and activation: activate each computer online, or exchange a request code through another device with internet using the no-internet page and QR. PRO works for up to 15 consecutive days without a successful check, then pauses until a successful online or offline check. Free features and saved settings are not affected.
- Home Assistant: control lights, switches, plugs, fans, scenes, scripts, buttons, covers, locks, and play/pause of media players from deck tiles, through the Home Assistant address you choose (usually on your local network). Locks and covers (doors, gates, and motorized blinds) require press-and-hold confirmation; locks cannot use toggle actions.
- "Appear in Home Assistant" (MQTT): expose selected computer actions, OBS Studio recording, streaming, and scenes as buttons and switches through a configured MQTT broker, such as Mosquitto. Use the broker address and credentials; nothing is exposed by default.
- Exposed actions and access codes: choose up to 100 actions for other systems to trigger on your local network. Home Assistant actions for locks and covers (doors, gates, and motorized blinds) cannot be triggered through this remote access.
- Philips Hue (Beta): control lights, rooms, and scenes directly through a local Hue bridge, paired with its physical button. Physical-bridge validation is still pending.
- Apple Shortcuts: run a named shortcut on the Mac, or open it on the iPhone where the deck button is tapped. The shortcut must exist with the same name on that device. Windows does not execute Apple Shortcuts; physical Mac and iPhone validation is still pending.
- Alexa: not available in this version. Connecting needs the MaxVision online service, Amazon's skill certification and a later DeckTech update; no date is promised. When available, the Alexa add-on will be included in PRO at no additional charge.
- Redesigned transactional e-mails: dark, bilingual Portuguese/English messages with a clean layout and the app brand mark deliver or recover your license, provide a device-management link, and acknowledge receipt of withdrawal requests. The license e-mail opens in the language of your purchase, with the other language below it. Messages sent to contato@decktech.com.br receive an automatic acknowledgement at most once per 24 hours per sender. These messages do not subscribe you to marketing.
- License pages: the thank-you, devices, activation without internet, license recovery, and withdrawal pages use the same dark look as the website and show one language at a time: the one in the link, otherwise your browser's (Portuguese or English), otherwise Portuguese.
- Payment received, license not released: if a payment is confirmed but the license could not be released automatically, the thank-you page says "We received your payment" and that your license was not released automatically, that our team was notified and that it will answer by e-mail.
- Support the project: the website's `/apoie` page explains voluntary support and links to contribution guidance. Sponsorships, partnerships, and commissioned projects go to `parcerias@decktech.com.br`. Financial support is never required to ask for technical help.
- Windows 10 support starts in v0.1.1: Windows 10 or 11, 64-bit x64, build 10240 or later. Windows 7, 8, 8.1, and 32-bit Windows are not supported. Windows 10 uses square system window corners and the same opaque app surface, without Mica or acrylic.
- Windows updates inside the app: DeckTech on Windows downloads a new version without asking; when it is ready, the app says so, and it is installed when DeckTech quits, for example through Sair in the tray (closing only the window does not quit it), or when you choose Update now. Only update instructions signed by Produtora MaxVision are accepted.
- Start with Windows: a switch on the Connect screen opens DeckTech in the background, in the tray, when you sign in to Windows.
- Open at login on macOS: an "Open at login" switch in the menu bar menu, off by default, opens DeckTech with only its menu bar icon, without a window, when you sign in to the Mac; macOS may ask for your approval in System Settings. The window still appears if the license agreement has not been accepted yet.
- Computer window: pinned apps, sites, and PRO items can be removed from the deck grid in the computer window; on Windows it asks for a confirmation first, on macOS the removal is immediate. The app itself stays on the computer.

## Security and privacy

- Local static file serving: requests for PRO license, activation, device-allocation, and secret files are refused, including temporary copies. These private files are not delivered as web pages or downloads.
- The privacy notice explains access records retained for 6 months, automatically deleted after 183 days: IP address, UTC date/time, and service type, without request bodies, access codes, or command history.
- Online service hardening: the license service limits repeated requests from the same address, and the work it does in each scheduled run and for each withdrawal request is counted and capped below the hosting plan's limit; what does not fit waits for the next run.
- Payment protection: a card payment disputed as fraud suspends its license while the card issuer decides, and the license pages then say it is under review. The license returns on its own when the dispute ends in MaxVision's favor, provided no other dispute is open, and is cancelled when it ends against MaxVision. A payment that the card issuer flags as probable fraud may have its full amount returned, which ends its license. A purchase with an open dispute is not offered for withdrawal; the page says it is under review.
- The website publishes `/.well-known/security.txt` with `security@decktech.com.br` and the vulnerability-reporting policy. The security policy links directly to GitHub's private vulnerability report form.
- Windows checks update instructions signed by Produtora MaxVision and refuses instructions with no signature, an unknown key, or a forged signature. This does not code-sign the installer or remove SmartScreen warnings.

## Fixed

- Windows: a stuck PowerShell call no longer blocks the app list and app actions indefinitely. Calls through the app's PowerShell runner have a 60-second limit; on expiry, DeckTech ends that process and its children and reports a failure. The cause of the stuck process itself remains unidentified.
- Windows shutdown: when DeckTech closes, including a quit right after it starts, it waits for the theme watcher (the background PowerShell process that follows the Windows light or dark theme) to end, and removes the temporary files that process uses.
- Desktop app: the status pages (starting, not ready, port in use, already open, server stopped) were redrawn in DeckTech's own look, with the title bar, an icon and a color for each state.
- Desktop app: when the server starts but the app window cannot load its page, DeckTech shows the same status page as for other server problems; opening the app again starts it over, and a window kept hidden by a start at sign-in is shown.
- PRO cards: a pairing or authorization check that was interrupted by leaving the page resumes when you come back only if it was still running; one that had already ended (paired, timed out, or out of tries) is no longer started again.
- Phone deck, OBS drawer: the badge on the program card used to read ON AIR whatever OBS was doing; it now reads PROGRAM when nothing is running, RECORDING while recording and LIVE only while streaming. The single End button is unavailable when nothing is running, and its confirmation names what it will stop: the recording, the live stream or both.
- Phone deck: each OBS status check now updates only the status words of the OBS card in place, instead of rebuilding the whole deck, so the scroll position and the focus stay where they were.
- Phone deck: with the device's "reduce motion" setting on, the drawer, dialogs, notices, the sign-in screen and the recording and live indicators no longer animate.
- Phone deck: the badges on open-window cards are inset from the rounded tile corners.
- Phone deck: a tap on the dimmed background of a confirmation closes it and no longer reaches the control underneath, lifting the finger after a long press no longer triggers the confirmation's action, and the confirmation text cannot be selected by touch.
- Phone deck: in landscape, the sign-in card was taller than the screen and the keyboard covered the access code field and the Connect button; this was already so in v0.1.0. The card now has two columns, the steps on the left and the code field and Connect on the right, so all of it is in view, and with the keyboard open it shrinks to the field and the button side by side, with the error line under them.
- Phone deck: the open apps screen fits short landscape screens.
- Phone deck: in the OBS drawer, the Tabs view on narrow phones shows two scenes per row, so scene names are no longer cut.
- Phone deck, OBS drawer: in landscape the drawer showed only one scene, because its header and notices took most of the height; this was already so in v0.1.0. The scene list is now the main area and record, live and stop stand in a column beside it, so several scenes are in view.
- Phone deck, OBS: the key of an OBS scene pinned to the deck was redesigned and now has a band that shows its state. The key of a scene that is not the one on air is locked while OBS is streaming live, and also while the deck does not yet know whether it is streaming: a tap explains how to switch, and you hold the key to switch (Shift+Enter on a keyboard). The key shows the new scene as soon as OBS accepts the switch, without waiting for a long transition such as a stinger to finish. After switching through a locked key, when another scene was in the program, a message offers Undo, also with Ctrl+Z or Cmd+Z, which puts the previous scene back on air unless the program has moved on since. If OBS is off, a tap says "OBS offline"; if OBS no longer has the scene, it says "Scene "name" no longer exists in OBS". The star of a scene in the OBS drawer pins or unpins its key, and both offer Undo.
- Phone deck, OBS: the drawer and the OBS card follow OBS's own updates. The scene is marked as soon as the switch is accepted, the recording and live indicators clear when OBS stops them, and an older read does not undo that state.
- Android app: the deck reduces blur effects to ease paging and the movement of the OBS drawer, while the drawer keeps its glass look when it is open and still.
- Phone deck: the rims and the keyboard focus outline of open-window cards are no longer cut off by the scrolling area.
- Phone deck, keyboard: every control a keyboard reaches now shows the focus outline of the open-window cards (a tap or a click shows none), and the two dots of the side bar are named buttons that take focus with Tab. On a focused open-window card, Delete or Backspace opens the close confirmation and Shift+Enter opens a new window of the app. The OBS drawer keeps the keyboard on the same scene when its list changes.
- Phone deck: a hold that lasted its full time is no longer taken for a tap when the phone is busy at the moment of the release, on app, website, scene and PRO keys and on open-window cards. While a message offers Undo, another message waits for it to leave instead of replacing it, and an error notice still appears at once.
- Windows window, Slots tab: the dialog that adds a key keeps Tab inside it, closes with Esc and returns the focus to the position it was opened from, and its PRO tab adds the key to that position. The grid is no longer rebuilt under a key that is being dragged, and the search fields of the PRO page and of the PRO tab keep the caret where you type.

## Known issues

Physical-device validation is still pending for Hue on a bridge, Apple Shortcuts on Mac and iPhone, and Home Assistant/MQTT on Home Assistant OS and Mosquitto. Exposed actions triggered from another device have not been tested on real hardware. Windows automatic update, start with Windows, and installation on a physical Windows 10 machine still need validation on clean machines. Open at login on macOS has not been validated on a real Mac. Automated checks do not replace these device tests.

A stuck PowerShell request can still take about 60 seconds to report a failure.

## Requirements

- Windows 10 or 11 (64-bit, x64, build 10240 or later).
- macOS 14 or later.
- Android 5.0 or later for the APK; iPhone and other browser clients use the web deck.
- Computer and phone on the same local network. PRO activation and checks need internet on the computer or on another device used for the offline exchange.

## Installation and checksums

Download your platform's file from this release's assets and check `SHA256SUMS.txt` before installing. The DMG also has `DeckTech-macOS.dmg.sha256`.

The Windows installer is not code-signed, so SmartScreen may warn on first run. The installer and app properties identify Produtora MaxVision as the publisher. The macOS app is ad-hoc signed and not notarized. The Windows desktop interface is Portuguese; the phone deck supports Portuguese and English. iPhone and browser connections use HTTP without encryption: use a trusted local network. The Android app uses HTTPS with the paired installation's certificate pinned.

The [README](https://github.com/produtoramaxvision/DeckTech/blob/main/README.md) explains first-run steps. For troubleshooting, see [SUPPORT](https://github.com/produtoramaxvision/DeckTech/blob/main/SUPPORT.md) and the bilingual [quick-start tutorial](https://decktech.com.br/tutorial-decktech).
