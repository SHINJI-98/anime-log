# Anime Log

个人本地追番桌面应用。使用 Electron + Vue 3，内置 SQLite（sql.js）和 yuc.wiki 抓取逻辑。项目仅维护桌面端，不提供独立浏览器服务，无需安装 Java 或单独启动后端。

## 功能

- 默认首屏显示“我的追番”。
- 支持追番状态：在看、看完、弃坑。
- 支持记录已观看集数，并显示 `已看/总集数`；总集数缺失时显示 `?`。
- 新番页展示当前季度资讯，并支持上一季、当前季、下一季切换。
- 桌面版可将“在看”番剧关联到 AniList，按章节排期展示预计已播进度、今日更新和下一集日期。
- 应用运行时每小时同步 AniList 排期，并可在北京时间 09:00 后发送可关闭、持久化去重的系统通知。
- 桌面进程抓取 yuc.wiki 并处理图片，前端调用应用内部 `anime-log://local/api`，不监听 HTTP 端口。
- 追番和笔记保存在 Electron 用户数据目录的 `anime-log.db`。

## API

- `GET /api/seasons/current`
- `GET /api/anime?season=YYYYMM`
- `POST /api/anime/refresh?season=YYYYMM`
- `GET /api/watch-records?status=watching|completed|dropped`
- `POST /api/watch-records`
- `PATCH /api/watch-records/{id}`
- `DELETE /api/watch-records/{id}`
- `GET /api/anime/search?keyword=...`
- `GET /api/anilist/subjects/{id}`
- `PUT|DELETE /api/anime/{id}/broadcast-binding`
- `POST /api/broadcast/refresh`

## 备注

yuc.wiki 季度页既支持按星期的总表，也支持只有番剧介绍列表的页面。没有总表时，逐条读取封面和放送说明，按原文中的星期分组；日期或星期未定时保留原文，不自行补齐。解析器升级后自动刷新旧季度缓存，页面结构变化不改变已追番条目的本地 ID。

yuc.wiki 继续提供季度新番资料；AniList 通过公开 GraphQL API 提供关联后的放送排期，无需登录。在看番剧的中文标题在本地名称库中精确且唯一匹配时，默认自动核验并关联；同名或未收录条目由用户选择，不按模糊相似度自动绑定。接口的放送时间戳转换为北京时间日期，继续沿用日期级规则：当天 09:00 后提醒今日排期，日期过去后计入预计已播。界面均标为“预计”，不代表平台确认实际播出；缺失排期时不以总集数代替已播进度。

升级后，已有 Bangumi 关联保留为“需要重新关联”，不会把旧 ID 当作 AniList ID，也不会再向 Bangumi 发送请求。请在卡片中重新选择 AniList 条目；原观看进度、笔记及单番通知偏好保留。中文搜索支持简繁体和别名，优先用本地名称解析 AniList ID，再读取候选详情。无结果时可换用日文、英文、罗马字或输入 `https://anilist.co/anime/数字`。AniList 暂时不可用时仍显示本地中文候选，关联前必须重新核验。

