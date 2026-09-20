# Agent Notes

## 项目与架构

Anime Log 是 Windows 本地追番桌面应用，仅维护桌面端。技术栈为 Electron、Vue 3、Vite、sql.js/SQLite。不要重新引入 Java、Spring Boot、Maven 或本地 HTTP 后端，也不提供独立浏览器模式。

`frontend/electron/main.cjs` 通过 Electron 自定义协议 `anime-log://local/api` 提供本地 API，不监听 HTTP 端口。主进程负责数据、抓取、同步和系统通知；界面通过 `frontend/src/api.js` 调用本地服务。preload 只暴露受限接口，IPC 必须校验发送者。

数据来源：yuc.wiki 提供季度新番；AniList 提供放送排期；本地中文名称索引合并 anilist-chinese 与 bangumi-data 中明确的 AniList ID 映射。不要按模糊标题自动绑定，也不要将不同站点的 ID 混用。

## 目录结构

- `frontend/electron/main.cjs`：应用生命周期、自定义协议、通知与 IPC。
- `frontend/electron/local-service.cjs`：追番、笔记、季度缓存、图片和放送接口。
- `frontend/electron/database.cjs`：sql.js、SQLite 升级、备份、原子保存与失败回滚。
- `frontend/electron/yuc-parser.cjs`：星期总表及番剧介绍列表解析；保留历史 Java hashCode 算法生成来源 ID，运行时不依赖 Java。
- `frontend/electron/anilist-client.cjs`、`anime-names.cjs`、`broadcast-*.cjs`：远程查询、中文名称和放送同步。
- `frontend/electron/desktop-windows.cjs`：便签、悬浮球、托盘与窗口设置。
- `frontend/src/App.vue`：完整界面，包括新番、追番和笔记。
- `frontend/src/DesktopShell.vue`、`StickyNote.vue`、`StickyAnimeCard.vue`：完整界面与便签切换。
- `frontend/src/api.js`：所有前端数据接口。
- `frontend/tests/local-service.test.cjs`：解析、SQLite 兼容、持久化和失败处理。
- `frontend/tests/e2e/`：Electron 端到端流程。
- `frontend/tests/fixtures/`：独立的固定测试页面和辅助程序。
- `frontend/node_modules/`、`dist/`、`release/`：依赖和生成物，不作为源码提交。

## 开发与验证

在 `frontend` 目录执行：

```powershell
npm.cmd install
npm.cmd run electron:dev
```

Vite 仅用于 Electron 开发窗口热更新。不要让用户单独启动浏览器后端。直接在普通浏览器打开开发页面时只显示桌面入口提示。

修改后至少运行前端构建；桌面功能和数据服务修改运行完整测试：

```powershell
npm.cmd run build
npm.cmd run test:e2e
```

打包与打包验证：

```powershell
npm.cmd run electron:build
npm.cmd run test:packaged
```

文档或纯样式改动可以不跑全量测试，但应说明原因。功能测试使用临时数据库、固定时钟和模拟网络，不依赖外网；真实网络核验应与自动化测试分开。不得用测试读取或写入个人数据库。涉及系统通知时，模拟测试不能代替 Windows 实测。

## 数据与兼容

- 追番、笔记和设置存放于 Electron 用户数据目录。
- `anime_sources` 保存季度来源；`watch_records`、`anime_notes` 引用稳定的本地番剧 ID。
- `season_refreshes` 保存刷新时间及 `parser_version`；解析器改变时提升版本，使旧缓存重新解析。
- `broadcast_bindings`、`broadcast_episodes`、`broadcast_alerts` 独立保存放送关联、缓存与去重状态。
- `anime_name_catalog` 保存名称库快照；`anime_link_preferences` 保存自动关联偏好。
- 迁移使用增量表/列变更，重复启动必须安全。修改数据服务要覆盖旧 SQLite 兼容、保存失败回滚和重启恢复。
- 网络请求在事务外完成；获取完整结果后再原子写入，失败保留最近成功缓存。
- yuc 页面结构变化不能孤立追番和笔记；保留来源 ID 算法，对旧错误来源链接的修复应保留本地 ID。
- 放送进度标为“预计”，不覆盖已看集数，不因排期缺失推断完结。
- 旧数据库可以通过 `ANIME_LOG_MIGRATION_DB` 显式导入，仅在目标数据库不存在时使用；不再自动读取旧工程路径。
- `ANIME_LOG_USER_DATA_DIR` 可指定独立测试数据目录。
- 旧 `backend/data/` 中可能有个人历史数据库，移除旧工程不代表可以删除这些数据。

## API 与界面约定

- 前端新增接口放在 `frontend/src/api.js`；本地路由放在 `local-service.cjs`。
- 现有接口包括季度、新番刷新、追番 CRUD、总评/分集笔记、图片代理、中文名称搜索、AniList 条目与放送关联/同步。
- 保持中文 UTF-8 编码；PowerShell 显示乱码不一定代表源码损坏。
- 富文本保存前继续使用 `sanitizeRichText` 清洗。
- 保持现有 UI，可以按功能逐步拆组件，不顺手重写整个应用。
- 新番页已追番封面和便签封面打开对应详情；追番列表封面保留大图预览。
- 外网失败显示明确状态，不能静默返回空白或虚构零集。
- SQL 使用参数化查询，不拼接用户输入。
- 不提交运行时数据库、个人配置、打包产物或依赖目录。
- 每次修改代码后，都需要提交一次 Git commit。

## 环境

仓库路径为 `D:\Vibe Coding\anime-log`。Git 若遇到 dubious ownership，不自动修改全局配置；需要提交时再确认 safe.directory。保留现有 SQLite 数据、用户设置和未提交修改。
