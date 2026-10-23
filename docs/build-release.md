# 构建、打包与验包

仅在构建/发布相关任务阅读。依赖版本、平台目标和脚本以根及 desktop 的 package.json、`packages/desktop/electron-builder.yml`、`.github/workflows/` 为准，不在文档维护完整配置副本。

## 常规检查

根目录：`npm run typecheck`、`npm run test`、`npm run lint`、`npm run build`。

保留命令真实退出码，不用 `npm run lint | tail -2` 判断通过。环境问题、已有失败与本次回归应分开记录；重跑一次成功不能证明竞态已修好。

## 本地 macOS 内测包

不改版本、不打 tag：

```bash
cd packages/desktop
npm run build
npx electron-builder --mac --arm64
```

**必须先 build。** dev 的 renderer 在内存中，直接打包可能把磁盘 `out/` 的旧 renderer 装进去，即使 main 已经是新代码。

当前 yml 的 mac target 同时列出 arm64/x64，不能仅凭 CLI `--arm64` 推断只会生成一种架构；检查实际产物。产物位于 `packages/desktop/dist/`。

当前 adhoc 包未公证。安装前先退出正式版；相同 Bundle ID 和正式用户数据不适合并发运行。首次打开可能需要用户右键“打开”或移除 quarantine。冒烟后退出测试包，避免与正式版争用 userData。

## 验包看实际产物

在仓库根目录用一个新的任务子目录解包：

```bash
npx asar extract packages/desktop/dist/mac-arm64/Raise.app/Contents/Resources/app.asar .local/tmp/package-review/app
```

然后检查其 `out/main/`、`out/preload/`、`out/renderer/assets/` 中本次改动的实际代码。不能只凭构建时间或 main 新字符串证明 renderer 已更新。

不要在仓库根使用 `asar extract-file`，它会把文件按 basename 解到当前目录；不使用 `/tmp`。同一验包目录不要混入上次产物。

## 必须保留的构建边界

- preload 输出 CJS `index.cjs`；sandbox 下不能随意改成 ESM。
- main 的 workspace backend/shared 需按现有 Vite 配置打入 bundle，避免被 externalize 当普通外部包；SDK 保持既有 external 边界。
- electron-builder 从 desktop 依赖树收包，需要的生产依赖不能只放根 devDependencies。Electron 使用精确版本。
- `PI_PACKAGE_DIR` 指向随包 `pi-package`，相关 docs/examples、主题和导出资源需一起带入；不要只复制文档漏掉运行时资源。
- esbuild 等需要 spawn 的二进制不能在 asar 内执行；保留 `asarUnpack` 和 `ESBUILD_BINARY_PATH` 处理。
- 项目要求 Node >=22.19；Electron 二进制缺失时先核对安装脚本授权与依赖安装日志，不要改应用代码绕过。
- Release 构建出现 V8 heap OOM 时检查 workflow 的 Node 堆上限；这是构建峰值，不是应用运行时内存。别把 Rollup annotation warning 当根因。
- `patches/` 由 patch-package 在 postinstall 应用。修改依赖后更新补丁，升级依赖时重核官方实现与补丁必要性。

## 发布与平台验证

本机维护者的 tag、签名、网络等操作见 `.local/docs/release.md`（不入库）；文件不存在时从仓库 workflow 和 builder 配置核对，不猜发布步骤。未经用户明确要求不 push、不创建发布或覆盖已发布资产。

## Gitee 主仓库 + GitHub 镜像发布

二进制不挂 Gitee：发行版附件单文件上限 100 MB（GVP 200 MB），而桌面安装包必然超限（`raise-windows-x64.exe` 约 170 MB、`raise-windows-x64.zip` 约 230 MB）。所以发布链路固定为：

1. 打 tag（`v*`）并推送到 GitHub 镜像仓库 → `.github/workflows/release.yml` 在 macOS/Windows/Linux runner 上构建，产物挂到 GitHub Release（`upload-artifact` 只收 `dist/*.exe|zip|dmg|AppImage|blockmap`，不要把 `win-unpacked/`、`mac*/`、`.icon-ico/`、`builder-debug.yml` 带进去）。
2. README 下载表使用稳定链接 `https://github.com/<owner>/<repo>/releases/latest/download/<artifactName>`，始终指向最新版；`artifactName` 见 `electron-builder.yml`（`raise-mac-${arch}.*` / `raise-windows-${arch}.*` / `raise-linux-${arch}.*`）。
3. Gitee 发行版页只写版本说明并指回 GitHub Release，附件不上传（上传必失败：超 100 MB）。

镜像推送（仓库只配了 gitee origin 时）：

```bash
git remote add github https://github.com/<owner>/<repo>.git
git push github main --tags
```

README 里的 `<owner>/<repo>` 必须与实际 GitHub 仓库一致，否则下载链接和 release 页全部 404。Windows 包可以在本机用 `npm run dist -w packages/desktop` 单独构建并在 `dist/` 冒烟；macOS/Linux 包只能由 CI 产出，本机无法替代验证。

Windows 更新诊断及旧卸载器边界见 [WINDOWS-UPDATES.md](WINDOWS-UPDATES.md)。NSIS 改动须用 Windows CI 的真实 installer 编译和隔离 harness 验证，macOS 上的编译结果不能替代 Windows 行为证据。
