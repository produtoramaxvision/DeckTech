English | [Português (Brasil)](PRIVACY.pt-BR.md)

# Privacy Notice

Version 1.0. Effective from October 2, 2026. It replaces the notice of September 27, 2026.

**What changed from the notice of September 27, 2026:**

- the notice now covers DeckTech PRO: purchase, license delivery, activation and license checks, device slots, the Alexa add-on and local integrations;
- new tables show what the free version sends and what PRO sends, with recipient, purpose, retention and legal basis;
- update checks now happen when the app starts with internet, and on Windows the app downloads and installs the update;
- the access records required by the Marco Civil da Internet and the retention periods for the sale and withdrawal records are added;
- the supplier list (Stripe, Resend, Cloudflare, Amazon Web Services), international transfer and your rights without an account are added.

The party responsible for this notice (the controller, under the LGPD) is Produtora MaxVision, CNPJ 38.386.434/0001-44, Diadema/SP. Supplier address: Rua Orense, 41, Diadema/SP, Brazil. For any privacy matter, including exercising your rights, e-mail [contato@decktech.com.br](mailto:contato@decktech.com.br) and identify the message as a privacy matter. MaxVision is a small processing agent and has not appointed a data protection officer, under Resolution CD/ANPD No. 2/2022. This e-mail address is the communication channel for data subjects.

## In short

DeckTech has no account and no Produtora MaxVision telemetry. The free version works on your local network and only uses the internet for the requests listed below. DeckTech PRO adds a purchase, a license activation, background checks and, if you want it, the Alexa add-on. Each one is described below: what leaves your network, to whom, why and for how long.

## What the free version sends

| When | What DeckTech does | Where to | What goes along |
|---|---|---|---|
| On Windows, when it starts with internet and when the panel asks whether there is a new version (at most once every 10 minutes) | Requests the page of the latest version | GitHub | An ordinary secure connection, with no account, access code, app list or settings. GitHub sees the normal technical connection data, such as the IP address |
| On macOS, when the main window opens and when you ask | Requests the public information about the latest version | GitHub | The app name and the installed version, in the identification header of the request, and the technical connection data |
| On Android, when you tap update | Downloads the installer of the new version | GitHub | The download request and the technical connection data |
| On macOS, when you choose to install an update | Downloads the file of the new version | GitHub | The download request and the technical connection data |
| On Windows, when there is a new version | Downloads the installer and installs it when you close the app or with the update button | GitHub | The download request and the technical connection data |
| When showing website shortcuts on the phone deck | Fetches the website icon | Google's icon service, or GitHub files for GitHub shortcuts; the site's own icon is a fallback | The site's domain (Google) or the icon address, and the technical connection data |
| On macOS, when showing website shortcuts | Fetches the site's page and icons | The site, the icon addresses it specifies and, for some well-known sites, a fixed icon address | The address requested and the technical connection data |
| When you open websites and links through DeckTech | Opens the site or the link | The site you opened | What the browser and the site normally exchange; each site's policy applies |

On Windows, website shortcuts on the computer use monograms, with no such requests. DeckTech does not send Produtora MaxVision an account, access code, app list, settings or usage data. Update checks are described in the dedicated section below.

## What PRO sends

| Feature | What leaves your network | To whom | When |
|---|---|---|---|
| Purchase | What you type on the payment page (for example e-mail, name, country and payment method details) | Stripe | At purchase |
| License delivery | Your e-mail and the license code, to send the message | Resend, e-mail provider | After payment and when you ask for it again |
| Activation | The license code, a public key created on your computer for this purpose, the DeckTech version and the system type (Windows or macOS) | MaxVision licensing service, on Cloudflare | Once per computer |
| Checks | A random number that identifies the computer's slot, a counter, the DeckTech version, the system type and a signature made on the computer | MaxVision licensing service, on Cloudflare | When DeckTech starts with internet |
| Releasing or changing slots | The random slot number and the number of phone slots | MaxVision licensing service, on Cloudflare | When you release or change |
| Managing slots on the website | The e-mail you type, only to receive a single-use link | MaxVision licensing service, on Cloudflare; e-mail through Resend | When you ask |
| Alexa add-on (only if you turn it on) | The license code and the proof of the computer's activation (once), the DeckTech version, the name, type and code of each action you allow for Alexa, the on or off state of recording and streaming, and the commands received | MaxVision cloud, on Cloudflare, and an adapter on Amazon Web Services. Amazon handles what you say to Alexa | While the add-on is active |
| Home Assistant, "Appear in Home Assistant", Philips Hue and requests from outside | Nothing goes to MaxVision. The data goes to what you configure: your Home Assistant, your message server, your Hue bridge | Those services, at the address you provide, which may be outside your network | When you use it |

