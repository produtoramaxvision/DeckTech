English | [Português (Brasil)](MANUAL.pt-BR.md)

# DeckTech Manual

This manual matches DeckTech v0.1.1. It explains what DeckTech does, how to install it and connect your phone, and what every tap, key and shortcut does. If something on your device differs from what is written here, tell us through the [support guide](SUPPORT.md).

On Windows the host window is in Portuguese only. Where a label is the same in both languages the manual shows it once; otherwise it gives the English name and, in parentheses, the Portuguese label you will see on Windows. On macOS the host window follows the language you pick (Português/English). The phone panel follows the language of the phone or browser.

## What DeckTech is

DeckTech lets your phone drive the apps on your computer. It runs on the computer (Windows or macOS), shows a panel of keys on the phone, and acts on the computer when you tap a key.

- The panel has 40 keys, in 5 pages of 8, on every plan.
- Each key opens an app, opens a website or switches an OBS Studio scene. With DeckTech PRO, a key can also trigger a home item.
- On Android you use the app. On iPhone, iPad and other browsers you use the web panel: there is no native iPhone app.
- The free features do not ask for an account. The computer and the phone talk over your local network.

## Requirements

- Computer: Windows 10 or 11 (64-bit, x64, build 10240 or later) or macOS 14 or later. Windows 7, 8, 8.1 and 32-bit Windows are not supported.
- Phone: Android 5.0 or later for the app; iPhone and other browsers use the web panel.
- Computer and phone on the same local network (Wi-Fi or Ethernet). The Android app also accepts the same Tailscale. An ordinary VPN does not work for pairing.
- For the OBS drawer: OBS Studio open on the same computer that runs DeckTech.
- For DeckTech PRO: internet on the computer, or on another device, to activate and verify the license.

## Install

Updating from v0.1.0: the license agreement (EULA 1.1) must be accepted again on the computer and in the Android app. Until it is accepted on the computer, the server does not start and the phone cannot connect.

