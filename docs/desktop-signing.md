# 桌面端 macOS 签名与公证（Developer ID）

面向「把 macOS 包签明白、让用户下载即开」的运行手册。**读这一篇就够了**，不需要再去翻 Tauri 文档。

## 0. 为什么必须做

macOS 上「能不能打开」由签名与公证共同决定，三者的后果差别很大（历史上踩过第 1 行）：

| 状态 | 用户看到 | 能否运行 |
|---|---|---|
| **坏签名**（`Sealed Resources=none`：签名声称有资源、实际没封存） | 无任何提示，闪一下就没了 | ❌ 内核 SIGKILL，**连「仍要打开」都不出现** |
| **ad-hoc 签名**（`signingIdentity: "-"`，当前状态） | 「无法验证开发者」/ 已损坏 | ⚠️ 要「右键→打开」或系统设置里放行一次 |
| **未公证**（签名有效、无公证票据） | 「无法验证开发者」 | ⚠️ 仍需放行一次 |
| **Developer ID 签名 + 公证 + staple** | 无提示，双击即开 | ✅ |

所以目标是把最后一行做出来。**公证票据必须 staple 到 .app 与 .dmg 上**，否则用户离线首次打开仍会被拦。

## 1. 链路总览

```
Apple 侧（一次性）                  CI（每次发版）
─────────────────                  ──────────────
CSR ─┐
     ├─► Developer ID Application 证书 ──► base64 存入 Secret
     │                                        │
     └─► App Store Connect API Key ──┐        │
        (.p8 + Key ID + Issuer ID)   │        │
                                     ▼        ▼
                              ┌──────────────────────────────┐
                              │ CI: 导入临时 keychain         │
                              │  → tauri build 自动:          │
                              │     签名(hardened runtime)    │
                              │     → 公证 .app               │
                              │     → staple .app             │
                              │  → 验证闸门(fail closed)      │
                              │     .app/.dmg 双验            │
                              │     .dmg 缺票 → 显式补公证     │
                              └──────────────────────────────┘
```

## 2. 你要在 Apple 侧做的事（一次性，约 20 分钟）

### 2.1 生成 CSR

钥匙串访问 → 证书助理 → **从证书颁发机构请求证书** → 存储到磁盘 → 填邮箱（任意，建议与 Apple ID 一致）、选「存储到磁盘」。

### 2.2 创建 Developer ID Application 证书

