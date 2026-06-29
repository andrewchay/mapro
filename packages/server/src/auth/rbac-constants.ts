/**
 * RBAC 常量
 *
 * 内置权限点与内置角色定义。
 */

/** 内置权限点 */
export const Permissions = {
  // 用户管理
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',

  // Campaign
  CAMPAIGN_CREATE: 'campaign:create',
  CAMPAIGN_READ_OWN: 'campaign:read:own',
  CAMPAIGN_READ_ALL: 'campaign:read:*',
  CAMPAIGN_WRITE_OWN: 'campaign:write:own',
  CAMPAIGN_WRITE_ALL: 'campaign:write:*',
  CAMPAIGN_DELETE_OWN: 'campaign:delete:own',
  CAMPAIGN_DELETE_ALL: 'campaign:delete:*',

  // Agent
  AGENT_EXECUTE: 'agent:execute',
  AGENT_READ_OWN: 'agent:read:own',
  AGENT_READ_ALL: 'agent:read:*',
  AGENT_WRITE_OWN: 'agent:write:own',
  AGENT_WRITE_ALL: 'agent:write:*',

  // 渠道
  CHANNEL_MANAGE: 'channel:manage',

  // 设置
  SETTINGS_MANAGE: 'settings:manage',

  // 附件 / 工作区文件
  ATTACHMENT_MANAGE: 'attachment:manage',
  WORKSPACE_MANAGE: 'workspace:manage',
} as const

/** 权限点值联合类型 */
export type Permission = (typeof Permissions)[keyof typeof Permissions]

/** 内置角色 ID */
export const BuiltInRoles = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const

/** 内置角色配置 */
export interface BuiltInRoleConfig {
  id: string
  name: string
  description: string
  permissions: string[]
}

export const BUILT_IN_ROLES: BuiltInRoleConfig[] = [
  {
    id: BuiltInRoles.SUPER_ADMIN,
    name: '超级管理员',
    description: '拥有所有权限',
    permissions: ['*'],
  },
  {
    id: BuiltInRoles.ADMIN,
    name: '管理员',
    description: '可管理用户与所有资源',
    permissions: [
      Permissions.USER_MANAGE,
      Permissions.CAMPAIGN_CREATE,
      Permissions.CAMPAIGN_READ_ALL,
      Permissions.CAMPAIGN_WRITE_ALL,
      Permissions.CAMPAIGN_DELETE_ALL,
      Permissions.AGENT_EXECUTE,
      Permissions.AGENT_READ_ALL,
      Permissions.AGENT_WRITE_ALL,
      Permissions.CHANNEL_MANAGE,
      Permissions.SETTINGS_MANAGE,
      Permissions.ATTACHMENT_MANAGE,
      Permissions.WORKSPACE_MANAGE,
    ],
  },
  {
    id: BuiltInRoles.MEMBER,
    name: '成员',
    description: '可管理自己的资源并执行 Agent',
    permissions: [
      Permissions.CAMPAIGN_CREATE,
      Permissions.CAMPAIGN_READ_OWN,
      Permissions.CAMPAIGN_WRITE_OWN,
      Permissions.CAMPAIGN_DELETE_OWN,
      Permissions.AGENT_EXECUTE,
      Permissions.AGENT_READ_OWN,
      Permissions.AGENT_WRITE_OWN,
      Permissions.CHANNEL_MANAGE,
      Permissions.SETTINGS_MANAGE,
      Permissions.ATTACHMENT_MANAGE,
      Permissions.WORKSPACE_MANAGE,
    ],
  },
  {
    id: BuiltInRoles.VIEWER,
    name: '只读用户',
    description: '可查看 Campaign 与自己的 Agent 会话',
    permissions: [Permissions.CAMPAIGN_READ_ALL, Permissions.AGENT_READ_OWN],
  },
]

/** 所有非通配权限点描述，用于初始化 permissions 表 */
export const PERMISSION_DEFINITIONS: Array<Omit<PermissionRecord, 'id'>> = [
  { name: Permissions.USER_READ, description: '查看用户信息', resourceType: 'user', scope: 'global' },
  { name: Permissions.USER_MANAGE, description: '管理用户与角色', resourceType: 'user', scope: 'global' },
  { name: Permissions.CAMPAIGN_CREATE, description: '创建 Campaign', resourceType: 'campaign', scope: 'global' },
  { name: Permissions.CAMPAIGN_READ_OWN, description: '读取自己的 Campaign', resourceType: 'campaign', scope: 'own' },
  { name: Permissions.CAMPAIGN_READ_ALL, description: '读取所有 Campaign', resourceType: 'campaign', scope: 'all' },
  { name: Permissions.CAMPAIGN_WRITE_OWN, description: '编辑自己的 Campaign', resourceType: 'campaign', scope: 'own' },
  { name: Permissions.CAMPAIGN_WRITE_ALL, description: '编辑所有 Campaign', resourceType: 'campaign', scope: 'all' },
  { name: Permissions.CAMPAIGN_DELETE_OWN, description: '删除自己的 Campaign', resourceType: 'campaign', scope: 'own' },
  { name: Permissions.CAMPAIGN_DELETE_ALL, description: '删除所有 Campaign', resourceType: 'campaign', scope: 'all' },
  { name: Permissions.AGENT_EXECUTE, description: '执行 Agent 会话', resourceType: 'agent', scope: 'global' },
  { name: Permissions.AGENT_READ_OWN, description: '读取自己的 Agent 会话', resourceType: 'agent', scope: 'own' },
  { name: Permissions.AGENT_READ_ALL, description: '读取所有 Agent 会话', resourceType: 'agent', scope: 'all' },
  { name: Permissions.AGENT_WRITE_OWN, description: '编辑自己的 Agent 会话', resourceType: 'agent', scope: 'own' },
  { name: Permissions.AGENT_WRITE_ALL, description: '编辑所有 Agent 会话', resourceType: 'agent', scope: 'all' },
  { name: Permissions.CHANNEL_MANAGE, description: '管理渠道', resourceType: 'channel', scope: 'global' },
  { name: Permissions.SETTINGS_MANAGE, description: '管理应用设置', resourceType: 'settings', scope: 'global' },
  { name: Permissions.ATTACHMENT_MANAGE, description: '管理附件', resourceType: 'attachment', scope: 'global' },
  { name: Permissions.WORKSPACE_MANAGE, description: '管理工作区文件', resourceType: 'workspace', scope: 'global' },
]

/** 权限记录结构 */
export interface PermissionRecord {
  id: string
  name: string
  description?: string
  resourceType?: string
  scope?: string
}