The full steps, the download links and the checksum check are in the [README](README.md#installation-and-first-run). In short:

### Windows

1. Download `DeckTech-Setup.exe` from the [releases page](https://github.com/produtoramaxvision/DeckTech/releases/latest) and run it.
2. The installer is unsigned, so SmartScreen may warn you. Confirm that the file came from the official repository and that its SHA-256 matches. Only then choose **More info** and **Run anyway**.
3. On first launch, tick the license agreement checkbox and choose **Accept and start** (**Aceitar e começar** when your system is in Portuguese). **Decline and quit** closes the app, and the agreement shows again on the next launch.
4. Open the **Connect** tab (**Conectar**): it shows the local address and the six-digit access code.

The DeckTech window on Windows is in Portuguese. The phone panel follows the phone's language.

### macOS

1. Download `DeckTech-macOS.dmg`, open the image and drag DeckTech to **Applications**.
2. The app is not notarized. Control-click **DeckTech** and choose **Open**. If Gatekeeper blocks it, use **System Settings > Privacy & Security > Security > Open Anyway**.
3. Accept the license agreement and open the **Connect** tab. On macOS that tab has a language picker (Português/English).

### Android

1. Download `decktech.apk`, allow the installation when Android asks and accept the license agreement.
2. On the computer, open **Connect > Android app** (**Conectar > App Android**) and scan the QR code with the phone camera.
3. If the app shows a 16-character security code, confirm only if it matches, character for character, the **Security code** (**Código de segurança**) on the **Connect** tab.
4. Enter the six-digit access code.

### iPhone, iPad and browsers

1. On the computer, open **Connect > Browser** (**Conectar > Navegador**).
2. In Safari or another browser, scan the QR code or type the local address shown.
3. Enter the access code. In Safari, **Share > Add to Home Screen** installs the panel as an app.

This connection uses HTTP, without encryption. Use it only on a local network you trust.

The [quick guide](https://decktech.com.br/tutorial-decktech) shows the same steps in six cards.

## Pair the phone

The access code has six digits and sits on the computer's **Connect** tab, under **Access code** (**Código de acesso**).

1. Open the panel on the phone (the Android app, or the address from the **Connect** tab in a browser).
2. Type the six digits. When you type the sixth, the panel connects by itself. Tapping **Connect** or pressing Enter also works.
3. To change the code, tap **Generate new code** (**Gerar novo código**) on the computer and confirm **Generate a new code?**. Connected devices will need to enter the new code.

If the code is not accepted, the panel says why: **Invalid code** (fewer than six digits), **Wrong code.** or **Too many attempts — wait {s}s.** After 5 wrong codes in a row, the computer blocks that device for a while, starting at 60 seconds. The details are in [Troubleshooting](SUPPORT.md#troubleshooting).

With the phone on its side, the sign-in card has two columns: the steps on the left and, on the right, the code field and the **Connect** button. With the keyboard open, the card shrinks to the field and the button side by side, with the error message below. In the Android app the access code screen is always in portrait; after you connect, the app follows the device rotation again.

The panel uses the language of the browser or device: Portuguese when the language starts with pt, English otherwise.

## The panel

The panel shows the keys in 5 pages of 8. Each key has the icon and the name of the app, website, scene or item. An app key whose app is open on the computer shows the text **open**.

- **Open.** Tap the key. The app opens or comes to the front; the website opens on the computer. If the system does not allow bringing the window forward, DeckTech opens a new window of the app and says so: **Could not focus "{name}" — opened a new instance**.
- **Change page.** Swipe sideways over the keys. A quick swipe changes the page; dragging slowly, the page changes once you pass about a fifth of the width.
- **Go to Open apps.** Swipe up, scroll the mouse down or tap the lower dot of the two-dot bar on the right edge. To return to the keys, swipe down, scroll up or tap the upper dot.
- **Add.** App, website and PRO keys are added in the DeckTech window on the computer (see below). From the phone you can only pin an OBS scene, with the star in the drawer.
- **Remove.** On the phone, hold an app, website or ordinary PRO key for about half a second. **Remove from favorites?** appears (for a website, **Remove website from favorites?**), with **Cancel** and **Remove**. The app stays installed on the computer. On an OBS scene key or a key that asks for confirmation, a hold can do something else: see **Scene keys** and the gesture guide.
- **Reorder.** Only in the computer window.

### Add, remove and reorder in the computer window

On Windows the window has three tabs on the side: **Slots**, **Conectar** (Connect) and **PRO**.

- In **Slots**, the five pages show at once, as **Tela 1** to **Tela 5** (Page 1 to Page 5), with the number of positions in use.
- To add, click the **+** on an empty position (**Adicionar app nesta posição**, Add app in this position). The picker opens with the **Apps**, **Sites** (Website Links) and **PRO** tabs. In **Apps**, search in **Buscar apps...** (Search apps...) and click **Adicionar** (Add). In **Sites**, type the address and the **Nome do site** (Site name), then click **Adicionar**.
- To remove, hover over the key (or focus it with the keyboard) and click **Remover** (Remove), or press Delete or Backspace. DeckTech asks **Remover dos favoritos?** (Remove from favorites?) and only removes after your **Remover**.
- To reorder, click **Reorganizar apps** (Reorder apps), drag the keys (or use the arrow keys) and click **Concluir** (Done). Dropping a key on another one swaps the two.

On macOS the window has the same tabs. Hover over a key and click **Remove**, or right-click and choose **Remove from Dock**; the removal is immediate, with no question. In **Reorder apps**, drag the icon to its new position and click **Done**. PRO buttons are set up in the browser: the picker's **PRO** tab takes you there with **Open in browser**.

With all 40 positions taken you cannot add another key. When you pin a scene from the phone, the message is **Limit of 5 pages reached**. With no keys at all, the **Slots** tab shows **Seu dock está vazio** (Your dock is empty) and the **Adicionar app** (Add app) button.

## Open apps

Swipe up on the panel to see the **Open apps** screen. Each card is a window open on the computer. It shows the icon, the window title, the app name, the monitor (for example, **Monitor 1**) and the state: **focused**, **background** or **minimized**. When nothing is open, the screen says **Nothing open yet — open an app on your computer to see it here**.

- Tap a card to bring the window to the front. Tap again, with the window focused, to minimize it.
- Two quick taps, one right after the other, open a new window of the app.
- Hold a card for about half a second to close the window. The panel asks **Close window?** and warns that unsaved changes may be lost. It only closes after **Close window**.
- Drag the row of cards sideways to see the ones that do not fit on the screen.

The first tap acts after a fraction of a second, so DeckTech can tell whether a second tap is coming.

The **OBS** card sits on the same screen. It shows the state of OBS and opens the OBS drawer.

## OBS Studio

The **OBS Commander** drawer switches scenes, records, streams and pins scenes to the panel. OBS Studio must be open on the same computer that runs DeckTech.

### Connect

1. In OBS, open **Tools › WebSocket Server Settings**.
2. Tick **Enable WebSocket server** (port 4455).
3. Keep **Enable Authentication** ticked and click **Show Connect Info**.
4. Copy the password, open the OBS drawer on the panel, paste it into **OBS WebSocket Password** and tap **Save and connect**.

The password stays only on the computer; the phone never gets it back. More details, including a port other than 4455, are in the [README](README.md#obs-studio).

The **OBS** card and the drawer show the connection state: **connected**, **checking…**, **no password**, **wrong password**, **WebSocket off** or **OBS offline**. With OBS connected, the gear in the drawer (**OBS connection and password**) shows or hides the password field; with no connection the field is already open. **Clear password** removes the saved password.

### The drawer

- Tap the **OBS** card in **Open apps** to open the drawer. The ✕ in the corner closes it.
- At the top, the card of the scene in the program shows the badge **PROGRAM** (nothing running), **RECORDING** (while recording) or **LIVE** (only while streaming).
- **View mode**: **List**, **Columns** or **Tabs**. In **Tabs**, scenes are under **Scenes · n** and sources under **Sources · n**.
- Tap a scene to put it in the program.
- The star beside each scene pins the scene as a panel key; tapping the star again removes the key. Both actions offer **Undo**.
- In **Tabs**, the star at the top (**Choose scenes for the dock**) turns pin mode on: tap the scenes that become keys, then tap the star again to finish.
- **Record** and **Live** switch recording and streaming on and off right away. While recording, the label becomes **Stop**; while streaming, it becomes **Stop live**.
- **End** stops whatever is running and always asks first. The title changes with the case: **Stop recording?**, **End live stream?** or **Stop broadcast?** (both). It is unavailable when nothing is recording or live.

### Scene keys

A pinned scene becomes a key on the panel, with a strip showing the scene's state.

- Outside a live stream, tapping the key switches to the scene.
- The key of a scene that is not on air is locked during a live stream, and also while the panel does not yet know whether there is a stream. A tap only explains how to switch; to switch, hold the key (Shift+Enter on a keyboard).
- After switching through a locked key, if another scene was in the program, a message offers **Undo**, also with Ctrl+Z or Cmd+Z. Undo puts the previous scene back on air, unless the program has already changed. While **Undo** is on screen, another message waits for it to leave; an error notice appears at once, in its place.
- If OBS is off, a tap says **OBS offline**. If OBS no longer has the scene, it says **Scene "name" no longer exists in OBS**.
- To take the key off the panel, tap the scene's star again in the OBS drawer. Outside a live stream, holding the key opens **Remove from favorites?**. During a stream, or while the panel does not know whether there is one, a hold never removes: on a locked key it switches the scene.

## DeckTech PRO

DeckTech PRO adds smart-home control and other integrations. It is a one-time license, with no subscription and no account. The free features stay free and never depend on the license.

### Buy

You buy in the [pricing section of the site](https://decktech.com.br/#preco), with card or Pix, through Stripe's checkout. Both plans include every PRO feature; what changes is the number of devices: 1 computer plus 1 device, or 1 computer plus 3 devices. For more devices, write to [contato@decktech.com.br](mailto:contato@decktech.com.br). The [DeckTech PRO Terms](https://decktech.com.br/termos-pro) apply to the purchase.

### Activate

1. After payment, the license code shows on the thank-you page and arrives by e-mail.
2. On the computer, open the **PRO** tab of the DeckTech window, choose **Colar código da licença** (Paste licence code), paste the code and continue.
3. Activation takes a few seconds and needs internet. With no internet on the computer, use **Ativar sem internet** (Activate without internet): copy the activation request, open the page shown on another device with internet (the on-screen QR leads to it), generate the activation code and paste it back on the computer.

### Devices

The plan limits how many devices use PRO at the same time. Each activated computer takes one place. A paired phone, tablet or browser only takes a place when someone uses a PRO feature on it. On the **PRO** tab, the **Aparelhos com PRO** (Devices with PRO) list shows who holds a place and offers **Remover do PRO** (Remove from PRO) to free it. **Liberar este computador** (Free this computer) takes PRO off the computer and frees its place.

A phone without a place sees **This phone does not have a PRO place yet**.

### Without internet

Once activated, PRO works without internet. DeckTech checks the license by itself on the days there is internet. If a computer goes 15 days in a row without completing a check, PRO is paused on it until a check succeeds: **Verificar agora** (Check now) with internet, or **Renovar sem internet** (Renew without internet) through another device. The free features and the saved settings are not affected.

### Withdrawal

You can withdraw from the purchase within 7 days after receiving the license, even if you have already activated or used PRO. Use the [withdrawal page](https://decktech.com.br/arrependimento). After you confirm by e-mail, the return of the full amount is requested from Stripe. With a full return, the license is cancelled. The complete terms are in clause 9 of the [DeckTech PRO Terms](https://decktech.com.br/termos-pro).

## PRO integrations

All of them live on the **PRO** tab of the computer window. To put a key on the panel, click the **+** on an empty position in **Slots**, open the picker's **PRO** tab, choose the source (**Home Assistant**, **Philips Hue** or **Apple Shortcuts**), filter by name, choose the item, set the **Action on tap:**, give the **Tile name on deck** and click **Add**. PRO must be active.

### Home Assistant

Control items of your Home Assistant from the panel keys, on the local network.

1. On **PRO**, in the **Home Assistant** card, click **Procurar Home Assistant na rede** (Find Home Assistant on network) and choose what shows up. Or click **Digitar o endereço manualmente** (Type address manually), enter the address (for example, `http://homeassistant.local:8123`) and, if you prefer, a **Código de acesso de longa duração (opcional)** (Long-lived access code, optional), then click **Conectar com este endereço** (Connect with this address).
2. Without that code, a Home Assistant authorization page opens in the browser: sign in there and confirm the access.
3. In the **Testar conexão** (Test connection) section, **Testar agora** (Test now) triggers a light or a switch to confirm communication. Locks and gates do not show in the test.

The item's state shows on the key (for example, **On**, **Off**, **Open**, **Locked**) and updates by itself. These are the supported types and their actions; any other type does not show:

| Type | Shows as | Actions on tap | Note |
|---|---|---|---|
| `light` | Light | Toggle, Turn on, Turn off | |
| `switch` | Switch | Toggle, Turn on, Turn off | Includes plugs |
| `input_boolean` | Switch | Toggle, Turn on, Turn off | |
| `fan` | Fan | Toggle, Turn on, Turn off | |
| `scene` | Scene | Activate | |
| `script` | Script | Run | |
| `button` | Button | Press | |
| `input_button` | Button | Press | |
| `cover` | Cover | Toggle | Motorized cover: blind, door or gate. Asks you to hold |
| `lock` | Lock | Lock, Unlock | Never toggles. Asks you to hold |
| `media_player` | Media | Toggle | Plays or pauses |

Locks and motorized covers require holding the key to confirm (see the gesture guide). Home Assistant actions for locks and covers cannot be triggered through the remote access of exposed actions.

Validation on a real Home Assistant OS and Mosquitto is still pending.

### Show up in Home Assistant

The **Aparecer no Home Assistant** (Show up in Home Assistant) card shows the actions you choose in Home Assistant as buttons and switches: computer actions, recording, streaming and OBS Studio scenes. It uses an MQTT server you already have, such as Mosquitto: enter that server's address and credentials. Nothing is exposed by default. Validation on a real Home Assistant OS and Mosquitto is still pending.

### Exposed actions and access codes

The **Ações expostas e códigos de acesso** (Exposed actions and access codes) card controls which panel actions other devices and programs on your local network may trigger. You choose up to 100 actions with **Adicionar ação** (Add action) and create an access code for each system with **Criar código** (Create code). The code shows only once: copy it right away. These codes are different from the six-digit pairing access code. Actions triggered from another device have not been tested on real hardware yet.

### Philips Hue (Beta)

Control lights, rooms and scenes directly through a Hue bridge on the local network. On **PRO**, click **Procurar ponte Hue na rede** (Find Hue bridge on network) or type the address, press the round button on the bridge when DeckTech asks and use **Testar agora** (Test now), in the **Testar conexão** (Test connection) section. Validation on a physical bridge is still pending.

### Apple Shortcuts

A button runs a shortcut by name. On a Mac, the shortcut runs directly on the computer (**Neste computador**, On this computer). On an iPhone, the button opens the shortcut on the very iPhone where it was tapped (**No iPhone**), and the shortcut must exist there with exactly the same name. Windows does not run Apple Shortcuts. Validation on a real Mac and iPhone is still pending.

### Alexa

The Alexa connection is not available in this version. The **Conectar com a Alexa** (Connect with Alexa) card shows **Indisponível** (Unavailable) and offers nothing to connect. It needs the MaxVision online service, Amazon's skill certification and a later DeckTech update; no date is promised. The page [Use it with Alexa](https://decktech.com.br/ajuda-alexa#en) describes how the connection will work.

## Gesture and action guide

The tables below gather everything each surface accepts. "About half a second" and "almost a second" are fixed times in the program.

### Phone: panel

| Gesture or control | What it does | Condition |
|---|---|---|
| Tap an app key | Opens the app on the computer or brings it to the front | Computer connected |
| Tap a website key | Opens the website on the computer | Computer connected |
| Hold an app or website key for about half a second | Opens **Remove from favorites?** (or **Remove website from favorites?**) | Releasing early, or moving the finger, cancels |
| Enter or Space on a focused key | Same as a tap | Keyboard attached to the device |
| Swipe sideways over the keys | Changes page (5 pages of 8) | Quick swipe, or drag about a fifth of the width |
| Swipe up | Goes to **Open apps** | No dialog open |
| Swipe down, on **Open apps** | Back to the panel | |
| Scroll the mouse down or up | Goes to **Open apps** or back to the panel | Browser on a computer |
| Tap the upper or lower dot of the side bar | Goes to the panel or to **Open apps** | Two-dot bar on the right; hidden while a dialog is open |
| **Cancel** / **Remove** (dialog) | Closes the dialog or takes the key off the panel | The app stays on the computer |
| Type the sixth digit of the access code | Connects by itself | Sign-in screen open |

### Phone: Open apps

| Gesture or control | What it does | Condition |
|---|---|---|
| Tap a card | Brings the window to the front | Window not focused |
| Tap a focused card | Minimizes the window | Window focused |
| Two quick taps on a card | Opens a new window of the app | One tap right after the other |
| Hold a card for about half a second | Opens **Close window?** | Moving the finger cancels |
| **Close window** (dialog) | Closes the window on the computer | Unsaved changes may be lost |
| Drag the row sideways | Scrolls the list of cards | More cards than fit on the screen |
| Enter or Space on a focused card | Same as a single tap | Keyboard attached to the device |
| Delete or Backspace on a focused card | Opens **Close window?** | Keyboard attached to the device |
| Shift+Enter on a focused card | Opens a new window of the app | Keyboard attached to the device |
| Tap the **OBS** card | Opens the OBS drawer | |
| Swipe down or tap the upper dot | Back to the panel | |

### Phone: OBS drawer

| Gesture or control | What it does | Condition |
|---|---|---|
| Tap a scene | Puts the scene in the program | OBS connected |
| Star beside the scene | Pins the scene as a panel key, or removes the key | In **List** and **Columns**; offers **Undo** |
| Star at the top (**Choose scenes for the dock**) | Turns pin mode on and off | In **Tabs** |
| Tap a scene in pin mode | Pins it or removes the key | In **Tabs**, with the mode on |
| **List**, **Columns**, **Tabs** | Changes the **View mode** | |
| **Scenes · n**, **Sources · n** | Switches the groups | In **Tabs** |
| **Record** / **Stop** | Starts or stops recording | OBS connected |
| **Live** / **Stop live** | Starts or stops streaming | OBS connected |
| **End** | Asks and, if confirmed, stops the recording, the live stream or both | Only while something is running |
| Gear **OBS connection and password** | Shows or hides the password field | OBS connected |
| **Save and connect**, **Clear password** | Stores or removes the OBS WebSocket password | |
| ✕ in the corner | Closes the drawer | |

### Phone: OBS scene keys

| Gesture or control | What it does | Condition |
|---|---|---|
| Tap the key | Switches to the scene | Outside a live stream, with the state known |
| Tap the locked key | Explains how to switch | Scene not on air, during a live stream or when it is unknown whether there is one |
| Hold the locked key | Switches to the scene | Same case |
| Shift+Enter on a locked key | Switches to the scene | Keyboard attached to the device |
| **Undo** in the message, or Ctrl+Z / Cmd+Z | Puts the previous scene back on air | After switching through a locked key, if there was a previous scene and the program has not changed |
| Tap while OBS is off | Shows **OBS offline** | |
| Tap a scene that no longer exists | Shows **Scene "name" no longer exists in OBS** | |

### Phone: PRO keys

| Gesture or control | What it does | Condition |
|---|---|---|
| Tap an ordinary PRO key | Runs the action (for example, turns a light on or off) | PRO active and a place for the phone |
| Tap a key that asks for confirmation | Shows **Hold to confirm** | Locks and motorized covers |
| Hold that key for almost a second | The key's ring completes and the action runs | Releasing early, or moving the finger, cancels |
| Enter or Space, held, on a focused key | Same as holding | Releasing early cancels |
| Hold an ordinary PRO key for about half a second | Opens the remove dialog | Keys that do not ask for confirmation |
| Hold the name of a key that asks for confirmation | Opens the remove dialog | The name is under the icon; holding the icon confirms the action |
| Apple Shortcut on an iPhone | Opens the shortcut on the iPhone where the key was tapped | The shortcut exists on the iPhone with the same name |
| Without active PRO | Shows **This needs DeckTech PRO to be active** | |

### Computer: Windows window (Slots tab)

| Gesture or control | What it does | Condition |
|---|---|---|
| Click the **+** on an empty position | Opens the picker for that position | Outside reorder mode |
| Hover or focus a key and click **Remover** | Opens **Remover dos favoritos?** | |
| Delete or Backspace on a focused key | Opens the same dialog | |
| **Remover** / **Cancelar** (dialog) | Removes the key or closes the dialog | The app stays on the computer |
| **Reorganizar apps** | Turns reorder mode on; the button becomes **Concluir** | |
| Drag a key onto another position | Moves the key; if the position is taken, the two swap | Reorder mode |
| Arrow keys on a focused key | Move one position (up and down, one row) | Reorder mode |
| Click a page | Marks the page as active | |
| **Concluir** | Leaves reorder mode | |

### Computer: key picker

| Gesture or control | What it does | Condition |
|---|---|---|
| **Apps**, **Sites**, **PRO** tabs | Switch source | Left and right arrows switch tabs |
| **Buscar apps...** | Filters the app list | **Apps** tab |
| **Adicionar** on a row | Pins the app at the chosen position (or the first free one) | Becomes **Adicionado** |
| Address, **Nome do site** and **Adicionar** | Pins the website | **Sites** tab |
| Choose a PRO item, **Action on tap:**, **Add** | Creates the PRO key | PRO active and source connected |
| ✕ or click outside | Closes the picker | |
| Esc, inside a PRO item | Back to the source list | |

### Computer: keyboard

| Gesture or control | What it does | Condition |
|---|---|---|
| Tab and Shift+Tab | Move through keys, buttons and dialogs | In the remove dialog, focus stays in it |
| Enter or Space | Activates the focused button or key | |
| Delete or Backspace | Asks to remove the focused key | Windows window |
| Arrow keys | Move the focused key | Windows reorder mode |
| Esc | Closes the confirmation dialog | |
| Esc, in the picker, inside a PRO item | Back to the source list | |
| Left and right arrows on the picker tabs | Switch tab | |

### Windows tray

Right-click the DeckTech icon near the clock.

| Item | What it does | Condition |
|---|---|---|
| State line (for example, **DeckTech — rodando**) | Shows the server state | Read-only |
| **Abrir DeckTech** | Opens the window | |
| **Abrir pasta de logs** | Opens the logs folder | |
| **Iniciar com o Windows** | Turns background start at Windows sign-in on or off | Only shown where the system allows it |
| **Atualizar agora**, **Baixar e instalar**, **Adiar 1 hora**, **Verificar atualizações** | Control updates | Shown according to the update state |
| **Sair** | Quits DeckTech | Closing the window alone does not stop the server |

### macOS menu bar

| Item | What it does | Condition |
|---|---|---|
| **Device: n** and **Pinned: n** | Show how many devices and keys | Read-only |
| **Open DeckTech** | Opens the window | |
| **Sync now** | Reloads the keys, the installed apps and the access code | |
| **Check for updates** | Looks for a new version | No update available |
| **Update {version} available**, **Download and install** | Installs the new version | With an update available |
| **Open at login** | Opens DeckTech with only the icon, no window, when you sign in to the Mac | Off by default; macOS may ask for approval |
| **Quit** | Quits DeckTech | |
| **Version {version}** | Shows the installed version | Read-only |

## Keyboard and accessibility

- Every key, card and button of the panel, including the two dots of the side bar, takes focus with Tab, has a name for screen readers and responds to Enter and Space. The control with keyboard focus shows an outline; a tap or a click shows none.
- On keys that ask for confirmation, keep Enter or Space pressed; releasing early cancels.
- On a locked scene key, Shift+Enter switches the scene. Ctrl+Z or Cmd+Z presses the **Undo** of the message on screen, outside a text field.
- On a focused card of **Open apps**, Delete or Backspace opens **Close window?** and Shift+Enter opens a new window of the app.
- In confirmation dialogs, Tab and Shift+Tab stay inside the dialog and Esc closes it. Tapping outside the dialog also closes it.
- With the device's "reduce motion" setting on, the drawer, the dialogs, the notices, the sign-in screen and the recording and live indicators stop animating.
- The panel works in portrait and on its side.

## Troubleshooting

Installation, access code lockouts, certificate and network cases are in [Troubleshooting](SUPPORT.md#troubleshooting). The panel shows these messages:

| Message | What it means | What to do |
|---|---|---|
| **Wrong code.** | The access code does not match | Type the current code from the **Connect** tab |
| **Too many attempts — wait {s}s.** | The computer blocked the device for a while | Wait for the time shown |
| **Computer disconnected** | The panel lost the computer | Check that DeckTech is open and both are on the same network |
| **Could not open "{name}"** | The app or website did not open | Check that the app is still installed |
| **"{name}" is no longer installed** | The app was removed from the computer | Remove the key and pin another app |
| **The dock changed; try again** | The configuration changed elsewhere | Repeat the action |
| **Limit of 5 pages reached** | All 40 positions are taken | Remove a key |
| **OBS offline** | There is no connection to OBS | Open OBS and check the WebSocket server |
| **OBS unavailable — check the WebSocket** | OBS answered but did not return its state | Check the OBS WebSocket server |
| **Incorrect OBS password — check the password in OBS** | The saved password does not match | Copy the current OBS password and use **Save and connect** |
| **OBS WebSocket server is off or unreachable — check OBS** | The WebSocket server is off | Turn it on in **Tools › WebSocket Server Settings** |
| **OBS command failed** | OBS refused the command | Try again |
| **This needs DeckTech PRO to be active** | The license is not active on this computer | See the **PRO** tab |
| **This phone does not have a PRO place yet** | Every place of the plan is in use | Free a device on the **PRO** tab |
| **Home Assistant is not connected right now.** | DeckTech lost Home Assistant | Connect again on the **PRO** tab |
| **Home Assistant refused access.** | Access was refused or expired | Connect again on the **PRO** tab |
| **Philips Hue bridge is unreachable.** | The bridge did not answer | Check that it is on and on the same network |

As a last resort, write to [contato@decktech.com.br](mailto:contato@decktech.com.br) with the version and the platform. Before attaching logs or screenshots, hide access codes, passwords and personal data.

## Privacy

Free DeckTech asks for no account and drives the computer over your local network; what PRO and updates send or look up over the internet is in the [Privacy Notice](PRIVACY.md).
