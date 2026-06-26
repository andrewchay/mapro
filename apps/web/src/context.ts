/**
 * Web 服务端 AppContext 实现
 *
 * 阶段 A 单用户部署：
 * - 数据目录通过 MAPRO_DATA_DIR 环境变量注入，默认当前工作目录下的 .mapro/
 * - 资源目录默认当前工作目录
 */

import { join } from 'node:path'
import { cwd } from 'node:process'
import type { AppContext } from '@ma-proma/server'

export function createWebAppContext(): AppContext {
  const dataDir = process.env.MAPRO_DATA_DIR ?? join(cwd(), '.mapro')
  const resourcesPath = process.env.MAPRO_RESOURCES_PATH ?? cwd()

  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => resourcesPath,
    isPackaged: () => process.env.NODE_ENV === 'production',
  }
}
