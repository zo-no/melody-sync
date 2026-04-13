# GTD 任务生命周期与转换规则

AI 负责主动管理任务的生命周期。不要等用户来问，在对话自然结束点主动执行。

---

## 任务状态流转

```
收集箱 (inbox)  ← 用户随机创建的会话，人类做的事
    ↓ 对话中 AI 识别出有价值的模式
    ├→ 长期任务 (recurring_task)   — AI 需要定期自动做
    ├→ 短期任务 (scheduled_task)   — AI 需要在某时间点做一次
    └→ 技能 (skill)               — 人类会反复手动触发的固定操作

长期任务 / 短期任务执行中遇到卡点
    ↓ AI 无法独立推进，主动创建等待任务
    └→ 等待任务 (waiting_task)     — AI 创建，交给人类处理
          ├→ 决策类：AI 列出选项，等人类选择后继续
          └→ 信息传递类：AI 需要数据/文件，等人类提供后继续

等待任务被人类触发
    ↓
    ├→ AI 执行后标记 done
    ├→ AI 执行后创建新的短期任务（下一步有时间点）
    └→ AI 执行后创建新的等待任务（还需要人类继续操作）
```

**关键区别：**
- `inbox` 是用户主动创建的，AI 负责分类和升级
- `waiting_task` 是 AI 主动创建的，交给用户处理后 AI 继续

---

## AI 何时主动执行生命周期操作

### 1. 对话结束时 — 主动整理任务

当一段对话的目标明确达成时，AI 应该：

```
✅ 把当前会话标记为 done
✅ 如果产生了新的待办，创建对应类型的任务并挂到合适的项目
✅ 如果发现某个任务的类型不对，更新 bucket 或 kind
```

**判断标准：**
- 用户说"好的"、"完成了"、"就这样"→ 标记 done
- 对话产出了一个需要后续执行的具体计划 → 创建短期任务（设时间点）
- 对话产出了一个需要人类操作的事项 → 创建等待任务

### 2. 短期任务执行完成时 — 主动决定下一步

短期任务执行完毕后，AI 不应该就此停止，而是：

```
判断：这件事做完了，还有后续吗？
    ├→ 没有后续 → 标记 done，汇报结果
    ├→ 需要人类确认 → 创建等待任务，说明需要人类做什么
    └→ 需要持续维护 → 升级为长期任务，设置合适的周期
```

**示例（摄影计划）：**
- "下次拍摄选址"执行完 → 产出了选址报告 → 创建等待任务"等待用户确认拍摄地点"
- "修图复审"人类完成 → 触发 AI 执行 → AI 产出最终选片清单 → 标记 done

### 3. 发现任务归属不对时 — 主动重新分类

如果 AI 发现一个任务放错了 bucket 或类型不对：

```
✅ 直接更新，不需要问用户
✅ 在回复中简单说明调整了什么
```

---

## 转换操作 API

### 短期任务完成后创建等待任务

```bash
# 1. 标记短期任务完成
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SCHEDULED_TASK_ID>" \
  -H "Content-Type: application/json" \
  -d '{"workflowState":"done"}'

# 2. 创建等待任务
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "等待：[人类需要做的事]",
    "tool": "claude",
    "folder": "~/.melodysync/runtime",
    "persistent": {
      "kind": "waiting_task",
      "digest": {
        "title": "等待：[描述]",
        "summary": "[说明为什么需要等待人类]"
      },
      "execution": {
        "mode": "in_place",
        "runPrompt": "[人类触发后 AI 应该做什么]"
      }
    }
  }'

# 3. 挂到项目
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<WAITING_TASK_ID>" \
  -H "Content-Type: application/json" \
  -d '{"taskPoolMembership":{"longTerm":{"role":"member","projectSessionId":"<PROJECT_ID>","bucket":"waiting"}}}'
```

### 普通会话升级为长期项目

```bash
curl -s -X POST "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>/promote-persistent" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "recurring_task",
    "digestTitle": "项目名称",
    "digestSummary": "项目描述",
    "runPrompt": "每次执行时做什么",
    "recurringEnabled": true,
    "recurring": {
      "cadence": "weekly",
      "timeOfDay": "10:00",
      "timezone": "Asia/Shanghai"
    }
  }'
```

### 把收集箱中的任务分配到正确 bucket

```bash
# 分配到短期任务 bucket（同时设置执行时间）
curl -s -X PATCH "$MELODYSYNC_CHAT_BASE_URL/api/sessions/<SESSION_ID>" \
  -H "Content-Type: application/json" \
  -d '{
    "taskPoolMembership": {
      "longTerm": {"role":"member","projectSessionId":"<PROJECT_ID>","bucket":"short_term"}
    },
    "persistent": {
      "kind": "scheduled_task",
      "scheduled": {"runAt": "2026-04-19T09:00:00.000Z", "timezone": "Asia/Shanghai"}
    }
  }'
```

---

## 摄影计划完整闭环示例

```
1. 用户说想拍城市夜景
   → AI 帮制定计划（当前会话 = 长期项目根节点）

2. AI 创建短期任务"本周六执行拍摄清单"
   → scheduled.runAt = 周六 18:20
   → bucket = short_term

3. 周六到点，AI 自动触发短期任务
   → 发送执行提醒，输出当天清单
   → 执行完毕，标记 done

4. AI 判断：还需要人类修图
   → 创建等待任务"等待修图完成"
   → bucket = waiting

5. 用户修图完成，手动触发等待任务
   → AI 执行复审，产出选片清单
   → 标记 done

6. AI 判断：这是个持续项目
   → 升级根会话为 recurring_task（每周复盘）
   → 循环开始
```