The connections in this table only happen when you buy, activate or use PRO. DeckTech PRO has no user account: after the purchase, MaxVision does not ask for a profile or a password for PRO to work. The Alexa add-on only uses the DeckTech cloud if you turn it on.

## Update check

DeckTech checks whether there is a new version when it starts with internet, by contacting GitHub, where releases are published, as described in the first table. On Windows, DeckTech downloads the update from GitHub and installs it when you close the app or with the update button; on macOS and Android, installation still depends on your confirmation. GitHub may log technical connection data, including IP address, date, time and user agent, acting as an independent controller under its [Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Produtora MaxVision does not receive those records individually, and the request carries no account, license, app list or usage data.

MaxVision may set a minimum DeckTech version for security, correction of a serious defect or compatibility, under the EULA. That rule is not active at launch.

## On your computer and your network

DeckTech operates primarily on the local network, with no account and no Produtora MaxVision telemetry. The computer stores the main configuration, the access code, the private key of the security certificate and, if you set one, the OBS WebSocket password (in `.obs-password`, readable only by your user account). The OBS password is never sent back to clients. Clients receive the data the deck needs and retain their session; Android also stores the computer's address and the certificate's security code. The certificate's private key is not sent to clients. That data travels only among devices you connect to your local network.

In DeckTech PRO, the computer also stores the license code, the proof of activation and, encrypted, the access details of the integrations you set up (for example, access to your Home Assistant). That data stays on the computer and is not sent to MaxVision.

## DeckTech PRO purchase

- **When you click buy**, you leave the MaxVision site and go to Stripe's payment page, which has its own policy and cookies. MaxVision does not receive card data.
- **Data:** what the payment page asks for (for example e-mail, name, country and payment method details, and the IP address). MaxVision sees the e-mail and the payment status in Stripe's dashboard, and receives payment, returned-payment and dispute notices from Stripe. Stripe keeps the payment data for the period the law requires of it, under the [Stripe policy](https://stripe.com/privacy#security-and-retention).
- **What MaxVision's licensing service stores:** the license identifier, the Stripe session and payment identifiers, a scrambled value of the e-mail (a hash made with a secret key, not the e-mail), the license code issued, dates, the state (active, cancelled or in dispute) and whether the e-mail was sent. The e-mail itself is not stored in that service or written to its logs. That scrambled value is still personal data, because MaxVision can recompute it from the e-mail; we treat it as such.
- **Resend:** receives your e-mail and the license code to send the message, and may keep delivery records under the [Resend policy](https://resend.com/security/gdpr).
- **Why:** to sell, deliver the license, send it again when you ask, cancel it when the full payment is returned or a dispute is lost, and support you.
- **Withdrawal through the page:** the e-mail you enter is used to immediately send, through Resend, a receipt and a confirmation link, as Decree 7,962/2013 requires (article 5, paragraph 4). For 30 minutes the service stores the keyed hash of the e-mail and the link's cryptographic digest; the digest is deleted when the link is used or, if it is not, in the next maintenance run after it expires (the routine runs every 10 minutes). The e-mail and the link itself are not stored. After confirmation, the request is recorded with its date, the purchase and returned-payment identifiers and the processing state, without the e-mail. That record allows returning the payment through Stripe, cancelling the license and proving that the request was handled, and it is kept for 5 years, like the sale record. Legal basis: compliance with a legal obligation (LGPD, art. 7, II; Brazilian Consumer Protection Code, article 49; Decree 7,962/2013, article 5) and performance of a contract (art. 7, V).
- **For how long:** the sale record (the license, the Stripe payment identifiers, the dates and the state) is kept for 5 years, counted from the start of the year after the purchase, even if the license is cancelled (National Tax Code, article 173; Brazilian Consumer Protection Code, article 27; LGPD, art. 16, I). The other data in this section stays while the license exists. We erase on a verified request everything the law does not oblige us to keep.
- **Legal basis:** performance of a contract (LGPD, art. 7, V), to sell and deliver the license; compliance with a legal or regulatory obligation (art. 7, II), to keep the sale record and the tax documents.
- **Request limit:** for license re-send, device management and withdrawal requests, the service stores, per day, a counter tied to the keyed hash of the e-mail typed, only to limit abuse (legitimate interest, LGPD, art. 7, IX). That counter is deleted after 30 days.

## Activation, checks and slots

- **Data sent:** those in the PRO table. The public key is generated by DeckTech on your computer; the private key stays there and never leaves. DeckTech does not send the computer's name, serial number or hardware identifiers. Phones and tablets send nothing to the licensing service: the computer controls their slots.
- **What the licensing service stores:** the random slot number, the license identifier, the computer's public key, the number of phone slots, a counter, the slot state (active, released or cancelled), the system type, the DeckTech version, and the days (without time) of activation, of the last check (at most once a day) and of release. It also keeps a log of slot events (type and day) to apply the activation limits. A scrambled value of the single-use link sent by e-mail is kept for 30 minutes.
- **Why:** to count the plan's devices, apply the device limit, know whether the license was cancelled and prevent the same code from being used by many people.
- **For how long:** while the license exists; a released slot is erased 180 days after release; the slot event log is kept for 400 days.
- **IP address:** Cloudflare processes the IP address to deliver the connection. To limit abuse, the licensing service uses the IP address as a request-counting key for a few minutes (about 5) and does not write it to the service's operating logs. The IP address is also kept as an access record, described in the section "Access records".
- **Legal basis:** performance of a contract (LGPD, art. 7, V); prevention of fraud and misuse of the license, as an informed purpose (art. 6, I) and, for the abuse limits, legitimate interest (art. 7, IX).

## Access records

- **Alexa cloud scope:** the DeckTech cloud also keeps the IP address, UTC date/time and type of service only for the host app and account-linking page (validated computer operations, valid linking forms and successful linking). Calls from Amazon servers or the AWS adapter, including Alexa commands and access exchanges, do not create user access records. Health probes, stateless challenges, unknown pages, wrong methods and refused requests do not create cloud access records. No request body, parameters or access codes are stored in these records. The same deletion after 183 days and restricted access below apply, including after removing the computer from the service.

- **What is kept:** each time the pages and services at decktech.com.br/pro are used (completed purchase, license recovery, withdrawal, device management, activation without internet, DeckTech's connections to activate, check and release the license, and Stripe's payment notices), MaxVision's licensing service keeps the IP address, the date and time (in UTC) and the type of page or service used. It does not keep e-mail, request content, license code or the full address with parameters.
- **Why and legal basis:** compliance with a legal obligation (LGPD, art. 7, II). The Marco Civil da Internet (Law 12,965/2014, article 15) requires an internet application provider organized as a legal entity that carries on the activity in an organized, professional manner and for economic purposes to keep access records, confidentially, in a controlled and secure environment, for 6 months.
- **For how long:** 6 months. The service's automatic routine deletes records older than 183 days.
- **Who can see them:** no page or service of the site shows these records. They are stored in an encrypted database (Cloudflare D1) and only MaxVision, which administers it, has access. MaxVision hands them to third parties only by court order (Law 12,965/2014, articles 10, paragraph 1, and 15, paragraph 3). The police or administrative authority and the Public Prosecutor's Office may request, as a precautionary measure, that they be kept longer (article 15, paragraph 2); delivery still depends on a court order.

## Alexa add-on

- **Only if you turn it on.** The add-on is optional. Free DeckTech, and PRO without the add-on, do not use the DeckTech cloud.
- **Data sent when you turn it on:** the license code and the proof of the computer's activation (used once at registration; the cloud keeps only scrambled values of the license identifier and of the slot identifier), the DeckTech version, and the name, type and code of each action you allow for Alexa. The name is text you write and may contain personal data.
- **What the cloud stores:** the computer's identifier in the cloud, a scrambled value of its key, the scrambled value of the license identifier, the state, the creation date and the date of the last connection (written at most once an hour), the DeckTech version, the allowed actions (name and type), the links with Alexa (identifier, creation date and day of last use, and scrambled values of the access codes), the on or off state of recording and streaming, and, for 10 minutes, a record to avoid repeating the same command. We keep no command history.
- **When you ask Alexa for something:** Alexa sends the request to the adapter, which passes it to our cloud as the code of an action, not as the spoken text, and the cloud passes it on to your computer. MaxVision does not receive your Amazon account, e-mail or password.
- **IP address:** Cloudflare processes it to deliver the connection. To limit abuse attempts, the cloud uses a scrambled version of the IP, with a key that changes every day, for up to 24 hours. Separately, access records for the host app and account-linking page only keep the actual IP for 6 months (deleted after 183 days), under Marco Civil da Internet article 15. Amazon-server and AWS-adapter calls are excluded; removing the computer does not delete these legally retained records.
- **Amazon:** Amazon handles what you say to Alexa and the action names, as an independent controller, under [its privacy policy](https://www.amazon.com/gp/help/customer/display.html?nodeId=GX7NJQ4ZB8MHFRNJ). The add-on's adapter runs on Amazon Web Services (US East region, N. Virginia), sees the access codes and action codes in transit and keeps no command history.
- **For how long:** while the connection exists. Computer connections unused for 180 days are erased; links with Alexa unused for 365 days too. You can erase everything, except the access records, kept by law for 6 months (Marco Civil da Internet article 15), at any time, in DeckTech, with "Forget this computer".
- **Legal basis:** performance of a contract (LGPD, art. 7, V), because the add-on is part of the license; legitimate interest (art. 7, IX) for the abuse limits.

## Local integrations

Home Assistant, "Appear in Home Assistant", Philips Hue and requests from outside DeckTech do not go through MaxVision. DeckTech connects to the address you provide: your Home Assistant, your message server and your Hue bridge. You choose that address, and it may be outside your network; the data then travels there over the internet and follows the rules of whoever receives it. DeckTech does not use Philips Hue's internet bridge discovery service: the bridge is found on your local network or at the address you type. The access details for those services are stored, encrypted, only on your computer.

Requests from outside (for example, from an iPhone shortcut or a Home Assistant rule) reach your computer over the local network and only run the actions you allow, with an access code that you create. On connections without encryption, that code can be read by other devices on the same network; use it only on a trusted network and revoke the code if you suspect it was exposed.

## Suppliers and their roles

| Supplier | What for | Role | Policy |
|---|---|---|---|
| Stripe | Payment and returned payment | Independent controller for payment data; MaxVision receives the result | [Stripe policy](https://stripe.com/br/privacy) |
| Resend | Sending the license e-mail | Processor | [Resend policy](https://resend.com/legal/privacy-policy) |
| Cloudflare | Hosting the site, licensing service, Alexa add-on cloud, receiving the contact e-mail | Processor | [Cloudflare policy](https://www.cloudflare.com/privacypolicy/) |
| Amazon Web Services | The Alexa add-on adapter | Processor | [AWS policy](https://aws.amazon.com/privacy/) |
| Amazon (Alexa) | Voice and action names | Independent controller | [Amazon policy](https://www.amazon.com/gp/help/customer/display.html?nodeId=GX7NJQ4ZB8MHFRNJ) |
| GitHub | Releases and updates; public reports | Independent controller | [GitHub statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) |
| Google | Website icons on the phone deck | Independent controller | [Google policy](https://policies.google.com/privacy) |

Messages sent to contato@decktech.com.br reach MaxVision's mailbox through Cloudflare's e-mail forwarding service.

## International transfer

These suppliers may process data outside Brazil, especially in the United States: Cloudflare's network is global, and the Alexa add-on adapter runs in the US East region of Amazon Web Services. Basis: transfer necessary to perform the contract (LGPD, art. 33, IX, combined with art. 7, V), or contractual safeguards (art. 33, II), depending on the supplier.

## Your rights, without an account

The LGPD (Law 13,709/2018, art. 18) gives you, at any time and on request: confirmation that we process your data; access to the data; correction of incomplete, inaccurate or outdated data; anonymization, blocking or erasure of unnecessary or excessive data or data processed in breach of the law; portability to another provider; erasure of data processed with your consent; information about the entities we share data with; information that you may refuse consent and about the consequences; and withdrawal of consent.

Data that the law obliges MaxVision to keep (the sale record and the access records) cannot be erased before the legal period ends (LGPD, art. 16, I).

Since DeckTech has no account, MaxVision has no profile of you. To exercise your rights:

- e-mail [contato@decktech.com.br](mailto:contato@decktech.com.br) with the subject "Privacidade", from the e-mail used at purchase; we compute the scrambled value of that e-mail and look for the purchase and the computers tied to the license; you do not need to send documents;
- if you turned on the Alexa add-on, you can erase everything, except the access records, kept by law for 6 months (Marco Civil da Internet article 15), in DeckTech itself, with "Forget this computer", or ask by e-mail giving the computer code that DeckTech shows;
- confirmation that we process your data, or access to it, is given in a simplified form, immediately, or by a complete statement within 15 days of the request (LGPD, art. 19);
- requests about data held by Stripe, Resend, Amazon, GitHub or Google can also be made to them;
- data subjects may also petition against the controller before the National Data Protection Authority (LGPD, art. 18, paragraph 1).

## Children

DeckTech is not directed to children.

## This website

The decktech.com.br website is hosted on Cloudflare, which processes technical request data such as IP address to deliver and protect it, under the [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/). Without marketing consent, the pages load no third-party marketing tracking resources; Cloudflare may set its own technical security cookies under its policy. Cloudflare Web Analytics measures visits to the site without cookies and without identifying the visitor. Theme and language preferences are stored only in your browser. The purchase links lead to Stripe's payment page, and links to GitHub (Issues, Discussions and releases) lead to GitHub; public submissions there follow its own terms and privacy policy.

## Optional marketing cookies

The site uses the Meta Pixel, only with your consent (LGPD art. 7, I), to measure visits and download clicks, measure advertising campaigns and personalize ads. Nothing from Meta loads before you accept marketing cookies. After acceptance, the Pixel uses the first-party cookie `_fbp`, with a lifetime of 90 days, as described in [Meta's Cookie Policy](https://www.facebook.com/privacy/policies/cookies/). Meta Platforms receives the visit and download events and related browser information under [Meta's Privacy Policy](https://www.facebook.com/privacy/policy/); this may involve international transfers and processing outside Brazil. You can reject as easily as accept and withdraw consent through "Cookie preferences" in the footer. Your choice is stored only in your browser for 12 months, separately from the cookie's lifetime. Withdrawal stops subsequent tracking and removes the Pixel's first-party cookies; it does not undo information already sent to Meta after acceptance or remove cookies on Meta's domains.

## Issues and reports on GitHub

When you open Issues, Discussions, or private vulnerability reports, you provide GitHub and the maintainers with the content and profile data you choose to publish. Do not include private certificates, access codes, passwords, license codes, personal addresses, or unreviewed logs.

## Changes to this notice

Produtora MaxVision may change this notice. The new version will be published on the official channels with its effective date.

## Contact

For privacy questions, e-mail [contato@decktech.com.br](mailto:contato@decktech.com.br) and identify the message as a privacy matter. Use of DeckTech PRO is governed by the [DeckTech PRO Terms](https://decktech.com.br/termos-pro) and use of DeckTech by the End User License Agreement (EULA).
