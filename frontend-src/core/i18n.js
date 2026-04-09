"use strict";

(function attachMelodySyncI18n(root) {
  const UI_LANGUAGE_STORAGE_KEY = "melodysync.uiLanguage";
  const AUTO_UI_LANGUAGE = "auto";
  const DEFAULT_UI_LANGUAGE = "en";

  const translations = {
    en: {
      "app.chatTitle": "MelodySync",
      "nav.sessions": "Task List",
      "action.fork": "Fork",
      "action.reloadFrontend": "Reload latest frontend",
      "action.close": "Close",
      "action.send": "Send",
      "action.stop": "Stop",
      "action.readOnly": "Read-only",
      "action.queueFollowUp": "Queue follow-up",
      "action.attachFiles": "Attach files",
      "action.removeAttachment": "Remove attachment",
      "action.save": "Save",
      "action.copy": "Copy",
      "action.copied": "Copied",
      "action.copyFailed": "Copy failed",
      "action.organize": "Organize",
      "action.acknowledge": "Acknowledge",
      "action.rename": "Rename",
      "action.settings": "Settings",
      "action.setGroup": "Set Group",
      "action.setManualGroup": "Set Manual Group",
      "action.archive": "Archive",
      "action.restore": "Restore",
      "action.restorePending": "Restore pending",
      "action.pin": "Pin",
      "action.unpin": "Unpin",
      "action.delete": "Delete",
      "action.deleteConfirm": "Write a work summary to today's journal, then permanently delete “{name}” and all related session data?",
      "action.deleteFailed": "Delete failed",
      "status.disconnected": "disconnected",
      "status.reconnecting": "Reconnecting…",
      "status.connected": "connected",
      "status.idle": "idle",
      "status.running": "running",
      "status.archived": "archived",
      "status.frontendUpdateReady": "Frontend update available — tap to reload",
      "status.frontendReloadLatest": "Reload latest frontend",
      "input.placeholder.message": "Message...",
      "input.placeholder.archived": "Archived task — restore to continue",
      "input.placeholder.queueFollowUp": "Queue follow-up...",
      "emptyState.title": "",
      "emptyState.body": "",
      "footer.openSource": "Open source on GitHub ↗",
      "footer.tagline": "Built with AI & ❤️",
      "sidebar.buildLabel": "Build {label}",
      "sidebar.sortList": "Organize Tasks",
      "sidebar.sortList.runAi": "AI Free Grouping",
      "sidebar.sortList.refreshAi": "Refresh AI Groups",
      "sidebar.sortList.runningAi": "Grouping…",
      "sidebar.sortList.doneAi": "Grouped",
      "sidebar.sortList.failedAi": "AI grouping failed",
      "sidebar.sortList.runTemplate": "AI Group into Your Folders",
      "sidebar.sortList.runningTemplate": "AI grouping into your folders…",
      "sidebar.sortList.doneTemplate": "Grouped into your folders",
      "sidebar.sortList.failedTemplate": "Folder-based grouping failed",
      "sidebar.sortList.configureTemplate": "Create a folder first",
      "sidebar.sortList.createFolderFirst": "Create a folder first",
      "sidebar.newSession": "Start Task",
      "sidebar.bootstrapSession": "Initial Task",
      "sidebar.collapse": "Collapse Tasks",
      "sidebar.expand": "Expand Tasks",
      "taskMap.label": "Task Map",
      "taskMap.empty": "",
      "sidebar.grouping.user": "Folders",
      "sidebar.grouping.ai": "AI Free",
      "sidebar.grouping.configure": "Edit Folders",
      "sidebar.grouping.configureEmpty": "Set Up Folders",
      "sidebar.grouping.createFolder": "New Folder",
      "sidebar.grouping.createFolderPlaceholder": "Type folder name",
      "sidebar.grouping.createFolderHint": "Press Enter to save, Esc to cancel.",
      "sidebar.grouping.deleteFolder": "Delete Folder",
      "sidebar.grouping.saveFailed": "Failed to save folders.",
      "sidebar.group.inbox": "Capture",
      "sidebar.group.uncategorized": "Uncategorized",
      "sidebar.group.longTerm": "Long-term",
      "sidebar.group.quickActions": "AI Quick Actions",
      "sidebar.group.shortTerm": "Short-term",
      "sidebar.group.knowledgeBase": "Knowledge Base",
      "sidebar.group.waiting": "Waiting",
      "sidebar.pinned": "Pinned",
      "sidebar.archive": "Archived",
      "sidebar.loadingArchived": "Loading archived tasks…",
      "sidebar.loadArchived": "Load archived tasks…",
      "sidebar.noArchived": "No archived tasks",
      "sidebar.noSessions": "No tasks yet",
      "sidebar.currentBranch": "Current branch: {name}",
      "sidebar.moreBranches": "{count} more branches",
      "sidebar.branchCount": "{count} branch tasks",
      "sidebar.branch": "Branch: {name}",
      "sidebar.branchTag": "Branch Task",
      "sidebar.branchVisibility.show": "Show Branches",
      "sidebar.branchVisibility.hide": "Hide Branches",
      "prompt.grouping.template": "Define the group types and order with commas or new lines. In User Template mode, AI will group sessions using this order first; unmatched tasks go to Uncategorized.",
      "settings.language.title": "Language",
      "settings.language.note": "Auto follows the current browser language. You can override it here for debugging.",
      "settings.language.ownerAriaLabel": "Choose interface language",
      "settings.language.optionAuto": "Auto (follow browser)",
      "settings.language.optionZhCN": "简体中文",
      "settings.language.optionEn": "English",
      "settings.language.ownerStatusAuto": "Auto is active. This browser follows its current language.",
      "settings.language.ownerStatusOverride": "Language override saved for this browser. The interface reloads immediately after changes.",
      "modal.addAgentsTitle": "Add more agents",
      "modal.addAgentsLead": "MelodySync is not limited to the builtin agents. For simple tools, save a lightweight config here and the picker refreshes immediately. If you need custom parsing or runtime behavior, use the advanced path below.",
      "modal.quickAddTitle": "Quick add",
      "modal.saveRefresh": "Save & refresh",
      "modal.quickAddBody": "Use this for wrappers or simple command-based agents that speak an existing runtime family and accept that family's core prompt/model/thinking flags. We save the config for you and refresh the picker without restarting the service.",
      "modal.name": "Name",
      "modal.command": "Command",
      "modal.runtimeFamily": "Runtime family",
      "modal.runtimeFamily.claude": "Claude-style stream JSON",
      "modal.runtimeFamily.codex": "Codex JSON",
      "modal.models": "Models",
      "modal.modelsPlaceholder": "One model per line. Use `model-id | Label` or just `model-id`.\nExample:\ngpt-5-codex | GPT-5 Codex\ngpt-5-mini",
      "modal.thinkingMode": "Thinking mode",
      "modal.thinking.toggle": "Toggle",
      "modal.thinking.levels": "Levels",
      "modal.thinking.none": "None",
      "modal.thinkingLevels": "Thinking levels",
      "modal.internalIdentity": "Internal identity",
      "modal.internalIdentityNote": "Derived automatically from the command. No separate ID field in simple mode.",
      "modal.thinkingModeNote": "Use `none` if the tool has no model-side thinking control. For Claude-family tools, use `toggle`; for Codex-family tools, use `levels`. If the command needs different CLI flags, use the advanced path below.",
      "modal.advancedTitle": "Advanced provider code",
      "modal.copyBasePrompt": "Copy base prompt",
      "modal.advancedBullet1": "It asks the agent to decide whether simple config is enough or whether full provider code is needed.",
      "modal.advancedBullet2": "It points the agent at the provider architecture notes and keeps the changes minimal.",
      "modal.close": "Close",
      "login.tagline": "Sign in to continue",
      "login.error": "Invalid credentials. Please try again.",
      "login.username": "Username",
      "login.usernamePlaceholder": "Enter username",
      "login.password": "Password",
      "login.passwordPlaceholder": "Enter password",
      "login.signIn": "Sign In",
      "login.accessToken": "Access Token",
      "login.tokenPlaceholder": "Paste your token",
      "login.switch.useToken": "Use access token instead",
      "login.switch.usePassword": "Use username & password",
      "queue.timestamp.default": "Queued",
      "queue.timestamp.withTime": "Queued {time}",
      "queue.single": "1 follow-up queued",
      "queue.multiple": "{count} follow-ups queued",
      "queue.note.afterRun": "Will send automatically after the current run",
      "queue.note.preparing": "Preparing the next turn",
      "queue.attachmentOnly": "(attachment)",
      "queue.attachments": "Attachments: {names}",
      "queue.olderHidden.one": "1 older queued follow-up hidden",
      "queue.olderHidden.multiple": "{count} older queued follow-ups hidden",
      "session.defaultName": "Task",
      "session.messages": "{count} msg{suffix}",
      "session.messagesTitle": "Messages in this task",
      "session.scope.source": "Task source",
      "session.scope.app": "Task app",
      "session.scope.appLabel": "App: {name}",
      "session.scope.owner": "Owner",
      "session.scope.ownerTitle": "Task owner scope",
      "thinking.active": "Thinking…",
      "thinking.done": "Thought",
      "thinking.usedTools": "Thought · used {tools}",
      "copy.code": "Copy code",
      "ui.managerContext": "Manager context",
      "ui.toolFallback": "tool",
      "ui.toolResult": "Result",
      "ui.toolExitCode": "exit {code}",
      "ui.fileChange.add": "add",
      "ui.fileChange.edit": "edit",
      "ui.fileChange.update": "update",
      "ui.fileChange.updated": "updated",
      "ui.fileChange.delete": "delete",
      "context.barrier": "Older messages above this marker are no longer in live context.",
      "context.liveShort": "{tokens} live · {percent}",
      "context.liveOnly": "{tokens} live",
      "context.liveTitle": "Live context: {context}",
      "context.liveTitleWithWindow": "Live context: {context} / {window} ({percent})",
      "context.usage.live": "{tokens} live context",
      "context.usage.window": "{percent} window",
      "context.usage.output": "{tokens} out",
      "context.hover.window": "Context window: {window}",
      "context.hover.rawInput": "Raw turn input: {tokens}",
      "context.hover.output": "Turn output: {tokens}",
      "compose.pending.uploading": "Uploading attachment…",
      "compose.pending.sendingAttachment": "Sending attachment…",
      "compose.pending.sending": "Sending…",
      "tooling.thinking": "Thinking",
      "tooling.defaultModel": "default",
      "gestures.sessions": "Task List",
      "gestures.newSession": "New Task",
      "workflow.priority.high": "High",
      "workflow.priority.highTitle": "Needs user attention soon.",
      "workflow.priority.medium": "Medium",
      "workflow.priority.mediumTitle": "Worth checking soon, but not urgent.",
      "workflow.priority.low": "Low",
      "workflow.priority.lowTitle": "Safe to leave for later.",
      "workflow.status.waiting": "waiting",
      "workflow.status.waitingTitle": "Waiting on user input",
      "workflow.status.done": "completed",
      "workflow.status.doneTitle": "Current task completed",
      "workflow.status.parked": "parked",
      "workflow.status.parkedTitle": "Parked for later",
      "workflow.status.queued": "queued",
      "workflow.status.queuedTitle": "{count} follow-up{suffix} queued",
      "workflow.status.compacting": "compacting",
      "workflow.status.renaming": "renaming",
      "workflow.status.renameFailed": "rename failed",
      "workflow.status.renameFailedTitle": "Task rename failed",
      "workflow.status.unread": "new",
      "workflow.status.unreadTitle": "Updated since you last reviewed this task",
      "workflow.status.finished": "completed",
      "workflow.status.finishedTitle": "This task completed since your last view",
      "persistent.kind.recurringTask": "recurring",
      "persistent.kind.recurringTaskTitle": "Recurring task",
      "persistent.kind.recurringPaused": "recurring paused",
      "persistent.kind.recurringPausedTitle": "Recurring task paused",
      "persistent.kind.skill": "AI quick action",
      "persistent.kind.skillTitle": "Reusable AI quick action",
      "persistent.sectionTitle": "Long-lived",
    },
    "zh-CN": {
      "app.chatTitle": "MelodySync",
      "nav.sessions": "任务列表",
      "action.fork": "分叉",
      "action.reloadFrontend": "刷新到最新前端",
      "action.close": "关闭",
      "action.send": "发送",
      "action.stop": "停止",
      "action.readOnly": "只读",
      "action.queueFollowUp": "排队追问",
      "action.attachFiles": "添加文件",
      "action.removeAttachment": "移除附件",
      "action.save": "保存",
      "action.copy": "复制",
      "action.copied": "已复制",
      "action.copyFailed": "复制失败",
      "action.organize": "整理任务",
      "action.acknowledge": "已收到",
      "action.rename": "重命名",
      "action.settings": "设置",
      "action.setGroup": "设置分组",
      "action.setManualGroup": "设置手动分组",
      "action.archive": "归档",
      "action.restore": "恢复",
      "action.restorePending": "恢复待处理",
      "action.pin": "置顶",
      "action.unpin": "取消置顶",
      "action.delete": "删除",
      "action.deleteConfirm": "会先把“{name}”写入今日日记摘要，再永久删除该任务及全部相关会话数据。确定继续吗？",
      "action.deleteFailed": "删除失败",
      "status.disconnected": "未连接",
      "status.reconnecting": "重连中…",
      "status.connected": "已连接",
      "status.idle": "空闲",
      "status.running": "运行中",
      "status.archived": "已归档",
      "status.frontendUpdateReady": "有新前端版本，点这里刷新",
      "status.frontendReloadLatest": "刷新到最新前端",
      "input.placeholder.message": "输入消息...",
      "input.placeholder.archived": "当前任务已归档，恢复后才能继续",
      "input.placeholder.queueFollowUp": "排队一条后续消息...",
      "emptyState.title": "",
      "emptyState.body": "",
      "footer.openSource": "GitHub 开源项目 ↗",
      "footer.tagline": "Built with AI & ❤️",
      "sidebar.buildLabel": "构建 {label}",
      "sidebar.sortList": "整理任务",
      "sidebar.sortList.runAi": "AI 自由分组",
      "sidebar.sortList.refreshAi": "重新 AI 分组",
      "sidebar.sortList.runningAi": "AI 分组中…",
      "sidebar.sortList.doneAi": "已按 AI 分组",
      "sidebar.sortList.failedAi": "AI 分组失败",
      "sidebar.sortList.runTemplate": "AI 按你的文件夹整理",
      "sidebar.sortList.runningTemplate": "AI 按你的文件夹整理中…",
      "sidebar.sortList.doneTemplate": "已按你的文件夹整理",
      "sidebar.sortList.failedTemplate": "文件夹整理失败",
      "sidebar.sortList.configureTemplate": "先新建文件夹",
      "sidebar.sortList.createFolderFirst": "先新建文件夹",
      "sidebar.newSession": "开始任务",
      "sidebar.bootstrapSession": "初始化任务",
      "sidebar.collapse": "收起任务栏",
      "sidebar.expand": "展开任务栏",
      "taskMap.label": "任务地图",
      "taskMap.empty": "",
      "sidebar.grouping.user": "用户文件夹",
      "sidebar.grouping.ai": "AI 自由",
      "sidebar.grouping.configure": "编辑文件夹",
      "sidebar.grouping.configureEmpty": "设置文件夹",
      "sidebar.grouping.createFolder": "新建文件夹",
      "sidebar.grouping.createFolderPlaceholder": "输入文件夹名称",
      "sidebar.grouping.createFolderHint": "Enter 保存，Esc 取消",
      "sidebar.grouping.deleteFolder": "删除文件夹",
      "sidebar.grouping.saveFailed": "文件夹保存失败。",
      "sidebar.group.inbox": "收集箱",
      "sidebar.group.uncategorized": "未分类",
      "sidebar.group.longTerm": "长期任务",
      "sidebar.group.quickActions": "AI快捷按钮",
      "sidebar.group.shortTerm": "短期任务",
      "sidebar.group.knowledgeBase": "知识库内容",
      "sidebar.group.waiting": "等待任务",
      "sidebar.pinned": "置顶",
      "sidebar.archive": "归档",
      "sidebar.loadingArchived": "正在加载归档任务…",
      "sidebar.loadArchived": "加载归档任务…",
      "sidebar.noArchived": "还没有归档任务",
      "sidebar.noSessions": "还没有任务",
      "sidebar.currentBranch": "当前支线：{name}",
      "sidebar.moreBranches": "另有 {count} 条支线",
      "sidebar.branchCount": "{count} 条支线任务",
      "sidebar.branch": "支线：{name}",
      "sidebar.branchTag": "支线任务",
      "sidebar.branchVisibility.show": "显示支线",
      "sidebar.branchVisibility.hide": "隐藏支线",
      "prompt.grouping.template": "定义分组类型和顺序，使用逗号或换行分隔。AI 在“用户模板”模式下会优先按这里的分组类型和顺序整理；未命中的任务会进入“未分类”。",
      "settings.language.title": "语言",
      "settings.language.note": "默认会跟随当前浏览器语言。你也可以在这里为当前浏览器强制切换，方便调试；而专属访客链接仍可保留自己的语言偏好。",
      "settings.language.ownerAriaLabel": "选择界面语言",
      "settings.language.optionAuto": "自动（跟随浏览器）",
      "settings.language.optionZhCN": "简体中文",
      "settings.language.optionEn": "English",
      "settings.language.ownerStatusAuto": "当前为自动模式。这个浏览器会跟随自己的语言。",
      "settings.language.ownerStatusOverride": "已为当前浏览器保存语言覆盖。切换后界面会立即刷新。",
      "modal.addAgentsTitle": "添加更多 Agent",
      "modal.addAgentsLead": "MelodySync 不只支持内置 agent。对于简单工具，你可以直接在这里保存轻量配置，选择器会立即刷新。如果需要自定义解析或运行时行为，再走下面的高级路径。",
      "modal.quickAddTitle": "快速添加",
      "modal.saveRefresh": "保存并刷新",
      "modal.quickAddBody": "适合 wrapper 或简单命令式 agent：它们使用现有 runtime family，并接受该 family 的核心 prompt / model / thinking 参数。我们会帮你保存配置，并在不重启服务的前提下刷新选择器。",
      "modal.name": "名称",
      "modal.command": "命令",
      "modal.runtimeFamily": "运行时家族",
      "modal.runtimeFamily.claude": "Claude 风格 stream JSON",
      "modal.runtimeFamily.codex": "Codex JSON",
      "modal.models": "模型",
      "modal.modelsPlaceholder": "每行一个模型。可写成 `model-id | Label`，也可只写 `model-id`。\n例如：\ngpt-5-codex | GPT-5 Codex\ngpt-5-mini",
      "modal.thinkingMode": "思考模式",
      "modal.thinking.toggle": "开关",
      "modal.thinking.levels": "等级",
      "modal.thinking.none": "无",
      "modal.thinkingLevels": "思考等级",
      "modal.internalIdentity": "内部标识",
      "modal.internalIdentityNote": "会根据命令自动推导。简单模式下不需要额外填写 ID。",
      "modal.thinkingModeNote": "如果工具没有模型侧思考控制，请用 `none`。Claude 家族通常用 `toggle`，Codex 家族通常用 `levels`。如果命令行参数有特殊需求，请走下面的高级路径。",
      "modal.advancedTitle": "高级 provider 代码",
      "modal.copyBasePrompt": "复制基础提示词",
      "modal.advancedBullet1": "它会让 agent 判断：简单配置是否足够，还是需要完整 provider 代码。",
      "modal.advancedBullet2": "它会把 agent 指到 provider 架构说明，同时尽量保持改动最小。",
      "modal.close": "关闭",
      "login.tagline": "登录后继续",
      "login.error": "凭证无效，请重试。",
      "login.username": "用户名",
      "login.usernamePlaceholder": "输入用户名",
      "login.password": "密码",
      "login.passwordPlaceholder": "输入密码",
      "login.signIn": "登录",
      "login.accessToken": "访问令牌",
      "login.tokenPlaceholder": "粘贴你的令牌",
      "login.switch.useToken": "改用访问令牌",
      "login.switch.usePassword": "改用用户名和密码",
      "queue.timestamp.default": "已排队",
      "queue.timestamp.withTime": "已排队 {time}",
      "queue.single": "已排队 1 条后续消息",
      "queue.multiple": "已排队 {count} 条后续消息",
      "queue.note.afterRun": "会在当前运行结束后自动发送",
      "queue.note.preparing": "正在准备下一轮",
      "queue.attachmentOnly": "（附件）",
      "queue.attachments": "附件：{names}",
      "queue.olderHidden.one": "还有 1 条更早的排队后续消息被折叠",
      "queue.olderHidden.multiple": "还有 {count} 条更早的排队后续消息被折叠",
      "session.defaultName": "任务",
      "session.messages": "{count} 条消息",
      "session.messagesTitle": "这个任务中的消息数",
      "session.scope.source": "任务来源",
      "session.scope.app": "任务应用",
      "session.scope.appLabel": "应用：{name}",
      "session.scope.owner": "Owner",
      "session.scope.ownerTitle": "任务归属范围",
      "thinking.active": "思考中…",
      "thinking.done": "思路",
      "thinking.usedTools": "思路 · 使用了 {tools}",
      "copy.code": "复制代码",
      "ui.managerContext": "管理器上下文",
      "ui.toolFallback": "工具",
      "ui.toolResult": "结果",
      "ui.toolExitCode": "退出 {code}",
      "ui.fileChange.add": "新增",
      "ui.fileChange.edit": "编辑",
      "ui.fileChange.update": "更新",
      "ui.fileChange.updated": "已更新",
      "ui.fileChange.delete": "删除",
      "context.barrier": "这条标记之前的消息，已经不在当前实时上下文里了。",
      "context.liveShort": "{tokens} 活跃上下文 · {percent}",
      "context.liveOnly": "{tokens} 活跃上下文",
      "context.liveTitle": "活跃上下文：{context}",
      "context.liveTitleWithWindow": "活跃上下文：{context} / {window}（{percent}）",
      "context.usage.live": "{tokens} 活跃上下文",
      "context.usage.window": "窗口 {percent}",
      "context.usage.output": "输出 {tokens}",
      "context.hover.window": "上下文窗口：{window}",
      "context.hover.rawInput": "本轮原始输入：{tokens}",
      "context.hover.output": "本轮输出：{tokens}",
      "compose.pending.uploading": "正在上传附件…",
      "compose.pending.sendingAttachment": "正在发送附件…",
      "compose.pending.sending": "发送中…",
      "tooling.thinking": "思考",
      "tooling.defaultModel": "默认",
      "gestures.sessions": "任务列表",
      "gestures.newSession": "开启任务",
      "workflow.priority.high": "高",
      "workflow.priority.highTitle": "需要尽快让用户关注。",
      "workflow.priority.medium": "中",
      "workflow.priority.mediumTitle": "值得尽快看，但不算紧急。",
      "workflow.priority.low": "低",
      "workflow.priority.lowTitle": "可以放心留到后面处理。",
      "workflow.status.waiting": "等待中",
      "workflow.status.waitingTitle": "等待用户输入",
      "workflow.status.done": "已完成",
      "workflow.status.doneTitle": "当前任务已完成",
      "workflow.status.parked": "搁置",
      "workflow.status.parkedTitle": "先停放到后面处理",
      "workflow.status.queued": "排队中",
      "workflow.status.queuedTitle": "已排队 {count} 条后续消息",
      "workflow.status.compacting": "压缩中",
      "workflow.status.renaming": "重命名中",
      "workflow.status.renameFailed": "重命名失败",
      "workflow.status.renameFailedTitle": "任务重命名失败",
      "workflow.status.unread": "新变化",
      "workflow.status.unreadTitle": "自上次查看后，这个任务有更新",
      "workflow.status.finished": "已完成",
      "workflow.status.finishedTitle": "这个任务已完成，查看后会恢复普通状态",
      "persistent.kind.recurringTask": "长期任务",
      "persistent.kind.recurringTaskTitle": "会按设定时间执行的长期任务",
      "persistent.kind.recurringPaused": "长期任务已暂停",
      "persistent.kind.recurringPausedTitle": "长期任务当前已暂停自动执行",
      "persistent.kind.skill": "AI快捷按钮",
      "persistent.kind.skillTitle": "可一键触发并由 AI 执行的快捷按钮",
      "persistent.sectionTitle": "长期项",
    },
  };

  function normalizeUiLanguagePreference(value, { allowAuto = true } = {}) {
    if (typeof value !== "string") return allowAuto ? AUTO_UI_LANGUAGE : DEFAULT_UI_LANGUAGE;
    const normalized = value.trim();
    if (!normalized) return allowAuto ? AUTO_UI_LANGUAGE : DEFAULT_UI_LANGUAGE;
    if (normalized === AUTO_UI_LANGUAGE) return allowAuto ? AUTO_UI_LANGUAGE : DEFAULT_UI_LANGUAGE;
    if (/^zh(?:[-_](?:cn|hans))?$/i.test(normalized)) return "zh-CN";
    if (/^en(?:[-_].*)?$/i.test(normalized)) return "en";
    return allowAuto ? AUTO_UI_LANGUAGE : DEFAULT_UI_LANGUAGE;
  }

  function resolveBrowserUiLanguage() {
    const candidates = [];
    if (Array.isArray(root.navigator?.languages)) candidates.push(...root.navigator.languages);
    if (typeof root.navigator?.language === "string") candidates.push(root.navigator.language);
    for (const candidate of candidates) {
      const normalized = normalizeUiLanguagePreference(candidate, { allowAuto: false });
      if (normalized) return normalized;
    }
    return DEFAULT_UI_LANGUAGE;
  }

  function readStoredUiLanguagePreference() {
    try {
      return normalizeUiLanguagePreference(root.localStorage?.getItem(UI_LANGUAGE_STORAGE_KEY), { allowAuto: true });
    } catch {
      return AUTO_UI_LANGUAGE;
    }
  }

  function getBootstrapPreferredLanguage() {
    const auth = root.MelodySyncBootstrap?.getBootstrap?.()?.auth;
    return normalizeUiLanguagePreference(auth?.preferredLanguage, { allowAuto: true });
  }

  function resolveActiveUiLanguage(preference = readStoredUiLanguagePreference()) {
    const normalizedPreference = normalizeUiLanguagePreference(preference, { allowAuto: true });
    if (normalizedPreference && normalizedPreference !== AUTO_UI_LANGUAGE) {
      return normalizeUiLanguagePreference(normalizedPreference, { allowAuto: false });
    }
    const bootstrapPreferredLanguage = getBootstrapPreferredLanguage();
    if (bootstrapPreferredLanguage && bootstrapPreferredLanguage !== AUTO_UI_LANGUAGE) {
      return normalizeUiLanguagePreference(bootstrapPreferredLanguage, { allowAuto: false });
    }
    return resolveBrowserUiLanguage();
  }

  function formatTemplate(template, vars = {}) {
    return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(vars, key)
        ? String(vars[key] ?? "")
        : match
    ));
  }

  let uiLanguagePreference = readStoredUiLanguagePreference();
  let activeUiLanguage = resolveActiveUiLanguage(uiLanguagePreference);

  function t(key, vars = {}) {
    const localeTable = translations[activeUiLanguage] || translations.en;
    const template = localeTable[key] ?? translations.en[key];
    if (template === undefined) return key;
    return formatTemplate(template, vars);
  }

  function applyBuildLabelTranslations(doc = root.document) {
    if (!doc?.querySelectorAll) return;
    doc.querySelectorAll("[data-i18n-build-label]").forEach((node) => {
      node.textContent = t("sidebar.buildLabel", {
        label: node.getAttribute("data-i18n-build-label") || "",
      });
    });
  }

  function applyTranslations(doc = root.document) {
    if (!doc) return;
    if (doc.documentElement) {
      doc.documentElement.lang = activeUiLanguage;
    }
    if (doc.querySelectorAll) {
      doc.querySelectorAll("[data-i18n]").forEach((node) => {
        node.textContent = t(node.getAttribute("data-i18n"));
      });
      doc.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
        node.setAttribute("placeholder", t(node.getAttribute("data-i18n-placeholder")));
      });
      doc.querySelectorAll("[data-i18n-title]").forEach((node) => {
        node.setAttribute("title", t(node.getAttribute("data-i18n-title")));
      });
      doc.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
        node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria-label")));
      });
      doc.querySelectorAll("[data-i18n-value]").forEach((node) => {
        node.value = t(node.getAttribute("data-i18n-value"));
      });
      applyBuildLabelTranslations(doc);
    }
  }

  function writeStoredUiLanguagePreference(value) {
    try {
      const normalized = normalizeUiLanguagePreference(value, { allowAuto: true });
      if (normalized === AUTO_UI_LANGUAGE) {
        root.localStorage?.removeItem(UI_LANGUAGE_STORAGE_KEY);
      } else {
        root.localStorage?.setItem(UI_LANGUAGE_STORAGE_KEY, normalized);
      }
    } catch {}
  }

  function setUiLanguagePreference(value, { reload = false } = {}) {
    uiLanguagePreference = normalizeUiLanguagePreference(value, { allowAuto: true });
    writeStoredUiLanguagePreference(uiLanguagePreference);
    activeUiLanguage = resolveActiveUiLanguage(uiLanguagePreference);
    applyTranslations(root.document);
    try {
      root.dispatchEvent(new CustomEvent("melodysync:localechange", {
        detail: {
          preference: uiLanguagePreference,
          active: activeUiLanguage,
        },
      }));
    } catch {}
    if (reload) {
      root.location?.reload();
    }
    return {
      preference: uiLanguagePreference,
      active: activeUiLanguage,
    };
  }

  function getUiLanguageOptions() {
    return [
      { value: AUTO_UI_LANGUAGE, label: t("settings.language.optionAuto") },
      { value: "zh-CN", label: t("settings.language.optionZhCN") },
      { value: "en", label: t("settings.language.optionEn") },
    ];
  }

  root.melodySyncT = t;
  root.melodySyncApplyTranslations = applyTranslations;
  root.melodySyncGetUiLanguagePreference = function getUiLanguagePreference() {
    return uiLanguagePreference;
  };
  root.melodySyncGetActiveUiLanguage = function getActiveUiLanguage() {
    return activeUiLanguage;
  };
  root.melodySyncSetUiLanguagePreference = setUiLanguagePreference;
  root.melodySyncGetUiLanguageOptions = getUiLanguageOptions;
  root.MelodySyncI18n = {
    t,
    applyTranslations,
    getUiLanguagePreference: root.melodySyncGetUiLanguagePreference,
    getActiveUiLanguage: root.melodySyncGetActiveUiLanguage,
    setUiLanguagePreference,
    getUiLanguageOptions,
    normalizeUiLanguagePreference,
    resolveActiveUiLanguage,
  };

  if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", () => applyTranslations(root.document), { once: true });
  } else {
    applyTranslations(root.document);
  }
})(window);
