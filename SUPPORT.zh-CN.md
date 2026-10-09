[English](SUPPORT.md) | [Português (Brasil)](SUPPORT.pt-BR.md) | [Español](SUPPORT.es.md) | [Русский](SUPPORT.ru.md) | 简体中文

# 支持

责任方：Produtora MaxVision, São Paulo/Brasil.

本文是 SUPPORT.md 的简体中文译文。文中用直引号引用的应用消息，均按应用实际显示的文字（英语或葡萄牙语）原样给出，因为 DeckTech 没有中文界面（参见 [README](README.zh-CN.md) 中的语言说明）。

## 安装与问题

请先阅读 [README](README.zh-CN.md)，其中包含关于 SmartScreen、Gatekeeper、配对和校验和的说明。

- 如有不涉及敏感信息的问题，请使用 [Discussions](https://github.com/produtoramaxvision/DeckTech/discussions)。
- 如遇可复现的缺陷，请填写[缺陷报告表单](https://github.com/produtoramaxvision/DeckTech/issues/new?template=bug_report.yml)。
- 如有想法，请使用 [Ideas](https://github.com/produtoramaxvision/DeckTech/discussions/categories/ideas) 分类。
- 如需直接联系，请发送电子邮件至 [contato@decktech.com.br](mailto:contato@decktech.com.br)。
- 如发现安全漏洞，请遵循 [SECURITY.md](SECURITY.md)；切勿公开发布漏洞报告。

请注明版本和平台。在附上日志或截图之前，请隐去访问码、IP 地址、用户名、个人路径及其他敏感数据。支持由社区提供，不保证 SLA。

## 故障排查

- **访问码被拒绝或被锁定。** 如果 deck 显示 "Too many attempts — wait {s}s."，说明输错 5 次验证码后，主机已暂时锁定你的设备，{s} 为剩余的秒数。锁定从 60 秒开始，每连续锁定一次时长翻倍（60 秒、2 分钟、4 分钟……最长 1 小时）；换同一网络中的另一台设备尝试可以避开这一特定锁定（每台设备各有自己的锁定），但避不开全局锁定：2 小时内有 5 台不同的设备输错验证码，就会触发对任何设备新登录的 30 分钟锁定（每次再次触发时长翻倍，最长 24 小时；来自同一台设备的重复尝试最多只计一次），在此期间即使输入正确的访问码也会被拒绝。请等待提示的时间，并在主机的 **Connect** 标签页中核对访问码。如果显示 "Wrong code."，请输入主机上当前显示的访问码。
- **HTTPS 端口被占用。** 如果主机显示 "HTTPS for the Android app could not start because port {port} is already in use. Close the other app using that port and try again."，请关闭占用该端口的其他应用并重新启动 DeckTech。在可信网络中，仍可通过浏览器以 HTTP 访问。在 Windows 上，此消息始终以葡萄牙语显示；在 macOS 上，则跟随应用中选择的语言。
- **证书已变更。** 如果 Android 应用显示 "The computer certificate changed" 和 "The connection was blocked because the certificate changed."，请把新的代码与主机 **Connect** 标签页上的 **Security code** 对比。只有在两者一致时，才点按 **Replace after checking**。
- **因处于其他网络而被拒绝配对。** 如果主机的 **Connect** 标签页显示 "This computer has no local-network address available for the Android app — check that the computer and phone are on the same local network (Wi-Fi or Ethernet, not a VPN)."，说明这台电脑没有可提供给 Android 应用的局域网（LAN）地址；请让它连接到与手机相同的 Wi-Fi 或以太网（不是 VPN），然后重新加载该标签页。如果手机显示的是 "This pairing link points to an address outside your local network or Tailscale, so it was ignored for security. DeckTech only pairs within the LAN or Tailscale."，则说明你使用的配对链接指向了这套安装所在局域网或 Tailscale 之外的地址；请在你真正要配对的那台电脑的 **Connect** 标签页中，于与手机相同的网络里重新生成二维码或代码。
- **在应用之外打开配对链接时的警告。** 如果手机以 "This link was opened outside the app (camera, browser, or another app) — only continue if you just opened or scanned it yourself, right now, from your own computer." 要求确认，只有当你本人刚刚在自己的电脑上扫描或打开了该二维码或链接时才确认；否则请点按取消（取消按钮默认已被选中）。
- **首次运行时的许可协议（EULA）界面。** Windows、macOS 和 Android 在首次使用前都会要求你接受许可协议。在 Windows 上，必须勾选同意复选框才能启用接受按钮；拒绝会关闭应用。具有法律约束力的文本是葡萄牙语的 [EULA.md](EULA.md)，以其为准；另提供[英文译文](EULA.en.md)以便参考。
- **你的数据存放在哪里。** 在 Windows 上位于 `%LOCALAPPDATA%\DeckTech`；卸载时会保留，除非你勾选 **Remover também os dados do usuário**（卸载程序为葡萄牙语）。在 macOS 上位于 `~/Library/Application Support/DeckTech`。

## 支持项目

关于自愿捐助、赞助、伙伴关系或委托工作室，请查看
[支持项目](SUPPORT_THE_PROJECT.zh-CN.md)。这些事务与技术支持分开；
寻求帮助不需要捐款。

## OBS Studio

如需配置 OBS，或排查密码错误、服务器未启用、端口不是 4455 等问题，请参阅 [README 中的 OBS Studio](README.zh-CN.md#obs-studio)。切勿在支持请求中附上你的 OBS 密码或连接信息。
