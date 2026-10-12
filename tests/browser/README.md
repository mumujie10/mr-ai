# 浏览器回归夹具

这里是 **39 个真实渲染夹具**：用真组件、假数据，在浏览器里检查那些 jsdom 和单测看不见的东西——真实布局、定时器交错、动效契约、深浅色、窄视口。

## 怎么跑

1. 起 dev 服务（`pnpm dev` 会带起它，或直接 `npx vite`）。
2. 浏览器打开 `http://localhost:1420/tests/browser/<夹具>.html`。
3. 每个夹具页面自己报告 `PASS` / `FAIL`，并把测量值以 JSON 显示在页面上；带 `?open=1`、`?tab=…`、`?theme=dark` 这类查询串可以直接跳到要看的状态。

配套的确定性回归（定时、字素、Markdown、store）用命令行跑：

```sh
node --experimental-strip-types --test tests/*.test.ts
```

**共同边界**：这些夹具不调模型、不碰凭据、不走真实 IPC、不读写你的会话存档（个别夹具明确列出唯一被 stub 的 store 动作）。它们证明的是"浏览器里的布局/时序/状态呈现"，**不是**原生 CPU/GPU 占用、不是真机应用行为、也不是线上模型正确性。改了被测实现后**重新加载页面**，避免 Fast Refresh 留下假象。

---

## 流式与滚动

- **`stream-throttle.html`** — 真实 React StrictMode 提交下走完：完成、替换、截断、待清理定时器、连续 Unicode 追加、合并、卸载，页面报 `PASS`。可见更新次数取决于浏览器调度，**不是模型速度或帧率基准**。
  背景口径：展示光标仍按帧揭示文本；Markdown 解析单独按预算走——4000 UTF-16 单位以内 32ms、16000 以内 64ms、更大 128ms；完成态绕过预算；超预算的活动行把自己的间隔拉长到最多 160ms，免得 200 tok/s 的流把揭示帧饿死。这些上限是在"解析工作量"和"到达延迟"之间做交换，**不保证**超大 Markdown 文档的帧时间上界。
- **`tail-pin.html`** — 高速流式的滚动回归。点 `Replay 100 chars / 144ms`：真实 Markdown 渲染器、虚拟列表与跟随 hook 收到每 144ms 100 字的突发（这是**合成的突发形状，不是实测模型速率**），含中文、emoji、粗体、行内代码和一个迟到的大工具行。输出要 `PASS`、resize 投递时尾部零空隙、落定后 `complete: true`。回放中向上滚要暂停跟随，`Resume follow` 要回到尾部。检查的是浏览器布局/揭示同步，不是原生 IPC 延迟。
- **`thinking-reveal.html`** — 以 provider 速度检查实时思考面板：真实 `ThinkingSurface` 重放 200 tok/s（每 144ms 100 字），每帧采样渲染正文。突发必须摊到多帧上——`largestSingleFrameStep` 保持小、首帧之后 `framesJumpingAtLeast 30 chars` 为 0——页面报 `PASS`。这个行为修好之前，每次突发一帧刷完，看起来像闪字。
- **`thinking-layout.html`** — 点 `Replay thinking` 从 2100 字长到 8100 字，长段落与短代码样例行交替。生产思考面板必须保留 `[row-000]`、不得因丢弃早期行而收缩，最终显示与收到的文本完全一致；输出 `PASS`、`prefixRetained: true`、`maxShrink: 0`、`complete: true`。新追加行造成的普通上移单独报告，不当作"无闪烁"的证据。移除实时 2000 字窗口不影响既有的手动折叠与思考结束折叠设置。
- **`process-disclosure-bounded.html`** — 大过程分组：生产 disclosure 渲染 120 或 500 个合成为工具，每页最多 40 项。上/下/最新页都能访问到每一项；正在读较早页面时追加新数据不得切换页面；参数与结果保持懒加载。**这是 DOM 规模检查，不是原生 CPU 基准**。
- **`touch-scroll-follow.html`** — 在**触摸模拟视口**（390×844，对应手机远程访问界面）检查时间线尾部跟随意图。向上 swipe 进历史后 `window.__live()` 要读 `following: false`；此后列表增长（`grow` 按钮代表流式与工具行）必须停在读者所在的位置，不得被拉回尾部；滑回底部恢复跟随，下一次增长重新钉在尾部。被测的两个 hook（`useScrollFollow`、`useTailPin`）就是生产实现，行是静态的。注意 refs 不是响应式的——**通过 `window.__live()` 读，别看页面上渲染的数字**。
- **`collapsible-message.html`** — 长消息折叠：超过 480px 的用户消息夹到 320px，底部渐隐融进气泡底色、中间一个 chevron；点它展开/收起；短消息绝不夹。

