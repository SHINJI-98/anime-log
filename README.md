# Anime Log

个人本地追番应用。桌面版使用 Electron + Vue 3，内置 SQLite（sql.js）和 yuc.wiki 抓取逻辑，无需安装 Java，也无需单独启动后端。仓库保留 Spring Boot 代码，用于可选的浏览器开发模式。

## 功能

- 默认首屏显示“我的追番”。
- 支持追番状态：在看、看完、弃坑。
- 支持记录已观看集数，并显示 `已看/总集数`；总集数缺失时显示 `?`。
- 新番页展示当前季度资讯，并支持上一季、当前季、下一季切换。
- 桌面进程抓取 yuc.wiki 并处理图片，前端调用应用内部 `anime-log://local/api`，不监听 HTTP 端口。
- 桌面版追番和笔记保存在 Electron 用户数据目录的 `anime-log.db`，浏览器模式使用 `backend/data/anime-log.db`。

## 浏览器开发模式（可选）

后端：

```powershell
mvn -pl backend spring-boot:run
```

前端：

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

打开 Vite 输出的地址，通常是 `http://127.0.0.1:5173`。

## API

- `GET /api/seasons/current`
- `GET /api/anime?season=YYYYMM`
- `POST /api/anime/refresh?season=YYYYMM`
- `GET /api/watch-records?status=watching|completed|dropped`
- `POST /api/watch-records`
- `PATCH /api/watch-records/{id}`
- `DELETE /api/watch-records/{id}`

## 备注

第一版只依赖 yuc.wiki。若 yuc.wiki 页面没有提供总集数，应用会保留为空并在前端显示未知。

## 桌面客户端

完整界面使用黑色主题。右下角的「桌面便签」会隐藏主界面并显示使用原有应用图标的半透明悬浮球（64×64，无窗格和文字底板）：拖动悬浮球可移动位置，鼠标悬停时展开追番周历，离开悬浮球和周历约 650 毫秒后自动收起。周历支持 `+1` 保存进度、刷新、切换置顶和返回完整界面。下次启动会恢复便签模式。

点击窗口关闭按钮默认隐藏到系统托盘（主窗口和悬浮球均隐藏）。点击托盘图标恢复主界面，右键菜单可显示悬浮球或退出应用。「设置」中可将关闭行为改为「退出应用」，选择保存在用户数据目录的 `desktop-settings.json`。托盘无法创建时，关闭窗口会直接退出，避免应用隐藏后无法找回。

「设置」中还提供默认关闭的「开机自启动」。在 Windows 打包版中，勾选并保存后会注册登录启动项，取消勾选并保存会移除。状态以 Windows 实际设置为准；开发模式禁用此项，避免把开发用 Electron 注册为启动程序。免安装版注册外层 exe 路径，移动 exe 后需要重新开启自启动。自启动仍恢复上次的主界面/便签模式。

便签采用横向七列周历：彩色星期栏、今天标记、封面及标题、观看进度。只请求在看记录，封面按需懒加载；未确定星期的番剧放在下方，窄窗口可横向滚动周历。完整界面和周历复用一个窗口，悬浮球是独立的透明小窗口。置顶是浮在其他窗口上方，不是嵌入 Windows 桌面壁纸层，按钮会反映系统实际置顶状态。

桌面版直接在 Electron 进程内处理追番、笔记、季度缓存和抓取，没有 Java 子进程和 8080 端口依赖。生产包不包含 Spring Boot jar、个人数据库、Vue/Vite 构建工具，只保留编译后的界面和运行时依赖。Electron 内核仍占据主要体积。

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

生成后可运行 `npm.cmd run test:packaged` 验证打包目录中的桌面程序。输出位于 `frontend/release/Anime-Log-0.1.0-portable.exe`。

### 数据兼容与保存

沿用旧桌面版用户数据目录中的 `anime-log.db` 和表结构。首次由新数据服务打开已有数据库时，先生成逐字节备份 `anime-log.db.pre-desktop.bak`；开发模式在没有用户数据库时可从 `backend/data/anime-log.db` 导入，原文件不被修改。发布包不会夹带开发者数据库。

sql.js 将数据库加载到内存，每次修改完成后将完整 SQLite 文件写入临时文件、同步到磁盘并替换正式文件；写盘失败会回滚内存状态。适合个人追番数据，不适合作为大型或多进程共享数据库。请先正常退出旧桌面版再启动新版；发现未合并的 WAL/回滚日志或外部改写时会停止操作，避免覆盖数据。原有笔记清洗逻辑保持不变。

高级迁移可使用 `ANIME_LOG_MIGRATION_DB` 指定旧数据库路径，仅在目标数据库不存在时使用。`ANIME_LOG_USER_DATA_DIR` 可指定独立用户数据目录，测试使用临时目录，不写入真实数据库。
