const SETTINGS_SECTION_DEFINITIONS = Object.freeze([
  {
    id: 'general',
    label: '通用',
    description: '管理应用路径和当前设备如何加载本地数据目录。',
    routeBase: '/api/settings',
  },
  {
    id: 'email',
    label: 'Email',
    description: '管理邮箱身份、发送方式和自动化处理规则。',
    routeBase: '/api/settings/email',
  },
  {
    id: 'voice',
    label: 'Voice',
    description: '管理本地语音入口如何接入普通会话。',
    routeBase: '/api/settings/voice',
  },
  {
    id: 'hooks',
    label: 'Hooks',
    description: '管理生命周期 Hook 的启停状态和脚本设计文件。',
    routeBase: '/api/settings/hooks',
  },
  {
    id: 'nodes',
    label: '节点',
    description: '管理任务地图的自定义节点类型和图谱扩展能力。',
    routeBase: '/api/settings/nodes',
  },
]);

export function listSettingsSectionDefinitions() {
  return SETTINGS_SECTION_DEFINITIONS.map((definition) => ({ ...definition }));
}

