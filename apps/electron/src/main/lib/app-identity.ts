/**
 * MAPro 运行时身份。
 *
 * 这些值决定系统层面的应用名、进程名与 DeepLink 协议，
 * 需要与 electron-builder.yml 的 productName 保持一致（影响 TCC 授权身份）。
 * 配置目录约定见 config-paths.ts（~/.mapro/）。
 */
export const APP_DISPLAY_NAME = 'MAPro'
export const APP_PROCESS_NAME = 'MAPro'
export const APP_DEV_USER_DATA_DIR_NAME = '@ma-proma/electron-dev'
export const APP_DEEP_LINK_PROTOCOL = 'mapro'
