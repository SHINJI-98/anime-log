# Agent Notes

## 项目概览

### 桌面版架构更新

桌面版已移除 Java/Spring Boot 运行依赖。`frontend/electron/main.cjs` 通过 Electron 自定义协议 `anime-log://local/api` 提供同名 API，不监听 HTTP 端口。`local-service.cjs` 处理追番、笔记、抓取和图片；`database.cjs` 使用 sql.js 读写兼容旧版的 SQLite，保存时原子替换并备份已有数据库；`yuc-parser.cjs` 保留 Java hashCode 来源 ID。下面的 Spring Boot 说明仅适用于保留的浏览器模式。

桌面开发运行 `cd frontend; npm.cmd run electron:dev`，无需 Maven。桌面修改运行 `npm.cmd run test:e2e`（包含构建、本地服务和 Electron 流程测试）；打包运行 `npm.cmd run electron:build`，之后可运行 `npm.cmd run test:packaged`。修改抓取解析应补充 `frontend/tests/local-service.test.cjs`，修改数据服务应覆盖 SQLite 兼容、持久化和失败处理。桌面端不要重新引入 Java 或本地 HTTP 服务，不要打包个人数据库或前端构建依赖。

Anime Log 是一个个人本地追番网页应用。前端使用 Vue 3 + Vite，后端使用 Spring Boot 2.7 + JDBC + SQLite。新番数据来自 yuc.wiki，后端负责抓取、缓存、图片代理和本地数据持久化，前端只调用本地 `/api` 接口。

主要功能包括：

- 追番列表：按 `watching`、`completed`、`dropped` 和全部状态筛选。
- 新番发现：按季度展示番剧，支持上一季、当前季、下一季和刷新。
- 观看进度：记录已看集数，并显示总集数，未知总集数显示 `?`。
- 番剧笔记：支持总评和分集笔记，前端带轻量富文本编辑与清洗。
- 图片代理：前端封面通过后端 `/api/images/proxy` 加载，避免跨域和防盗链问题。

## 目录结构

- `pom.xml`：Maven 父项目，只包含 `backend` 模块。
- `backend/`：Spring Boot 后端。
  - `src/main/java/com/animelog/anime/`：季度、新番抓取、yuc.wiki 解析、图片代理。
  - `src/main/java/com/animelog/watch/`：追番记录 API、服务、仓储和状态枚举。
  - `src/main/java/com/animelog/note/`：番剧总评和分集笔记 API、服务、仓储。
  - `src/main/java/com/animelog/config/`：配置、CORS、异常处理、SQLite 表初始化。
  - `src/main/resources/application.yml`：端口、SQLite 路径、yuc.wiki 地址和缓存 TTL。
  - `src/test/java/com/animelog/`：后端集成测试和解析器测试。
- `frontend/`：Vue 3 + Vite 前端。
  - `src/App.vue`：当前主要界面和交互逻辑都在这里。
  - `src/api.js`：前端 API 封装。
  - `src/styles.css`：全局样式。
  - `vite.config.js`：Vite dev server 和 `/api` 代理到后端 `localhost:8080`。
- `backend/data/anime-log.db`：本地运行时 SQLite 数据库。
- `frontend/node_modules/`、`frontend/dist/`、`backend/target/`：生成物或依赖目录，通常不要手动编辑。

## 常用命令

在仓库根目录运行后端：

```powershell
mvn -pl backend spring-boot:run
```

运行后端测试：

```powershell
mvn -pl backend test
```

运行前端开发服务器：

```powershell
cd frontend
npm.cmd run dev
```

构建前端：

```powershell
cd frontend
npm.cmd run build
```

完整本地体验通常需要先启动后端，再启动前端。Vite 默认运行在 `http://127.0.0.1:5173`，后端默认运行在 `http://localhost:8080`。

## API 速查

后端 API 当前包括：

- `GET /api/seasons/current`
- `GET /api/anime?season=YYYYMM`
- `POST /api/anime/refresh?season=YYYYMM`
- `GET /api/watch-records?status=watching|completed|dropped`
- `POST /api/watch-records`
- `PATCH /api/watch-records/{id}`
- `DELETE /api/watch-records/{id}`
- `GET /api/anime/{animeSourceId}/notes`
- `PUT /api/anime/{animeSourceId}/notes/summary`
- `PUT /api/anime/{animeSourceId}/notes/episodes/{episodeNumber}`
- `DELETE /api/anime/{animeSourceId}/notes/episodes/{episodeNumber}`
- `GET /api/images/proxy?url=...`

前端新增接口时，优先放在 `frontend/src/api.js`，再由组件调用。

## 数据库约定

SQLite 表由 `DatabaseInitializer` 在后端启动时创建：

- `anime_sources`：按季度缓存 yuc.wiki 番剧源数据，`source_url` 唯一。
- `season_refreshes`：记录季度刷新时间，用于缓存 TTL。
- `watch_records`：追番记录，`anime_source_id` 唯一，删除番剧源时级联删除。
- `anime_notes`：番剧笔记，`episode_number = 0` 表示总评，大于 `0` 表示分集笔记。

测试使用 `anime-log.database-path=target/test-anime-log.db`，不要让测试直接写入 `backend/data/anime-log.db`。

## 编码与文本注意事项

项目包含中文 UI 文案。后续修改中文文本时请保持 UTF-8 编码。当前 PowerShell 输出里可能会把中文显示成乱码，这通常是终端编码问题，不代表源码一定损坏。编辑前尽量用支持 UTF-8 的编辑器确认真实内容。

Java 代码当前保持 Java 8 兼容，不要引入 Java 9+ API 或语法。仓储层直接使用 `JdbcTemplate` 和手写 SQL，保持参数化查询，避免拼接用户输入。

前端当前是单文件应用形态，较多状态和富文本逻辑集中在 `App.vue`。做较大前端改动时，可以逐步拆组件，但不要顺手重写整体 UI。富文本内容保存前要继续经过 `sanitizeRichText` 清洗。

## 开发约定

- 优先保持现有技术栈：Spring Boot 2.7、Java 8、JdbcTemplate、Vue 3、Vite。
- 修改后端行为时，补充或更新 `backend/src/test/java` 下的集成测试。
- 修改 yuc.wiki 解析逻辑时，优先更新 `YucWikiParserTest`，因为外部页面结构可能变化。
- 修改前端 API 路径时，同时检查 `frontend/src/api.js`、控制器路径和 Vite 代理。
- 不要把运行时数据库、构建产物或依赖目录当成源文件提交或手动维护。
- 对会访问外网的功能保持可失败设计；yuc.wiki 抓取失败应返回明确错误，而不是让前端静默空白。
- 每次修改代码后，都需要提交一次git commit

## 验证建议

文档或纯样式改动可以不跑全量测试，但应说明未运行原因。后端逻辑改动至少运行：

```powershell
mvn -pl backend test
```

前端逻辑或样式改动至少运行：

```powershell
cd frontend
npm.cmd run build
```

涉及端到端体验时，同时启动后端和前端，在浏览器检查追番列表、新番页、笔记页、图片预览和刷新按钮。

## 已知环境细节

当前仓库在 Windows 路径 `D:\Vibe Coding\anime-log`。在沙箱用户下执行 `git status` 可能遇到 Git 的 dubious ownership 检查。如果只是扫描或改文件，不需要修改全局 Git 配置；需要提交时再由用户确认是否添加 safe.directory。
