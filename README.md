# 雾弈五子棋

一个面向手机与桌面浏览器的完整五子棋 PWA：浅色毛玻璃、多主题、五档 AI、WebRTC 房间联机、自动棋谱、历史复盘、SGF 导入导出与权威学习入口。

## 功能

- 五档 AI；第 4、5 档调用 Rapfi WebAssembly 冠军同源核心与官方 mix9svq NNUE 权重
- 15×15 自由规则五子棋
- PeerJS / WebRTC 点对点联机与自动重连
- 每局自动保存，最多保留最近 200 局
- 逐手复盘、自动播放、SGF 导入导出
- 六套浅色毛玻璃主题和无障碍动效降级
- PWA 离线缓存，可添加到手机主屏幕

## D 盘本地运行

项目代码、依赖、缓存与构建产物都在 D 盘。下面示例使用本项目准备的 D 盘 Node.js：

```powershell
$env:TEMP='D:\codexAI\.runtime\temp'
$env:TMP=$env:TEMP
$env:npm_config_cache='D:\codexAI\.runtime\npm-cache'
& 'D:\codexAI\.toolchains\emsdk\node\24.19.0_64bit\npm.cmd' install
& 'D:\codexAI\.toolchains\emsdk\node\24.19.0_64bit\npm.cmd' run dev
```

生产构建：

```powershell
& 'D:\codexAI\.toolchains\emsdk\node\24.19.0_64bit\npm.cmd' test
& 'D:\codexAI\.toolchains\emsdk\node\24.19.0_64bit\npm.cmd' run build
```

最终只需部署 `dist/` 目录。公网联机要求 HTTPS。

## 第三方软件

最高两档包含 GPL-3.0 的 Rapfi。准确源码、构建参数、官方权重校验、运行时兼容处理、作者与许可证见 `public/engine/`。应用中的世界棋谱入口只链接权威原站，不复制受原站在线使用条款限制的数据库内容。

本项目随附完整可构建源码，并以 GPL-3.0 方式发布，以满足冠军引擎的分发要求。
