/**
 * KOL 数据服务默认 mock
 *
 * 用于切断到 electron / SQLite 的依赖链，同时保留完整导出签名，
 * 避免 mock 泄漏导致后续测试文件导入 campaign-manager 等模块时报
 * "Export named 'xxx' not found"。
 */

export interface KolDataServiceMockOverrides {
  closeKolDatabase?: () => void
  upsertKOL?: (kol: unknown) => unknown
  getKOLById?: (id: string) => unknown
  searchKOLs?: (filters: unknown) => unknown
  getPlatforms?: () => string[]
  getCategories?: () => string[]
  deleteKOL?: (id: string) => boolean
  clearAllKOLs?: () => void
  getKOLStats?: () => { total: number; byPlatform: Record<string, number>; bySource: Record<string, number> }
  seedMockKOLs?: () => { inserted: number }
  searchJustOne?: (query: unknown) => Promise<unknown>
  searchNewrank?: (query: unknown) => Promise<unknown>
  collectFromSource?: (source: unknown) => Promise<unknown>
  collectAllSources?: (input: unknown) => Promise<unknown>
  computeKOLScores?: () => void
  recalculateAllScores?: () => { updated: number }
  getTopKOLs?: (limit?: number) => unknown[]
}

export function createKolDataServiceMock(overrides: KolDataServiceMockOverrides = {}) {
  // 通过带 query 的 require 加载真实模块的副本，再覆盖需要 mock 的函数。
  // 这样既能拦截特定调用（如 upsertKOL），又能把 searchKOLs/seedMockKOLs/getKOLById
  // 等委托给真实实现，避免 mock.module 的局部导出污染后续 Campaign 测试。
  const realModule = require('../../ma-tools/kol-data-service.ts?__kol_mock_real=1')
  return {
    ...realModule,
    ...overrides,
  }
}
