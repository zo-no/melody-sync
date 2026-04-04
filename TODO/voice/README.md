# Voice TODO

这条能力先保留在仓库里，不作为当前优先级功能继续推进。

当前约定：

- 不删除现有语音代码、脚本、设置页和测试
- 不继续把 Voice 作为当前主线能力扩展
- 后续如果恢复开发，再从这里继续

## 当前状态

- `设置 -> Voice` 已经接进系统
- `voice/config.json` 会落在当前 `appRoot`
- `scripts/voice-connector-instance.sh` 可以管理本地常驻进程
- `持续聆听` 模式可以启动
- `唤醒词模式` 在当前 macOS/Swift 路径上仍有崩溃问题，暂未修完

## 当前问题

1. 设置页虽然已经简化，但产品形态还不够顺手
2. `唤醒词模式` 仍然有 Swift 崩溃问题
3. 麦克风权限、语音识别权限、Terminal 启动方式之间的交互还不够稳
4. 这条能力目前会分散主产品重构注意力，不适合作为当前优先级

## 主要文件

### Backend

- `backend/voice-settings-store.mjs`
- `backend/routes/settings.mjs`

### Frontend

- `static/frontend/settings/voice/ui.js`

### Shared

- `lib/voice-connector-config.mjs`
- `lib/voice-connector-presets.mjs`

### Scripts

- `scripts/voice-connector.mjs`
- `scripts/voice-connector-instance.sh`
- `scripts/voice-managed-passive.sh`
- `scripts/voice-managed-wake.sh`
- `scripts/voice-managed-capture.sh`
- `scripts/voice-utterance-loop.py`
- `scripts/voice-wake-phrase.swift`
- `scripts/voice-capture-until-silence.swift`

### Tests

- `tests/test-voice-settings-store.mjs`
- `tests/test-voice-settings-route.mjs`
- `tests/test-chat-voice-settings-ui.mjs`
- `tests/test-voice-connector.mjs`

## 后续恢复时先看

1. 先确认 `持续聆听` 和 `唤醒词模式` 各自的真实目标产品形态
2. 先修 `scripts/voice-wake-phrase.swift` 的崩溃
3. 再决定是否继续保留独立 `Voice` 设置页，还是收进更轻的本地输入设置
4. 最后再考虑 Mac mini 常驻部署
