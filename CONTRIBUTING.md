# 贡献指南

## 欢迎的贡献

- **新机型适配报告** —— 跑 `scripts/detect.sh` 贴结果 + 说明是否可用
- **新版本应用适配** —— 类名变动时更新 `src/acc.js` 里的 `CLASSES` 表
- **Bug 修复** —— 附 `acc_v9.log` 相关片段
- **文档改进**

## 适配新版本

腾讯乐固壳会随版本变化，混淆类名会漂移。适配步骤：

1. 在新版本上跑 `detect.sh` 确认基础条件
2. 看 `acc_v9.log` 里哪些 `Java.use` 失败
3. 用 `frida-trace` 或 `jadx` 找到新类名
4. 更新 `src/acc.js` 顶部的 `CLASSES` 候选表：
   ```javascript
   var CLASSES = {
     speaker:  ['ksong.support.audio.AudioSpeaker', '<新类名>'],
     songInfo: ['com.tencent.qqmusicsdk.protocol.SongInformation', '<新类名>'],
     // ...
   };
   ```
5. 提交 PR，说明测试的设备型号 + 应用版本

## 提 PR 前

- `node --check src/acc.js` 通过
- `bash -n scripts/*.sh` 通过
- 在自己的设备上实测切换正常

## 不要提交

- APK 文件（腾讯版权）
- Frida 二进制（体积大，用 `fetch-frida.sh` 下载）
- 含个人信息的日志、IP、凭据