[Certificates, IDs & Profiles](https://developer.apple.com/account/resources/certificates/list) → `+` → 选 **Developer ID Application**（不是 Apple Distribution——那个只能进 App Store）→ 上传上一步的 CSR → 下载 `.cer`。

> ⚠️ **只有团队的 Account Holder 能创建 Developer ID 证书**。如果你不是，需让持有人操作，或让他把你的 Apple ID 加进团队并由你提交 CSR。

双击 `.cer` 装进钥匙串（注意钥匙串访问左侧默认钥匙串选 **login**，否则证书不会出现在「我的证书」里）。

### 2.3 导出 .p12 并转 base64

钥匙串访问 → 左侧选 **login** 钥匙串 → **我的证书** → 找到
`Developer ID Application: <你的名字> (TEAMID)` → **点开左侧三角展开它** →
导出时**必须选到私钥**：

- 方式一：右键**展开后的「私钥」那一行** → 导出
- 方式二：按住 ⌘ 同时选中「证书」与「私钥」两行 → 右键 → 导出

> ⚠️ **格式下拉里只有 `.cer` / `.pem` / `.p7b`、没有 `.p12`？**
> 那说明你选中的是**证书行**（或只选了证书）。这三种都是"只含证书"的格式；
> `.p12`（Personal Information Exchange）是"证书＋私钥"打包格式，**只有选中内容含私钥时
> 才会出现在下拉里**。按上面两种方式之一重选即可，不需要重新签发证书。

命令行备选（不想在 GUI 里点，或 GUI 行为异常时）：

```bash
# -t identities = 导出"身份"（证书+私钥），-f pkcs12 = p12 格式
security export -t identities -f pkcs12 \
  -k ~/Library/Keychains/login.keychain-db \
  -o ~/Desktop/certificate.p12 -P '<给 p12 设的密码>'
```

导出后**先验证里面确实有私钥**（看到 `Shrouded Keybag` 才算对）：

```bash
openssl pkcs12 -in ~/Desktop/certificate.p12 -passin pass:'<密码>' -info -noout 2>&1 \
  | grep -E "Shrouded Keybag|friendlyName|subject="
```

然后转 base64 备用：

```bash
openssl base64 -A -in ~/Desktop/certificate.p12 -out /tmp/cert-base64.txt   # 注意 -A：不要换行
```

### 2.4 记下 Team ID

[Account](https://developer.apple.com/account) → Membership details → **Team ID**（10 位，形如 `A1B2C3D4E5`）。

### 2.5 建 App Store Connect API Key（公证用）

[Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api) → Team Keys → `+` → 角色选 **Developer**（或 Admin）→ 记下 **Key ID**、页面上方的 **Issuer ID**，并**下载 `.p8`（只能下载一次！）**。

**为什么用 API Key 而不是 Apple ID + 专用密码**：
- 不需要个人 Apple ID 的专用密码（那个还牵扯 2FA、失效要重配）
- 权限可撤销、与个人账号解耦，适合 CI
- `notarytool` 原生支持（`--key --key-id --issuer`）

## 3. GitHub Secrets 清单

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret | 内容 | 来源 |
|---|---|---|
| `APPLE_CERTIFICATE` | `.p12` 的 base64（**单行**） | 2.3 的 `cert-base64.txt` |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设的密码 | 2.3 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <名字> (TEAMID)` | `security find-identity -v -p codesigning` 的引号内全文（2.2 装好后） |
| `KEYCHAIN_PASSWORD` | 随便一个强随机串（CI 临时钥匙串用，与 Apple 无关） | `openssl rand -hex 16` |
| `APPLE_API_KEY` | Key ID（形如 `2X9R4HXF34`） | 2.5 |
| `APPLE_API_ISSUER` | Issuer ID（UUID 形式） | 2.5 |
| `APPLE_API_KEY_P8_BASE64` | `.p8` 的 base64（单行） | 2.5 下载的 `AuthKey_<KeyID>.p8` |
| `APPLE_TEAM_ID` | Team ID | 2.4 |

生成 `.p8` 的 base64：

```bash
openssl base64 -A -in ~/Downloads/AuthKey_XXXXXXXXXX.p8 -out /tmp/p8-base64.txt
```

**没配这些 secrets 也能跑**：workflow 会降级为 ad-hoc 签名（同今天的行为）并打印 warning，不会让构建失败。一旦配了，验证闸门就转为**强制** Developer ID + 公证。

## 4. CI 链路做了什么

`.github/workflows/desktop-release.yml`（打 tag）与 `desktop-preview.yml`（push main）里的 macOS job：

1. **导入证书到临时 keychain**（`security create-keychain` + `import` + `set-key-partition-list`），并导出 `APPLE_SIGNING_IDENTITY`——它会**覆盖** `tauri.conf.json` 里的 `"-"`，所以本地 ad-hoc 路径不受影响。
2. **准备公证凭据**：把 `.p8` 写到 `~/.appstoreconnect/private_keys/AuthKey_<KeyID>.p8`（Tauri 的默认搜索路径之一），并显式给 `APPLE_API_KEY_PATH`。
3. **`tauri build`**：Tauri 见到 `APPLE_*` 即自动签名（hardened runtime）→ 公证 `.app` → staple。
4. **验证闸门（fail closed）**：`desktop/scripts/verify-macos-dist.sh` 对 `.app` 与 `.dmg` 逐个断言：
   - `codesign --verify --deep --strict` 通过，且资源已封存（防坏签名）
   - 签名主体是 **Developer ID Application**（配了 secrets 时强制；ad-hoc 不再放行）
   - Gatekeeper 接受：`spctl -a -vvv`
   - `xcrun stapler validate` 通过（票据已 staple）
   - **`.dmg` 若无票据 → 显式 `notarytool submit --wait` + `stapler staple` 后复验**
     这一条是刻意的：Tauri 是否给 dmg 自动公证随版本而异，闸门不依赖该行为。

## 5. entitlements：ad-hoc 与分发是两份

`bundle.externalBin` 里的 `coeditor-server` 是 **bun 编译的单文件可执行**（内含 JavaScriptCore），因此需要 JIT 相关权限；而 ad-hoc 没有 Team ID，还要额外放开库校验：

| 键 | `macos-entitlements.plist`（ad-hoc，本机） | `macos-entitlements-dist.plist`（分发，CI） |
|---|---|---|
| `com.apple.security.cs.allow-jit` | ✅ | ✅ |
| `com.apple.security.cs.allow-unsigned-executable-memory` | ✅ | ✅ |
| `com.apple.security.cs.disable-library-validation` | ✅（ad-hoc 无 Team ID，不加会加载内嵌组件失败） | ❌ 去掉（分发时所有内嵌二进制同 Team 签名，不需要） |

CI 通过 `--config` 传入一个覆盖文件把 `bundle.macOS.entitlements` 指向分发版；本地默认不动（保持 ad-hoc 可用）。

> 如果分发版因为去掉 `disable-library-validation` 而出现内嵌组件加载失败，把它加回去即可——Apple 的公证**不会**因为这一条拒绝，它只是放宽了运行期校验。

## 6. 别和「更新器签名」搞混

| | 用途 | 密钥 |
|---|---|---|
| **Apple 签名/公证**（本篇） | 让 macOS 允许运行、去掉「无法验证开发者」 | Developer ID 证书 + ASC API Key |
| **Tauri updater 签名** | 让应用能验证自动更新包没被篡改 | `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD`（自签，与 Apple 无关） |

两者互不替代。当前项目没启用 updater，故 CI 未配置后者。

## 7. 本地验证速查

```bash
# 1) 看签名主体（是不是 Developer ID、有没有 hardened runtime、票据信息）
codesign -dvvv --entitlements - /path/to/CoEditor.app

# 2) 结构校验（CI 闸门用的就是它）
codesign --verify --deep --strict --verbose=2 /path/to/CoEditor.app

# 3) Gatekeeper 是否放行（模拟用户双击）
spctl -a -vvv -t install /path/to/CoEditor.app
spctl -a -vvv -t open --context context:primary-signature /path/to/CoEditor.dmg

# 4) 公证票据是否已 staple
xcrun stapler validate /path/to/CoEditor.app
xcrun stapler validate /path/to/CoEditor.dmg

# 5) 手动公证（脚本里 .dmg 补票用的就是这套）
xcrun notarytool submit /path/to/CoEditor.dmg \
  --key ~/.appstoreconnect/private_keys/AuthKey_<KeyID>.p8 \
  --key-id <KeyID> --issuer <IssuerID> --wait

# 6) 公证失败时看详细原因（这一步最有用）
xcrun notarytool log <submission-id> --key ... --key-id ... --issuer ...
```

本地想用 Developer ID 试签（证书已装进钥匙串时）：

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: <名字> (TEAMID)"
cd desktop && npx tauri build --bundles app
```

## 8. 常见坑

- **证书建不出来**：Developer ID 只有 Account Holder 能建（见 2.2）。
- **导出时格式下拉里没有 `.p12`**（只有 `.cer/.pem/.p7b`）：选中的是证书行，没带上私钥。
  点开三角展开、右键**私钥**行，或 ⌘ 同时选中证书+私钥——详见 2.3。**不用重新签发证书**。
  导出后务必用 2.3 的 `openssl pkcs12 -info` 确认有 `Shrouded Keybag`，否则 CI 会报找不到身份。
- **`base64` 带换行**：一定加 `-A`（单行），否则 GitHub Secret 里塞进换行会解码失败。
- **公证被拒**：多为 hardened runtime 下缺权限或签名不完整。用第 7 节的 `notarytool log` 看具体条目；`.p8` 只能下载一次，丢了要重新建 Key。
- **找不到 Issuer ID，或看到的只是 10 位串**：Issuer ID 是 **UUID 形式**
  （形如 `69a6de7b-5b0d-47e3-e053-5b8c7c11a4d1`），显示在 Integrations → App Store Connect API
  页**表格上方**，不是某一行的字段；行里那个 10 位的是 **Key ID**（也就是 `.p8` 文件名
  `AuthKey_<KeyID>.p8` 里的那一段）。它属于**团队**，所以同团队所有 Key 共用同一个 Issuer ID。
- **必须建 Team Key**：Individual Key 没有 Issuer ID，而 Tauri 只要用了 API Key 就必传
  `--issuer`，拿 Individual Key 会直接失败。建错了就删掉重建 Team Key。
- **公证报 `A required agreement is missing or has expired`（403）**：账号里有待接受的协议。
  让 Account Holder 去 App Store Connect → 「协议、税务和银行业务」接受后重试。
- **`APPLE_SIGNING_IDENTITY` 必须与证书完全一致**（含括号里的 Team ID），差一个字符就会回落到 ad-hoc。
- **多个团队**：Apple ID 属于多个团队时需设 `APPLE_PROVIDER_SHORT_NAME`（`APPLE_TEAM_ID` 的补充项）。
- **DMG 图标位置/大小在 CI 上不生效**：Tauri 已知问题 [tauri#1731](https://github.com/tauri-apps/tauri/issues/1731)，与本链路无关。
- **Intel 机器**：矩阵里 `macos-15-intel` 出 x86_64 包，公证/签名流程完全相同。

## 9. 激活清单

- [ ] 建好 Developer ID Application 证书并导出 `.p12`
- [ ] 建好 ASC API Key，记下 Key ID / Issuer ID，下载 `.p8`
- [ ] 第 3 节 8 个 Secrets 全部配好
- [ ] 跑一次 `Desktop macOS preview`（push 到 main 自动触发，或手动触发 release workflow 的 workflow_dispatch）
- [ ] 闸门输出里确认三项：`Authority=Developer ID Application...`、`spctl ... accepted`、`stapler validate ... The validate action worked`
- [ ] 下载 dmg 到一台**没装过本应用**的 Mac 上双击验证零提示