## 界面状态与动效契约

- **`concurrent-status.html`** — 并发会话指示：真实 `AiChatSidebar` 与 `SessionTab` 各渲染 1 / 6（默认）/ 12 个合成会话。切换 Processing / Retry / Complete、浅色/深色、Normal / Reduced motion。夹具通过改媒体条件选中**出厂那份** reduced-motion 声明，不覆盖它的动画样式。Processing 必须让所有状态点的 `transform` 持续变化，Retry、Complete 与 Reduced motion 必须没有任何在跑的状态动画。JSON 读数里，只要活动关键帧包含 `transform`、`opacity` 之外的任何属性（含 `boxShadow`、`filter`、`backgroundPosition`）就报 FAIL。检查的是动画契约与可见状态，不是原生 CPU/GPU。
- **`sidebar-collapse.html`** — 侧栏 worktree 展开/收起逐帧检查：收起「WORKTREES · n」组、再展开、以及展开某个 worktree 子行，都必须经过中间高度（真实的 `grid-template-rows` 过渡），不能在两个值之间跳；区域夹合过程中行仍要在 DOM 里。夹具驱动真实 `AiChatSidebar`，用采样到的起止高度与中间帧数报 PASS；坏掉的版本读数会是 `0 intermediate frames`。
- **`effort-layout.html`** — 真实模型菜单在循环五档推理强度时保持触发器宽度与浮层位置。夹具会等字体和入场动画结束再测量；只用本地 React 状态，**不改应用设置也不发模型请求**。
- **`run-status-strip.html`** — 输入框上方那条状态带：种好 chat 与 git store 后重放一个真实回合及其结算，检查药丸行（子代理 / 已编辑，带滚动行数统计）、单开面板与 chrome 开关在两种主题下的表现。
- **`retry-progress.html`** — 尾部指示的供应商重试徽标：按钮循环"无重试"、claude `api_retry 3/10`、codex `Reconnecting 1/5`、以及 omp 没有上报上限的重试。徽标必须在 meta 行末尾以警告色调显示 `重试中 x/y`（CLI 没报上限时 `重试中 x`），tooltip 带供应商自己的原因，没重试时**完全不出现**。
- **`response-check.html`** — 尾部指示的响应对账：合成 `launch`/`served` 事件走真实 store。`一致` 显示默认色的圈勾；`模型不一致`（两边都不同）与 `档位降级`（同模型但降级）显示琥珀色圈警告；`版本差异` 显示请求系列的实际日期快照（是命中，不是替换）；`未上报` 不给任何徽标——没上报的一边是未知，永远不算通过。`已结算` 会把 `done` 事件走一遍 store 并渲染真实结算行（`MessageRow`）：记录的对账要在回合结束后还在、还能打开（悬停行、再悬停徽标）。悬停徽标必须展开卡片（请求模型 / 响应模型 / 请求档位 / 响应档位，不同值标 `不一致`，缺失标 `未上报`）。
- **`auto-compact-curtain.html`** — 压缩幕布：宿主自己的调度行——`/compact` 命令，以及自动压缩为了让任务被重新接手发的 resume 提示——**无论引擎转录怎么重放都不许显示成气泡**；压缩进行中，时间线尾部必须正好是一行灰色右对齐的 `< 正在压缩上下文 >`（宿主发起和引擎上报的压缩都一样），而不是波浪指示。四个按钮切换 idle / host / engine / resume 状态；读数对照五条存储行报告渲染出的气泡、提示色的计算值与对齐、以及 PASS/FAIL。

## 输入框与会话