中文名称来自 [soruly/anilist-chinese](https://github.com/soruly/anilist-chinese)（MIT）及 [bangumi-data](https://github.com/bangumi-data/bangumi-data)（CC BY 4.0），内置快照与许可说明。后者仅提取带明确 AniList ID 的中文译名和别名，例如“欺诈游戏”直接解析为 `197754 / LIAR GAME`，再按 ID 查询 AniList；不把中文原样交给 AniList 当作唯一搜索方式，也不按标题猜测跨站关联。简繁转换使用 OpenCC.js。两份名称库独立在后台检查，每七天更新一次，失败至少间隔一小时重试；下载完整、校验并原子保存成功后才切换索引，一份更新失败不影响另一份。旧缓存与内置快照支持离线检索。用户已确认关联的本地番剧标题也参与别名搜索，解除或更换关联后不再沿用旧映射。名称库更新不覆盖已有关联，观看记录与笔记始终使用原本地 ID。Bangumi 在线 API 不作为依赖。

启动、后台检查以及新增在看番剧时会尝试自动关联。手动解除关联会持久化停止该番剧的自动关联；再次手动关联即可恢复。搜索统一使用本地 `GET /api/anime/search?keyword=...`，旧 AniList 搜索路径保留兼容。测试可用 `ANIME_LOG_ANILIST_URL` 指定模拟 GraphQL 地址（同时停止名称库联网更新），或使用 `ANIME_LOG_NAME_CATALOG_UPDATES=0` 单独停止名称库更新。

## 桌面客户端

完整界面使用黑色主题。右下角的「桌面便签」会隐藏主界面并显示使用原有应用图标的半透明悬浮球（64×64，无窗格和文字底板）：拖动悬浮球可移动位置，鼠标悬停时展开追番周历，离开悬浮球和周历约 650 毫秒后自动收起。周历支持 `+1` 保存进度、刷新、切换置顶和返回完整界面。下次启动会恢复便签模式。

点击窗口关闭按钮默认隐藏到系统托盘（主窗口和悬浮球均隐藏）。点击托盘图标恢复主界面，右键菜单可显示悬浮球或退出应用。「设置」中可将关闭行为改为「退出应用」，选择保存在用户数据目录的 `desktop-settings.json`。托盘无法创建时，关闭窗口会直接退出，避免应用隐藏后无法找回。

追番卡片的「关联 AniList」会按标题给出候选，也支持粘贴 `anilist.co/anime/数字` 链接或条目 ID。关联只影响放送资料，不修改已看集数、状态和笔记。默认仅同步“在看”番剧；应用完全退出后不会在后台运行，下次启动会补同步。系统通知可在桌面设置中全局关闭，也可在单部番剧的关联窗口中关闭。

桌面便签在“已看”进度下独立显示“预计播至第 N 集”；无关联或无有效排期时显示“播出未知”。收到放送同步事件后自动更新，窗口隐藏期间延后到显示时刷新；同步不会清除刚记录观看进度的撤销入口。过期缓存保留集数并标注“数据可能过期”。

点击便签封面会展开完整界面并进入对应追番详情（总结与分集笔记）。新番页中已追番的动画封面也会打开该详情；未追番的新番封面，以及追番列表封面，保留大图预览。

「设置」中还提供默认关闭的「开机自启动」。在 Windows 打包版中，勾选并保存后会注册登录启动项，取消勾选并保存会移除。状态以 Windows 实际设置为准；开发模式禁用此项，避免把开发用 Electron 注册为启动程序。免安装版注册外层 exe 路径，移动 exe 后需要重新开启自启动。自启动仍恢复上次的主界面/便签模式。

便签采用横向七列周历：彩色星期栏、今天标记、封面及标题、观看进度。只请求在看记录，封面按需懒加载；未确定星期的番剧放在下方，窄窗口可横向滚动周历。完整界面和周历复用一个窗口，悬浮球是独立的透明小窗口。置顶是浮在其他窗口上方，不是嵌入 Windows 桌面壁纸层，按钮会反映系统实际置顶状态。

桌面版直接在 Electron 进程内处理追番、笔记、季度缓存和抓取，没有 Java 子进程和 8080 端口依赖。生产包不包含个人数据库、Vue/Vite 构建工具，只保留编译后的界面和运行时依赖。Electron 内核仍占据主要体积。

开发运行：

```powershell
cd frontend
npm.cmd install
npm.cmd run electron:dev
```

核心验证：

```powershell
cd frontend
npm.cmd run test:e2e
```

生成 Windows 免安装包：

```powershell
cd frontend
npm.cmd run electron:build
```

Vite 仅负责 Electron 开发窗口的界面热更新；直接用普通浏览器打开会提示启动桌面应用，不会请求浏览器后端。

生成后可运行 `npm.cmd run test:packaged` 验证打包目录中的桌面程序。输出位于 `frontend/release/Anime-Log-0.1.0-portable.exe`。

### 数据兼容与保存

沿用旧桌面版用户数据目录中的 `anime-log.db` 和表结构。首次由新数据服务打开已有数据库时，先生成逐字节备份 `anime-log.db.pre-desktop.bak`；旧数据库仅通过 `ANIME_LOG_MIGRATION_DB` 显式指定后导入，原文件不被修改。发布包不会夹带开发者数据库。

sql.js 将数据库加载到内存，每次修改完成后将完整 SQLite 文件写入临时文件、同步到磁盘并替换正式文件；写盘失败会回滚内存状态。适合个人追番数据，不适合作为大型或多进程共享数据库。请先正常退出旧桌面版再启动新版；发现未合并的 WAL/回滚日志或外部改写时会停止操作，避免覆盖数据。原有笔记清洗逻辑保持不变。

高级迁移可使用 `ANIME_LOG_MIGRATION_DB` 指定旧数据库路径，仅在目标数据库不存在时使用。`ANIME_LOG_USER_DATA_DIR` 可指定独立用户数据目录，测试使用临时目录，不写入真实数据库。