- **`composer-triggers.html`** — 真实 `Composer` 配种好的智能体与提示词目录：点输入框、在行首输入 `#` 或 `!`，选择器必须在输入框上方打开。`window.__probe()` 返回 `{ text, agentOpen, promptOpen }`。
- **`agent-prompt-menus.html`** — 对照种好的 store 检查 `#` 智能体选择器与 `!` 提示词选择器：智能体菜单先「我的智能体」，再按每个启用的内置分区一节（带过滤词时摊平）；提示词行带 工作区/全局 范围徽标；两者末尾都有一行固定的"新建"，点了跳设置。生成头像在 16px 行里是动画的（本夹具的浮层挂在视口外，先把浮层钉进可见区域，再对同一 canvas 采样两次）。
- **`cli-channel-dropdown.html`** — 十几个中转时的供应商选择器。浮层必须把当前渠道显示成一行下拉项——**打开之前 DOM 里不许出现供应商名**——展开后的列表要限高（`clientHeight` ≤ 200 而 `scrollHeight` 更高）。头部的渠道筛选要在保持展开的同时把列表收窄，选中一项要清掉筛选并关闭列表。Claude 在首位、Codex 为当前引擎时，选中一个聚焦渠道后必须让 Codex 面板保持挂载并把焦点还给它的渠道触发器。夹具数据是这台机器的真实摆放：官方行与十几个供应商行**并列**，所以还要验——供应商段有「供应商渠道」小标题、官方行仍是 `BUTTON`（照常选中），并且界面不解释任何"没配置"（`未配置` 三个字不许出现）。夹具用受控选择状态驱动真实 `CliMenu`，报出测量高度与焦点。触发器像药丸那样锚在窗口右缘：浮层与药丸右对齐，引擎列表靠药丸一侧、模型浮层再往左，所以展开时是向左生长，窄窗口不得把任何东西推出屏幕。它的 HTML 把 media query 一律报成"不匹配"（同 `composer-footer-repro.html` 的做法），否则 < 768px 视口下产品走移动端对话框，桌面那张浮层根本不存在，也就量不到；`frame()` 在 `document.hidden` 时退化成定时器，因为隐藏页签永不触发 rAF；浮层卡片按 `[data-engine-flyout]` 取（react-aria 用内联样式定位，没有 `absolute` 类可以往上走）。
- **`composer-footer-repro.html`** — 同一个药丸放进真实 `ComposerToolbar` 行：它必须在发送按钮左侧，只显示引擎标记、模型名与以 caption 尺寸显示的档位（引擎名留在药丸的 `aria-label` 里）；浮层是两张并排卡片——模型浮层，然后紧挨药丸的引擎列表——任何东西都不越过窗口边缘。它的 HTML 会把 `(max-width: 767px)` 报成"不匹配"，因为断点以下产品用移动端对话框、桌面这一行根本不会渲染；但测量的视口仍是真实窗口宽度，所以这一对确实要在里面放得下。
- **`creator-jump.html`** — 「创建插件」跳转：挂载真实 PluginHub、真实 ChatCenterPane 与真实 Composer，**按真人的点击顺序**点过去，所以中心面切回聊天之后输入框必须真的拿到光标（旧的直接 `focus()` 在表面还是 `visibility:hidden` 时会被浏览器静静忽略），预填草稿完整、光标落在末尾。`window.__probe()` 在页面上给出 PASS/FAIL 明细。无后端。
- **`delete-confirm-popover.html`** — 删除会话的确认：在会话行右键选「删除」必须在点击点旁打开**跟随指针的浮层**（不是居中模态），且「确认」是默认焦点；Esc 与点击外部取消且不删除；点「确认」只触发一次 store 的 `deleteSession`。用真实 AiChatSidebar、ThreadContextMenu、ChatPageDialogs，只 stub `deleteSession`。
- **`plan-review.html`** — 计划预览与审批界面：生命周期各状态（草稿 / 等待审批 / 已被取代 / 已批准 / 已失效）的时间线卡片都带不依赖颜色的可访问状态文本；输入区上方的审批 dock（三个动作、执行权限读数、默认焦点不在批准按钮）；一份长 Markdown 计划（中文、emoji、GFM 表格、代码围栏、超长文）在行内和完整预览侧面板各看一遍（Esc / 点背景关闭时不发任何 IPC）。store 静态种好，无模型、无后端、无存档。
- **`split-layout.html`** — 对话分屏（Trellis 式平铺）对照真实布局：真实 `SplitLayout`、`SplitDragProvider`、`ChatConversation` 先渲染单列；把侧栏会话拖到右边缘必须按半分屏线切出第二格（带自己的标题栏与一条分隔线，布局落 localStorage）；「向下分屏」要加出带拖入/新建提示的空格；关掉它回到两格；把一格标题栏拖到另一格中心要交换两者会话；从真实页签条把一个会话页签往下拖进对话区也要分屏（页签条内横向拖动仍然是排序）；拖分隔线要跟随指针比例并在 220px 最小格宽处夹住；关到只剩一格要回到单列并清掉持久化布局。chat store 的 `focusTab` 与 git store 的 IPC 动作被 stub。
- **`side-panel-overlay.html`** — 窄远程视口下的右侧文件面板（曾经溢出屏幕只画出半截）：真实 `ChatSidePanel` 以 overlay 模式渲染在 412px 行内（用一个 stub 面板页签代表 文件/更改，因此无 IPC）：右缘要贴住行的右缘、左缘要在行内，文档不得横向滚动。

## 面板与页面

- **`file-search-overlay.html`** — 文件面板的工作区搜索（树右键 → 搜索文件）在面板自己的 280px 列里：范围按钮代表被右键的文件夹，面板下方的 store 读数显示浮层让 store 做了什么。范围 **src** 下输入 `store` 必须列出 `src/features/files/store.ts`；范围 **src** 下输入 `sibling` 必须显示 无匹配文件，而同一个词在 **工作区根** 下要找到 `src-extra/sibling.ts`——**文件夹范围不得扫进与它同前缀的兄弟目录**。方向键移动高亮行，Enter 打开文件（读数里应出现 `openFiles` 与 `invoked` 里的 `read_file`），Esc 关闭浮层。索引与文件内容来自 stub 的 `list_file_index` / `read_file`。
- **`bot-editor.html`** — 对照内存中的智能体检查真实的「智能体」面板与编辑器：列表显示身份、运行时与技能数量，过滤与置顶开关可用，点一行打开全幅编辑器；头像工作室会重绘生成头像（**canvas 不是 SVG**——36px 的列表行也在画新帧，所以对同一个 canvas 采样两次来判断是在动还是冻住），「拼装预览」列出模型实际会收到的区块（空区块标 已省略，依赖本构建缺失工具的区块标 即将支持）。查询串 `?open=1&tab=能力&preview=1&theme=dark` 直接打开编辑器、指定分区页签、预览抽屉与深色主题。**短窗口**就是用来检查身份列的：它自己要能单独滚动（身份卡、提示与页脚各保持自己的高度，而不是被挤压），分区列单独滚动，且模态自身的任何一个滚动区都不画出滚动条（`scrollbar-none`，与设置列、页签条一致）。所有 `bot_*` 调用都由夹具应答：**不写文件、不调模型**。
- **`git-performance.html`** — Git 面板性能回归：挂载生产 `ChatSidePanel`，10,001 个合成变更文件 + mock 的 Git 动作。初始 Files 视图必须零次 Git 取数、零行挂载。显示变更、滚过列表，验证只挂载可见窗口 + overscan。打开或暂存一个文件只更新 `lastAction`，不碰任何仓库。写一条提交草稿、切到 Files 或收起侧栏再回来：草稿必须还在、隐藏的行要卸载、列表仍能滚到最后一个文件。指标读数报出请求数、挂载行数与动作。
- **`changes-row-layout.html`** — 更改面板的行网格：过去每行预留四个常驻尾列（固定 4.5rem 统计、新文件点槽、撤销槽、动作槽），大多数行右半边全空，暂存后的"+3"行白扔一整侧。现在网格必须是 状态 | 路径 | 统计（内容宽度），新文件点在统计格内部，行操作作为绝对定位浮层在悬停或键盘聚焦时出现。真实 ChangesPanel + stub 的 store 动作，不碰仓库。
- **`discard-changes.html`** — 撤销更改动作：worktree 侧的行（未暂存 / 未跟踪）有撤销按钮、已暂存的行没有；按钮打开危险确认；只有确认后才用该行路径调用 store 的 discard。真实 ChangesPanel，store 变更被 stub，不碰仓库。
- **`branch-picker.html`** — 更改面板的分支下拉：过滤到 `1.0.6` 并点 `v1.0.6` 行，必须对 `v1.0.6` 执行 store 的 checkout，同时面板显示当前分支是 `fix/git-changes-preview-layout`。这是陈旧 `isCurrent` 空操作的回归：缓存的分支列表过去用一份落后于外部（CLI）checkout 的快照来判断"当前"，把点击静静吞掉。真实 ChangesPanelHeader，只 stub store 的 checkout。
- **`workspace-drag.html`** — 侧栏工作区拖拽，用合成指针动作打真实 AiChatSidebar：把行丢进另一个组的容器要以组 id 调 `onDropWorkspaceToSection`；丢进 已归档 要给出归档哨兵；丢进未分组块要给 null；只有一个成员的分组其拖握把仍可用；空分组只在拖拽中途挂载并能接受落点；普通的组内拖动仍要提交 `onReorderWorkspaces` 且不同时触发分组的 drop。
- **`markdown-preview.html`** — 文件功能的 Markdown 预览（Streamdown），文档覆盖 GFM 表格、各级标题、列表、任务列表、引用、围栏代码、KaTeX 公式与 Mermaid 图：表格要有带边框容器与表头样式，代码块要有语言头 + 复制/下载并显示 `files.markdown.*` 文案，块级公式走 KaTeX，Mermaid 图在滚进视口前保持空容器（IntersectionObserver 懒渲染），之后画出流程 SVG。
- **`usage-pane.html`** — 对照种好的账本检查用量页：同一个模型一次记为中继限定名（`agentrouter qunyou/deepseek-v4-flash`）、一次记为引擎裸 id，必须折成**一行**——在 详细数据 和图表悬停分解里都要如此——总量相加。也种了一个带缓存的回合，所以汇总行必须读作 累计 = 输入 + 输出（输入是完整 prompt 侧：新建 + 缓存）。还会重放一次实时上报（`usage://changed`）显示页面在回合中增长。无应用、无数据库、无存档。
- **`plugin-detail-rail.html`** — 桌面宽度下的插件详情页（验证运行时是 1145×731，真实 `PluginDetailPage` 外面套上应用的 40px 页签条与 28px 状态栏）：README 里一条 PowerShell 代码行宽 922px、列宽 728px，必须**在该列内**横向滚动；展开的 22 项权限栏必须收在视口内并有自己的滚动条，`aside.scrollTop` 能滚到 链接 行而页面不动。这两点都曾被报坏：代码行越过权限栏约 190px 画出去，钉住的 1042px 权限栏只能把 README 滚到底才读得到。读数报 PASS 加实测盒、`clientHeight`/`scrollHeight` 与页面 scrollTop。无应用外壳、无后端、无存档。
- **`changelog-dialog.html`** — 版本历史弹窗布局（设置 → 关于 → 版本记录）：发布说明正文必须可滚（ModalShell 内层 Dialog 要把 flex 高度透下去），底部翻页器留在模态内，头部是 Star 按钮而不是旧的横幅条，翻页要能到最旧一条。
- **`performance-diagnostics.html`** — 真实诊断弹窗 + 合成原生数据 + 真实渲染器监视。可选中的 JSON 摘要必须限制在 12,000 UTF-8 字节内；完整导出把全部样本放进另一个 JSON 文件。检查"五分钟 / 60 样本"的说明与默认开启的开关：关掉清掉预览，打开重新开始记录窗口。剪贴板被拒绝时要保留摘要供手动复制；保存取消**不得**显示成功。本夹具 mock 了偏好持久化与原生样本，因此**不验证**生产 CPU、重启后的持久化或跨窗口 IPC。
- **`cli-update-dialog.html`** — 一键安装 CLI 的对话框：plan → confirm → 流式实时日志 → done，由夹具流程驱动，不会真的执行安装。**只是视觉冒烟**，不能证明 npm / 原生渠道映射正确。
- **`web-access-pane.html`** — 设置模态里的远程访问面板：检查中转状态切换有没有造成布局位移，以及配对密钥是否跟着后端侧的轮换刷新。IPC 被 mock，无应用、无中转、无存档。
  布局口径（本会话已变更）：远程访问页现在走**880px 宽阅读列**（其余设置页仍是 720px），因为那三张等宽卡片各只有 234px 时标题会折成两行；面板高度与滚动方式不变。
- **`settings-dialog-dismissal.html`** — 设置 `<dialog>` 外壳下的模态关闭路径：`?open=1` 打开智能体编辑器后，按它外面的灰色区域（顶条、导航栏、两侧边距）必须**只**关掉编辑器，别的一律不动。导航栏、列表、编辑器都是生产组件，所以这里真正检验的是 react-aria `isDismissable` 作用在真实 ModalOverlay 上。智能体在内存里，不写盘。
- **`relay-plugin.html`** — 可安装 Relay 插件的真实 React UI + 假 Agent 传输。插件源码是同级检出 `../ccgui-plugin/ccgui-plugin-plan-execute-relay`（`vite.config.ts` 允许 dev 服务读同级插件仓库）；**没有这份检出页面就打不开**。配置两个节点、发两轮规划，确认两边的回复都不自行开始执行，然后批准最新计划。未发送的草稿必须让批准不可用；可见请求计数要区分规划与执行。再测编辑/版本选择、停止、回到普通聊天。**不证明**原生只读约束或线上模型正确性。
