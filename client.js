/**
 * dsh-anatomy — Client half (browser module, loaded through window.__ModuleLoader__).
 *
 * DSH 架构透视 · LIVE ARCHITECTURE: a full-page engineering view of the running
 * harness. The Host exposes read-only routes under `dsh-anatomy/api/*`; this
 * module renders the 14 runtime domains as a left-to-right layered system
 * diagram, streams live call events through a canvas particle layer, and
 * exposes the component inventory + call log in the bottom console.
 *
 * Data path: NDJSON stream first, 1.2s polling fallback, exponential reconnect,
 * buffered-carrier watchdog, connection diagnostics, truncated-snapshot refill.
 * Nothing here mutates host state — the client is a pure observer.
 *
 * Only `react` is required from the browser module table. No external packages.
 */
window.__ModuleLoader__.load({
  id: 'dsh-anatomy',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-anatomy'

    // ---------------------------------------------------------------------
    // Architecture model. The 14 node ids are the Host snapshot's organ ids
    // (CONTRACT §1); the client owns the technical names and the layer map.
    // Host coordinates are ignored: this view is a layered system diagram.
    // ---------------------------------------------------------------------

    /** Diagram coordinate space (SVG viewBox and canvas projection share it). */
    const VIEW_W = 1240
    const VIEW_H = 720
    const MIN_ZOOM = 0.6
    const MAX_ZOOM = 3
    const NODE_W = 132
    const NODE_H = 56
    const NODE_ENGINE_SIZE = 76

    const LAYER_DEFS = [
      { id: 'entry', zh: '入口层', en: 'ENTRY', x1: 40, x2: 272 },
      { id: 'reasoning', zh: '推理层', en: 'REASONING', x1: 272, x2: 504 },
      { id: 'execution', zh: '执行层', en: 'EXECUTION', x1: 504, x2: 736 },
      { id: 'state', zh: '状态层', en: 'STATE', x1: 736, x2: 968 },
      { id: 'kernel', zh: '内核与安全层', en: 'KERNEL & SECURITY', x1: 968, x2: 1200 },
    ]
    const LAYER_ORDER = LAYER_DEFS.map(function (layer) { return layer.id })

    /** Client-side technical identity for the 14 Host organ ids. */
    const DOMAIN_DEFS = [
      { id: 'skin', layer: 'entry', x: 156, y: 250, zh: 'Web UI 客户端', en: 'Web UI / Client', subZh: '客户端渲染与交互', subEn: 'client rendering & interaction', descZh: 'Web UI 客户端插件、页面渲染、交互事件与输入入口。', descEn: 'Web UI client plugins, page rendering, interaction events and input entry.' },
      { id: 'immune', layer: 'entry', x: 156, y: 430, zh: '凭据授权', en: 'Credentials & Auth', subZh: '账户 / 授权 / 遥测', subEn: 'account / auth / telemetry', descZh: '凭据、授权、账户与遥测：识别请求来源并决定是否放行。', descEn: 'Credentials, authorization, account and telemetry: identify callers and gate access.' },
      { id: 'cortex', layer: 'reasoning', x: 388, y: 190, zh: 'Agent Loop', en: 'Agent Loop', subZh: '会话循环 / 目标 / 规划', subEn: 'session loop / goals / planning', descZh: 'Agent 主循环、会话循环、turn/step、目标与规划。', descEn: 'Agent main loop, session loop, turn/step, goals and planning.' },
      { id: 'heart', layer: 'reasoning', x: 388, y: 330, zh: 'LLM 推理', en: 'LLM Inference', subZh: '模型调用 / 流式生成', subEn: 'model calls / streaming', descZh: 'LLM 推理与模型调用：请求编排、流式响应与 token 用量。', descEn: 'LLM inference and model calls: request shaping, streaming responses and token usage.' },
      { id: 'agents', layer: 'reasoning', x: 388, y: 470, zh: '子代理/工作流', en: 'Subagents & Workflow', subZh: 'Agent Team / 定时任务', subEn: 'Agent Team / schedules', descZh: '子代理、Agent Team、Workflow 编排与定时任务。', descEn: 'Subagents, Agent Team, workflow orchestration and scheduled jobs.' },
      { id: 'stomach', layer: 'execution', x: 620, y: 160, zh: '工具执行', en: 'Tool Execution', subZh: '工具注册表 / 执行管线', subEn: 'tool registry / execution', descZh: '工具注册表与执行管线：参数校验、调度与结果回填。', descEn: 'Tool registry and execution pipeline: validation, dispatch and result delivery.' },
      { id: 'eyes', layer: 'execution', x: 620, y: 290, zh: '读取搜索', en: 'Read & Search', subZh: '文件读取 / 搜索 / 图片', subEn: 'file reads / search / images', descZh: '文件读取、目录搜索、图片与附件读取等只读感知能力。', descEn: 'File reads, directory search, images and attachments — read-only sensing.' },
      { id: 'limbs', layer: 'execution', x: 620, y: 420, zh: '写入终端', en: 'Writes & Terminal', subZh: '编辑 / 终端 / 子进程', subEn: 'edits / terminal / subprocess', descZh: '写入与编辑、终端命令、子进程与工作区操作。', descEn: 'Writes and edits, terminal commands, subprocesses and workspace operations.' },
      { id: 'lungs', layer: 'execution', x: 620, y: 550, zh: '网络/MCP', en: 'Network & MCP', subZh: 'Web 抓取 / MCP 通信', subEn: 'web fetch / MCP transport', descZh: 'Web 搜索与抓取、MCP 客户端与服务端通信。', descEn: 'Web search and fetch, MCP client and server transport.' },
      { id: 'intestines', layer: 'state', x: 852, y: 190, zh: '会话日志', en: 'Session Log & Store', subZh: '持久化 / 检索 / 统计', subEn: 'persistence / retrieval / stats', descZh: '会话日志、持久化存储、检索与投影统计。', descEn: 'Session logs, persistent storage, retrieval and projection stats.' },
      { id: 'kidneys', layer: 'state', x: 852, y: 330, zh: '上下文/Token', en: 'Context & Tokens', subZh: '压缩 / 计量 / 修剪', subEn: 'compaction / metering / pruning', descZh: '上下文压缩、token 计量、溢出与工具结果修剪。', descEn: 'Context compaction, token metering, spill handling and tool-result pruning.' },
      { id: 'marrow', layer: 'state', x: 852, y: 470, zh: '记忆技能', en: 'Memory & Skills', subZh: '技能 / Hindsight / 知识', subEn: 'skills / Hindsight / knowledge', descZh: '技能、Hindsight 记忆、MCP 资源与知识检索。', descEn: 'Skills, Hindsight memory, MCP resources and knowledge retrieval.' },
      { id: 'spine', layer: 'kernel', x: 1084, y: 250, zh: 'Cordis 内核', en: 'Cordis Kernel', subZh: '纤维 / 服务 / Loader', subEn: 'fibers / services / Loader', descZh: 'Cordis 内核：插件纤维、服务容器、Loader、HMR、配置与 Web 宿主。', descEn: 'Cordis kernel: plugin fibers, service container, Loader, HMR, config and web host.' },
      { id: 'liver', layer: 'kernel', x: 1084, y: 430, zh: '沙盒权限', en: 'Sandbox & Permissions', subZh: '沙盒 / 审批 / 守卫', subEn: 'sandbox / approvals / guards', descZh: '沙盒、权限、审批与工具守卫。', descEn: 'Sandbox, permissions, approvals and tool guards.' },
    ]
    const DOMAIN_ORDER = DOMAIN_DEFS.map(function (def) { return def.id })
    const DOMAIN_BY_ID = Object.create(null)
    for (const def of DOMAIN_DEFS) DOMAIN_BY_ID[def.id] = def

    // NOTE: there is deliberately no static/baseline edge table. Every edge in
    // this view is OBSERVED from the last 120s of TraceEvents (organ → target),
    // so topology can never claim a relationship the runtime did not show.

    /** Flow colors by event group (dots, edges, chips and call-log share them). */
    const FLOW_COLORS = {
      tool: '#3ee8ff',
      llm: '#ffa64d',
      session: '#b18cff',
      fs: '#4f9dff',
      approval: '#ffc04d',
      error: '#ff3b3b',
      plugin: '#ff6ad5',
      other: '#dff8ff',
    }

    /** Built-in Chinese one-line descriptions for the known tool surface (59). */
    const TOOL_ZH = {
      'hindsight_sync_status': '查看 Hindsight 记忆库同步状态：历史深化、对话入库、知识页与抽取进度',
      'hindsight_diagnose': '输出 Hindsight 运行时诊断：记忆库、工作区、配置位置、API 端点与非敏感环境覆盖',
      'hindsight_search_knowledge_pages': '检索本仓库的 Hindsight 知识页（全文 + 语义混合搜索）',
      'hindsight_list_knowledge_pages': '列出本仓库的 Hindsight 知识页（架构、组件、约定、决策、进行中事项）',
      'hindsight_read_knowledge_page': '读取指定 Hindsight 知识页的完整内容',
      'hindsight_reflect': '基于全部记忆做深度推理，回答「为什么」类问题（过去决策、规则、字面值）',
      'hindsight_capture_initiative': '把新功能/倡议记录为可跟踪的知识页，并随进展更新',
      'hindsight_ingest_document': '把外部文档或耐久笔记写入仓库记忆，供未来检索',
      'working_directory': '读取或切换当前工作目录（cd）',
      'list_mcp_resources': '列出 MCP 服务器可用的资源',
      'list_mcp_resource_templates': '列出 MCP 服务器的参数化资源 URI 模板',
      'read_mcp_resource': '按 URI 读取 MCP 服务器资源',
      'load_workspace_dependencies': '获取捆绑的 Python 库路径与版本（numpy/pandas/docx/pptx/openpyxl 等），以及 Node/pnpm 路径',
      'mcp__github__add_comment_to_pending_review': '给当前待审 PR 的评审添加评论',
      'mcp__github__add_issue_comment': '给 Issue 或 PR 添加评论/表情回应',
      'mcp__github__add_reply_to_pull_request_comment': '回复或表情回应一条 PR 评论',
      'mcp__github__create_branch': '在仓库中创建新分支',
      'mcp__github__create_or_update_file': '在远端仓库创建或更新单个文件（需提供 SHA）',
      'mcp__github__create_pull_request': '创建 Pull Request',
      'mcp__github__create_repository': '在个人账号或指定组织下创建仓库',
      'mcp__github__delete_file': '删除仓库中的文件',
      'mcp__github__fork_repository': 'Fork 仓库到个人账号或指定组织',
      'mcp__github__get_commit': '获取某个提交的详情',
      'mcp__github__get_file_contents': '获取仓库文件或目录内容',
      'mcp__github__get_label': '获取仓库中的指定标签',
      'mcp__github__get_latest_release': '获取仓库最新的 Release',
      'mcp__github__get_me': '获取当前已认证的 GitHub 用户信息',
      'mcp__github__get_release_by_tag': '按 tag 获取指定 Release',
      'mcp__github__get_tag': '获取指定 git tag 的详情',
      'mcp__github__get_team_members': '获取组织中某团队的成员用户名',
      'mcp__github__get_teams': '列出当前用户所属的团队',
      'mcp__github__issue_read': '读取指定 Issue 的信息',
      'mcp__github__issue_write': '新建或更新 Issue',
      'mcp__github__list_branches': '列出仓库分支',
      'mcp__github__list_commits': '列出某分支的提交',
      'mcp__github__list_issue_fields': '列出仓库/组织的 Issue 字段定义',
      'mcp__github__list_issue_types': '列出仓库/组织支持的 Issue 类型',
      'mcp__github__list_issues': '列出仓库 Issue',
      'mcp__github__list_pull_requests': '列出仓库 Pull Request',
      'mcp__github__list_releases': '列出仓库 Release',
      'mcp__github__list_repository_collaborators': '列出仓库协作者（分页）',
      'mcp__github__list_tags': '列出仓库 git tag',
      'mcp__github__merge_pull_request': '合并 Pull Request',
      'mcp__github__pull_request_read': '读取指定 PR 的信息',
      'mcp__github__pull_request_review_write': '创建、提交或删除 PR 评审',
      'mcp__github__push_files': '在一次提交中推送多个文件',
      'mcp__github__request_copilot_review': '请求 Copilot 对 PR 做代码评审',
      'mcp__github__run_secret_scanning': '扫描文件/内容/差异中的密钥与凭据',
      'mcp__github__search_code': '使用 GitHub 原生引擎全站搜索代码',
      'mcp__github__search_commits': '按提交搜索语法搜索提交',
      'mcp__github__search_issues': '用自然语言语义匹配搜索 Issue',
      'mcp__github__search_pull_requests': '按 Issue 搜索语法搜索 Pull Request',
      'mcp__github__search_repositories': '按名称/描述/README/topic 搜索仓库',
      'mcp__github__search_users': '按用户名/姓名/资料搜索 GitHub 用户',
      'mcp__github__sub_issue_write': '给父 Issue 添加子 Issue',
      'mcp__github__ui_get': '获取 MCP 界面数据（标签、指派、里程碑、类型、分支、字段、评审人）',
      'mcp__github__update_issue_comment': '更新 Issue/PR 评论正文',
      'mcp__github__update_pull_request': '更新 Pull Request',
      'mcp__github__update_pull_request_branch': '用基分支的最新变更更新 PR 分支',
    }

    /** Name-token dictionary used to auto-generate a Chinese action name. */
    const TOOL_TOKEN_ZH = {
      add: '添加', create: '创建', get: '获取', list: '列出', search: '搜索', read: '读取',
      write: '写入', update: '更新', delete: '删除', remove: '删除', merge: '合并',
      issue: 'Issue', issues: 'Issues', pull: 'Pull', request: 'Request', comment: '评论',
      branch: '分支', branches: '分支', repository: '仓库', repositories: '仓库', repo: '仓库',
      file: '文件', files: '文件', dir: '目录', directory: '目录', contents: '内容',
      label: '标签', labels: '标签', release: 'Release', releases: 'Release', tag: 'tag', tags: 'tag',
      commit: '提交', commits: '提交', team: '团队', teams: '团队', members: '成员',
      user: '用户', users: '用户', fork: 'Fork', push: '推送', review: '评审', reviews: '评审',
      copilot: 'Copilot', secret: '密钥', scanning: '扫描', code: '代码', ui: '界面',
      resource: '资源', resources: '资源', template: '模板', templates: '模板', mcp: 'MCP',
      hindsight: 'Hindsight', memory: '记忆', knowledge: '知识', page: '页面', pages: '页面',
      sync: '同步', status: '状态', diagnose: '诊断', reflect: '反思推理', capture: '记录',
      initiative: '倡议', ingest: '写入', document: '文档', working: '工作', workspace: '工作区',
      dependencies: '依赖', load: '加载', run: '执行', exec: '执行', execute: '执行',
      fetch: '抓取', save: '保存', open: '打开', close: '关闭', think: '思考', plan: '规划',
      task: '任务', session: '会话', config: '配置', check: '检查', inspect: '检查', analyze: '分析',
    }

    /** Chinese one-liner: built-in map first, otherwise token-derived + 自动解析 note. */
    function toolChineseDescription(name, t) {
      const key = String(name || '')
      if (TOOL_ZH[key]) return TOOL_ZH[key]
      const tokens = key.replace(/^mcp__?/i, '').replace(/^github__?/i, '').replace(/^cordis_/i, '')
        .split(/[^A-Za-z0-9]+/).filter(function (token) { return !!token })
      const words = []
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i]
        words.push(TOOL_TOKEN_ZH[token.toLowerCase()] || token)
      }
      const auto = typeof t === 'function' ? t('autoParsed') : '（自动解析）'
      return (words.length > 0 ? words.join('') : key) + ' ' + auto
    }

    /** Chinese labels for lifecycle phases / plugin kinds / common event data keys. */
    const PHASE_LABEL_KEYS = {
      active: 'phaseActive', inactive: 'phaseInactive', pending: 'phasePending',
      unloading: 'phaseUnloading', failed: 'phaseFailed',
    }
    const PLUGIN_KIND_LABEL_KEYS = {
      official: 'kindOfficial', 'third-party': 'kindThirdParty', thirdparty: 'kindThirdParty',
      local: 'kindLocal', client: 'kindClient',
    }
    const EVENT_DATA_KEY_KEYS = {
      tool: 'dataKeyTool', callId: 'dataKeyCallId', argsPreview: 'dataKeyArgsPreview',
      resultPreview: 'dataKeyResultPreview', ok: 'dataKeyOk', ms: 'dataKeyMs', count: 'dataKeyCount',
      provider: 'dataKeyProvider', model: 'dataKeyModel', usage: 'dataKeyUsage', purpose: 'dataKeyPurpose',
      reason: 'dataKeyReason', source: 'dataKeySource', type: 'dataKeyType', seq: 'dataKeySeq',
      status: 'dataKeyStatus', organ: 'dataKeyOrgan', target: 'dataKeyTarget', label: 'dataKeyLabel',
      name: 'dataKeyName', kind: 'dataKeyKind', level: 'dataKeyLevel', sessionId: 'dataKeySessionId',
    }

    function localizedPhase(phase, t) {
      if (phase === undefined || phase === null || phase === '') return typeof t === 'function' ? t('none') : '—'
      const key = PHASE_LABEL_KEYS[String(phase).toLowerCase()]
      if (typeof t !== 'function') return String(phase)
      return t(key || 'phaseUnknown')
    }

    function localizedPluginKind(kind, t) {
      if (kind === undefined || kind === null || kind === '') return typeof t === 'function' ? t('none') : '—'
      const key = PLUGIN_KIND_LABEL_KEYS[String(kind).toLowerCase()]
      if (typeof t !== 'function') return String(kind)
      return t(key || 'kindOther')
    }

    /** Rows for the event `data` object: known keys get Chinese labels, unknown keep raw. */
    function eventDataRows(data, t) {
      if (!data || typeof data !== 'object') return []
      const keys = Object.keys(data)
      const rows = []
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]
        const value = data[key]
        const knownKey = EVENT_DATA_KEY_KEYS[key]
        const label = knownKey && typeof t === 'function' ? t(knownKey) : key
        let text = ''
        if (value === undefined || value === null) text = '—'
        else if (typeof value === 'string') text = value
        else if (typeof value === 'number' || typeof value === 'boolean') text = String(value)
        else text = safeJson(value, 200)
        rows.push({ key: key, label: label, value: text, localized: !!knownKey })
      }
      return rows
    }

    const MAX_EVENTS = 500
    const CALL_ROWS = 200
    const MAX_PARTICLES = 300
    const MAX_SPAWN_PER_BATCH = 12
    const SPARK_SAMPLES = 120
    const FLOW_WINDOW_MS = 120000
    const FLUSH_MS = 100
    const POLL_MS = 1200
    const RECONNECT_DELAYS = [1000, 2000, 5000, 10000]
    const THEME_FALLBACK = {
      bg: '#060b12', layer: '#0c141e', border: '#22303e', brand: '#3ee8ff', text: '#dff1ff',
      dim: '#7f93a8', ok: '#3ddc97', idle: '#7c8b9e', warn: '#ffc04d', error: '#ff5f6d',
    }

    // ---------------------------------------------------------------------
    // Small utilities — defensive by design: no throw ever escapes into a
    // render or into a frame callback.
    // ---------------------------------------------------------------------

    function safe(fn, fallback) {
      try {
        const value = fn()
        return value === undefined ? fallback : value
      } catch (error) {
        return fallback
      }
    }

    function clamp(value, min, max) {
      const n = Number(value)
      if (!Number.isFinite(n)) return min
      return n < min ? min : n > max ? max : n
    }

    function clamp01(value) {
      return clamp(value, 0, 1)
    }

    function num(value) {
      const n = Number(value)
      return Number.isFinite(n) ? n : 0
    }

    function fmtNum(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      const abs = Math.abs(n)
      if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M'
      if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'k'
      if (abs >= 100) return String(Math.round(n))
      if (abs >= 10) return String(Math.round(n * 10) / 10)
      return String(Math.round(n * 100) / 100)
    }

    function fmtMs(value) {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) return '—'
      if (n >= 1000) {
        const seconds = n / 1000
        return (seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10) + ' s'
      }
      return (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10) + ' ms'
    }

    /** Signed relative time with SI units ("+123 ms" / "-1.5 s"). */
    function fmtRelMs(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      const sign = n < 0 ? '-' : '+'
      const magnitude = fmtMs(Math.abs(n))
      return sign + (magnitude === '—' ? '0 ms' : magnitude)
    }

    function pad2(n) {
      return n < 10 ? '0' + n : String(n)
    }

    function fmtClock(epochMs) {
      const n = Number(epochMs)
      if (!Number.isFinite(n) || n <= 0) return '--:--:--'
      try {
        const d = new Date(n)
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
      } catch (error) {
        return '--:--:--'
      }
    }

    function fmtUptime(totalSec) {
      const n = Math.max(0, Math.floor(num(totalSec)))
      if (n < 60) return n + 's'
      const days = Math.floor(n / 86400)
      const hours = Math.floor((n % 86400) / 3600)
      const mins = Math.floor((n % 3600) / 60)
      if (days > 0) return days + 'd ' + hours + 'h'
      if (hours > 0) return hours + 'h ' + mins + 'm'
      return mins + 'm ' + (n % 60) + 's'
    }

    function withAlpha(color, alpha) {
      const raw = String(color === undefined || color === null ? '' : color).trim()
      const a = clamp01(alpha)
      const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw)
      if (short) {
        return 'rgba(' + parseInt(short[1] + short[1], 16) + ',' + parseInt(short[2] + short[2], 16) + ',' + parseInt(short[3] + short[3], 16) + ',' + a + ')'
      }
      const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(raw)
      if (long) {
        return 'rgba(' + parseInt(long[1], 16) + ',' + parseInt(long[2], 16) + ',' + parseInt(long[3], 16) + ',' + a + ')'
      }
      return raw
    }

    function hashText(text) {
      const s = String(text === undefined || text === null ? '' : text)
      let hash = 0
      for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) | 0
      return Math.abs(hash)
    }

    /** Coarse flow group for an event kind (edges, chips, call-log filter). */
    function kindGroup(kind) {
      const k = String(kind === undefined || kind === null ? '' : kind).toLowerCase()
      if (k.indexOf('tool') === 0 || k === 'tool.change') return 'tool'
      if (k.indexOf('llm') === 0) return 'llm'
      if (k.indexOf('fs') === 0) return 'fs'
      if (k.indexOf('approval') === 0 || k.indexOf('question') === 0 || k.indexOf('credentials') === 0 || k.indexOf('auth') === 0) return 'approval'
      if (k === 'error' || k.indexOf('error') === 0) return 'error'
      if (k.indexOf('plugin') === 0 || k.indexOf('hmr') === 0 || k.indexOf('settings') === 0) return 'plugin'
      if (k.indexOf('session') === 0 || k.indexOf('agent') === 0 || k.indexOf('subagent') === 0
        || k.indexOf('workflow') === 0 || k.indexOf('goal') === 0 || k.indexOf('schedule') === 0
        || k.indexOf('skill') === 0 || k.indexOf('domain') === 0) return 'session'
      return 'other'
    }

    function kindColor(kind) {
      return FLOW_COLORS[kindGroup(kind)] || FLOW_COLORS.other
    }

    function statusColorVar(status) {
      if (status === 'active') return 'var(--dsw-alias-state-success-primary, #3ddc97)'
      if (status === 'warn') return 'var(--dsw-alias-state-warn-primary, #ffc04d)'
      if (status === 'error') return 'var(--dsw-alias-state-error-primary, #ff5f6d)'
      if (status === 'offline') return 'var(--dsw-alias-label-secondary, #55606e)'
      return 'var(--dsw-alias-state-idle-primary, #7c8b9e)'
    }

    function statusColorHex(status, colors) {
      const c = colors || THEME_FALLBACK
      if (status === 'active') return c.ok
      if (status === 'warn') return c.warn
      if (status === 'error') return c.error
      if (status === 'offline') return '#55606e'
      return c.idle
    }

    function statusLabelKey(status) {
      if (status === 'active') return 'statusActive'
      if (status === 'warn') return 'statusWarn'
      if (status === 'error') return 'statusError'
      if (status === 'offline') return 'statusOffline'
      return 'statusIdle'
    }

    function directoryBase(raw) {
      let value = ''
      try {
        value = typeof raw === 'string' ? raw : ''
      } catch (error) {
        value = ''
      }
      if (!value) value = '/'
      try {
        const url = new URL(value)
        url.search = ''
        url.hash = ''
        if (!url.pathname.endsWith('/')) url.pathname += '/'
        return url.href
      } catch (error) {
        return value.endsWith('/') ? value : value + '/'
      }
    }

    function pageBase() {
      const fromDocument = safe(() => (typeof document !== 'undefined' ? document.baseURI : ''), '')
      if (fromDocument) return fromDocument
      const fromLocation = safe(() => (typeof location !== 'undefined' ? location.href : ''), '')
      return fromLocation || '/'
    }

    /**
     * Preferred API base: the Host's real origin.
     *
     * The Desktop shell serves the page from the custom `dsh-app://app/` scheme
     * and forwards non-static paths to the Host. That forward can resolve the
     * fetch while never delivering a streamed body, and a custom scheme is a
     * fragile transport for long-lived NDJSON. The shell publishes the Host's
     * real origin on `__DSH_TRANSPORT__.streamBaseUrl`, so use it (http/https
     * only) whenever present — the Host's anatomy routes send
     * `access-control-allow-origin: *`, so this works cross-origin too. Plain
     * http(s) pages keep the page-relative base so reverse-proxy prefixes apply.
     */
    function transportBase() {
      const transport = safe(function () {
        return typeof window !== 'undefined' && window && window.__DSH_TRANSPORT__ ? window.__DSH_TRANSPORT__ : null
      }, null)
      const base = transport && typeof transport.streamBaseUrl === 'string' ? transport.streamBaseUrl : ''
      return /^https?:\/\//i.test(base) ? base : ''
    }

    function apiBase() {
      return transportBase() || pageBase()
    }

    function apiUrl(path) {
      return new URL(path, directoryBase(apiBase())).href
    }

    /** Resolve the theme tokens the canvas needs concrete values for. */
    /** Luminance (0..1) of a CSS color string; null when unparseable. */
    function colorToLuminance(value) {
      if (typeof value !== 'string') return null
      const text = value.trim().toLowerCase()
      if (!text) return null
      let r = null
      let g = null
      let b = null
      if (text.charAt(0) === '#') {
        const hex = text.slice(1)
        if (hex.length === 3 || hex.length === 4) {
          r = parseInt(hex.charAt(0) + hex.charAt(0), 16)
          g = parseInt(hex.charAt(1) + hex.charAt(1), 16)
          b = parseInt(hex.charAt(2) + hex.charAt(2), 16)
        } else if (hex.length === 6 || hex.length === 8) {
          r = parseInt(hex.slice(0, 2), 16)
          g = parseInt(hex.slice(2, 4), 16)
          b = parseInt(hex.slice(4, 6), 16)
        }
      } else {
        const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(text)
        if (match) {
          r = parseFloat(match[1])
          g = parseFloat(match[2])
          b = parseFloat(match[3])
        }
      }
      if (r === null || g === null || b === null || Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
      return clamp01((0.2126 * clamp(r, 0, 255) + 0.7152 * clamp(g, 0, 255) + 0.0722 * clamp(b, 0, 255)) / 255)
    }

    /**
     * Dark/light theme detection: theme API isDark() first, then the host
     * document attributes (data-ds-dark-theme / theme snapshot), finally the
     * luminance of --dsw-alias-bg-base. Defaults to dark to preserve the
     * architecture stage look.
     */
    function resolveThemeDark(themeApi) {
      try {
        if (themeApi && typeof themeApi.isDark === 'function') {
          const flag = themeApi.isDark()
          if (flag === true || flag === false) return flag
        }
      } catch (error) {
        // fall through to DOM detection
      }
      try {
        if (typeof document !== 'undefined' && document.documentElement) {
          const element = document.documentElement
          if (typeof element.getAttribute === 'function') {
            const attr = element.getAttribute('data-ds-dark-theme') || element.getAttribute('data-dark-theme')
              || element.getAttribute('data-theme') || element.getAttribute('data-color-scheme')
            if (attr !== null && attr !== undefined) {
              const value = String(attr).toLowerCase()
              if (value === 'true' || value === 'dark' || value === '1') return true
              if (value === 'false' || value === 'light' || value === '0') return false
            }
          }
          const dataset = element.dataset
          if (dataset) {
            if (dataset.dsDarkTheme !== undefined) return String(dataset.dsDarkTheme) !== 'false'
            if (dataset.darkTheme !== undefined) return String(dataset.darkTheme) !== 'false'
            if (dataset.theme !== undefined) return String(dataset.theme).toLowerCase().indexOf('dark') >= 0
          }
          const raw = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(element).getPropertyValue('--dsw-alias-bg-base')
            : ''
          const luminance = colorToLuminance(raw)
          if (luminance !== null) return luminance < 0.5
        }
      } catch (error) {
        // ignore
      }
      return true
    }

    const WHEEL_GUARD_SELECTOR = '.da-drawer, .da-calldetail, .da-legend, .da-help, .da-help-backdrop, .da-popover, .da-zoomctl, .da-console, .da-timeline, .da-drawer-cards, .da-drawer-body, .da-empty-overlay, [data-wheel-scroll]'

    /**
     * True when a wheel event target belongs to an interactive overlay or a
     * scrollable container — those must scroll natively instead of zooming the
     * stage. Pure/DOM-tolerant so it is unit-testable.
     */
    function shouldIgnoreStageWheel(target, boundary) {
      if (!target || typeof target !== 'object') return false
      if (typeof target.closest === 'function') {
        let hit = null
        try {
          hit = target.closest(WHEEL_GUARD_SELECTOR)
        } catch (error) {
          hit = null
        }
        if (hit) {
          if (!boundary || typeof boundary.contains !== 'function') return true
          let inside = false
          try {
            inside = boundary.contains(hit) === true
          } catch (error) {
            inside = false
          }
          return inside
        }
      }
      let node = target
      let depth = 0
      while (node && node !== boundary && depth < 32) {
        if (typeof node.getAttribute === 'function' && node.getAttribute('data-wheel-scroll') !== null) return true
        try {
          if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const style = window.getComputedStyle(node)
            const overflowY = String(style && (style.overflowY || style.overflow) || '')
            if ((overflowY === 'auto' || overflowY === 'scroll') && num(node.scrollHeight) > num(node.clientHeight) + 1) return true
          }
        } catch (error) {
          // ignore detached nodes
        }
        node = node.parentElement
        depth += 1
      }
      return false
    }

    /** True when a stage click lands on a node/edge/control (not blank canvas). */
    function isStageInteractiveTarget(target) {
      if (!target || typeof target.closest !== 'function') return false
      try {
        return target.closest('button, .da-node, .da-tool-card, .da-edge-flow, .da-edge-label-bg, .da-flow-dot, .da-legend, .da-legend-toggle, .da-calldetail, .da-zoomctl, .da-help, .da-help-backdrop, .da-popover, input, textarea, select') !== null
      } catch (error) {
        return false
      }
    }

    /** Drawer breadcrumb like “工具调用视图 › 工具详情”. */
    function selectionBreadcrumb(selection, view, t) {
      const viewLabel = view === 'tools' ? t('viewTools') : t('viewDomains')
      const detailKeys = {
        domain: 'domainDetail', plugin: 'pluginDetail', service: 'serviceDetail',
        tool: 'toolDetail', event: 'eventDetail', edge: 'edgeDetail',
        clientBundle: 'clientBundleDetail', model: 'modelDetail',
      }
      const detailKey = selection && detailKeys[selection.type] ? detailKeys[selection.type] : 'overview'
      return viewLabel + ' › ' + t(detailKey)
    }

    /** Back button label: history-aware, never changes the view mode. */
    function selectionBackLabel(selection, view, historyDepth, t) {
      if (historyDepth > 0) return t('backPrevious')
      return view === 'tools' ? t('backTools') : t('backDomains')
    }

    /** Activity window for "running" (ms since the last observed event). */
    const RUNNING_WINDOW_MS = 15000

    /**
     * Runtime status precedence: waiting data → paused → offline/reconnecting →
     * running (last event within 15s) → idle but connected.
     */
    function deriveRuntimeStatus(input) {
      const state = input && typeof input === 'object' ? input : {}
      const now = num(state.now) || Date.now()
      const lastEventAt = num(state.lastEventAt)
      if (!state.snapshot) {
        return { key: 'waiting', labelKey: 'statusWaiting', running: false, active: false }
      }
      if (state.paused === true) {
        return { key: 'paused', labelKey: 'statusPaused', running: false, active: false }
      }
      if (state.conn !== undefined && state.conn !== 'live') {
        const reconnecting = state.conn === 'reconnecting' || state.conn === 'connecting'
        return {
          key: reconnecting ? 'reconnecting' : 'offline',
          labelKey: reconnecting ? 'statusReconnecting' : 'statusOffline',
          running: false,
          active: false,
        }
      }
      const active = lastEventAt > 0 && now - lastEventAt <= RUNNING_WINDOW_MS
      return active
        ? { key: 'running', labelKey: 'statusRunning', running: true, active: true }
        : { key: 'idleConnected', labelKey: 'statusIdleConnected', running: false, active: false }
    }

    /** Human label for "last event x seconds ago". */
    function formatLastEventLabel(lastEventAt, now, t) {
      const stamp = num(lastEventAt)
      const current = num(now) || Date.now()
      if (!stamp) return t('statusNoEvents')
      const elapsed = Math.max(0, current - stamp)
      if (elapsed < 1000) return t('justNowShort')
      const seconds = Math.round(elapsed / 1000)
      return seconds + t('secondsAgo')
    }

    /**
     * Merge snapshot frames. A full snapshot wins over later lite frames; lite
     * frames only replace older lite frames (seq/generatedAt ordering).
     */
    function applySnapshotState(previous, incoming) {
      const prev = previous && typeof previous === 'object'
        ? previous
        : { snapshot: null, fullSnapshot: false, lite: false }
      if (!incoming || typeof incoming !== 'object') return { state: prev, changed: false }
      const lite = incoming.lite === true
      if (prev.fullSnapshot && lite) return { state: prev, changed: false }
      if (lite) {
        const prevSeq = num(prev.snapshot && prev.snapshot.seq)
        const nextSeq = num(incoming.seq)
        if (prev.lite && prevSeq > 0 && nextSeq > 0 && nextSeq < prevSeq) return { state: prev, changed: false }
        return { state: { snapshot: incoming, fullSnapshot: false, lite: true }, changed: true }
      }
      return { state: { snapshot: incoming, fullSnapshot: true, lite: false }, changed: true }
    }

    /**
     * Simplified diagrams.net-style edge: one moderate cubic between anchors.
     * Side choice: |dx| >= |dy| → left/right, else top/bottom. Control offset
     * along the main axis = clamp(0.5 * axis distance, 40, 160).
     */
    function simpleEdgeRoute(start, end) {
      const dx = num(end.x) - num(start.x)
      const dy = num(end.y) - num(start.y)
      const horizontal = Math.abs(dx) >= Math.abs(dy)
      const distance = clamp((horizontal ? Math.abs(dx) : Math.abs(dy)) * 0.5, 40, 160)
      const startSide = horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
      const endSide = horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom')
      const outStart = sideOutwardVector(startSide)
      const outEnd = sideOutwardVector(endSide)
      return routeFromControls({
        x1: num(start.x), y1: num(start.y),
        c1x: round1(num(start.x) + outStart.x * distance), c1y: round1(num(start.y) + outStart.y * distance),
        c2x: round1(num(end.x) + outEnd.x * distance), c2y: round1(num(end.y) + outEnd.y * distance),
        x2: num(end.x), y2: num(end.y),
      })
    }

    /** Cubic between two explicitly chosen anchor sides (0.5 ratio, 40–160). */
    function sidedEdgeRoute(start, startSide, end, endSide) {
      const dx = num(end.x) - num(start.x)
      const dy = num(end.y) - num(start.y)
      const horizontal = (startSide === 'left' || startSide === 'right') && (endSide === 'left' || endSide === 'right')
      const vertical = (startSide === 'top' || startSide === 'bottom') && (endSide === 'top' || endSide === 'bottom')
      const axis = horizontal ? Math.abs(dx) : (vertical ? Math.abs(dy) : Math.max(Math.abs(dx), Math.abs(dy)) * 0.75)
      const distance = clamp(axis * 0.5, 40, 160)
      const outStart = sideOutwardVector(startSide)
      const outEnd = sideOutwardVector(endSide)
      return routeFromControls({
        x1: num(start.x), y1: num(start.y),
        c1x: round1(num(start.x) + outStart.x * distance), c1y: round1(num(start.y) + outStart.y * distance),
        c2x: round1(num(end.x) + outEnd.x * distance), c2y: round1(num(end.y) + outEnd.y * distance),
        x2: num(end.x), y2: num(end.y),
      })
    }

    /** Intersection length + minimum card clearance + path length for scoring. */
    function edgeObstacleStats(route, rects) {
      const points = pathPoints(route)
      const list = Array.isArray(rects) ? rects : []
      const length = routeLength(route)
      if (points.length < 2 || list.length === 0) return { intersectLength: 0, minGap: Infinity, length: length }
      const spacing = length / (points.length - 1)
      let intersectLength = 0
      let minGap = Infinity
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i]
        let inside = false
        for (let r = 0; r < list.length; r += 1) {
          const rect = list[r]
          if (point.x > rect.x1 && point.x < rect.x2 && point.y > rect.y1 && point.y < rect.y2) {
            inside = true
            break
          }
          const gapX = point.x < rect.x1 ? rect.x1 - point.x : (point.x > rect.x2 ? point.x - rect.x2 : 0)
          const gapY = point.y < rect.y1 ? rect.y1 - point.y : (point.y > rect.y2 ? point.y - rect.y2 : 0)
          const gap = Math.hypot(gapX, gapY)
          if (gap < minGap) minGap = gap
        }
        if (inside) {
          intersectLength += spacing
          minGap = 0
        }
      }
      return { intersectLength: round1(intersectLength), minGap: minGap === Infinity ? Infinity : round1(minGap), length: round1(length) }
    }

    /** Candidate curves for local avoidance (baseline + side swaps + normal offsets). */
    function edgeAvoidanceCandidates(start, end, rects) {
      const obstacles = Array.isArray(rects) ? rects : []
      const baseline = simpleEdgeRoute(start, end)
      const dx = num(end.x) - num(start.x)
      const dy = num(end.y) - num(start.y)
      const horizontal = Math.abs(dx) >= Math.abs(dy)
      const primaryStart = horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
      const primaryEnd = horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom')
      const pairs = horizontal
        ? [[primaryStart, primaryEnd], ['right', 'left'], ['right', 'top'], ['bottom', 'left']]
        : [[primaryStart, primaryEnd], ['bottom', 'top'], ['bottom', 'right'], ['left', 'top']]
      const candidates = [baseline]
      const seen = Object.create(null)
      seen[primaryStart + '>' + primaryEnd] = true
      for (let i = 0; i < pairs.length; i += 1) {
        const key = pairs[i][0] + '>' + pairs[i][1]
        if (seen[key]) continue
        seen[key] = true
        candidates.push(sidedEdgeRoute(start, pairs[i][0], end, pairs[i][1]))
        if (candidates.length >= 4) break
      }
      const length = Math.hypot(dx, dy) || 1
      const nx = -dy / length
      const ny = dx / length
      const base = baseline.controls
      const offsets = [20, -20, 35, -35, 55, -55, 75, -75]
      for (let i = 0; i < offsets.length && candidates.length < 12; i += 1) {
        const offset = offsets[i]
        candidates.push(routeFromControls({
          x1: base.x1, y1: base.y1,
          c1x: round1(base.c1x + nx * offset), c1y: round1(base.c1y + ny * offset),
          c2x: round1(base.c2x + nx * offset), c2y: round1(base.c2y + ny * offset),
          x2: base.x2, y2: base.y2,
        }))
      }
      return candidates.slice(0, 12)
    }

    /** Pick a natural cubic with local avoidance; never falls back to gutter lanes. */
    function lightEdgeRoute(start, end, rects) {
      const obstacles = Array.isArray(rects) ? rects : []
      if (obstacles.length === 0) return simpleEdgeRoute(start, end)
      const candidates = edgeAvoidanceCandidates(start, end, obstacles)
      let best = candidates[0]
      let bestScore = Infinity
      let bestClear = null
      let bestClearGap = -Infinity
      for (let i = 0; i < candidates.length; i += 1) {
        const stats = edgeObstacleStats(candidates[i], obstacles)
        if (stats.intersectLength === 0 && stats.minGap >= 8) {
          const score = stats.length * 0.02 - Math.min(8, stats.minGap) * 0.5
          if (score < bestScore - 1e-6) {
            bestScore = score
            best = candidates[i]
            bestClear = candidates[i]
            bestClearGap = stats.minGap
          }
        }
      }
      if (bestClear) return bestClear
      // No fully clear candidate: keep the fewest-intersections option.
      let least = candidates[0]
      let leastIntersect = Infinity
      let leastLength = Infinity
      for (let i = 0; i < candidates.length; i += 1) {
        const stats = edgeObstacleStats(candidates[i], obstacles)
        if (stats.intersectLength < leastIntersect - 1e-6
          || (Math.abs(stats.intersectLength - leastIntersect) < 1e-6 && stats.length < leastLength)) {
          least = candidates[i]
          leastIntersect = stats.intersectLength
          leastLength = stats.length
        }
      }
      return least
    }

    /** Filter events down to one session ('' / missing id = all sessions). */
    function filterEventsBySession(events, sessionId) {
      const list = Array.isArray(events) ? events : []
      const wanted = String(sessionId || '')
      if (!wanted) return list
      return list.filter(function (event) {
        return event && String(event.sessionId || '') === wanted
      })
    }

    /** Sessions from the Host snapshot (or derived from event sessionIds). */
    function deriveSessions(snapshot, events, limit) {
      const cap = typeof limit === 'number' ? limit : 24
      const snapshotSessions = snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions : []
      const activeId = snapshot && snapshot.activeSessionId ? String(snapshot.activeSessionId) : ''
      const seen = Object.create(null)
      const rows = []
      for (let i = 0; i < snapshotSessions.length; i += 1) {
        const item = snapshotSessions[i]
        const id = item && (item.id || item.sessionId)
        if (!id || seen[String(id)]) continue
        seen[String(id)] = true
        rows.push({
          id: String(id),
          title: String(item.title || item.name || String(id).slice(0, 8)),
          active: String(id) === activeId || item.active === true,
        })
      }
      const eventList = Array.isArray(events) ? events : []
      for (let i = eventList.length - 1; i >= 0; i -= 1) {
        const sid = eventList[i] && eventList[i].sessionId ? String(eventList[i].sessionId) : ''
        if (!sid || seen[sid]) continue
        seen[sid] = true
        rows.push({ id: sid, title: sid.slice(0, 8), active: sid === activeId })
      }
      return rows.slice(0, cap)
    }

    /** Session-scoped live metrics from the filtered event window. */
    function deriveSessionMetrics(events, windowMs, now) {
      const span = typeof windowMs === 'number' ? windowMs : FLOW_WINDOW_MS
      const current = num(now) || Date.now()
      const cutoff = current - span
      const list = Array.isArray(events) ? events : []
      let eventsCount = 0
      let tools = 0
      let llms = 0
      let errors = 0
      let msSum = 0
      let msCount = 0
      let tokens = 0
      for (let i = 0; i < list.length; i += 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (at > 0 && at < cutoff) continue
        eventsCount += 1
        const group = kindGroup(event.kind)
        if (group === 'tool') tools += 1
        if (group === 'llm') llms += 1
        if (event.ok === false || event.level === 'error') errors += 1
        const ms = num(event.ms)
        if (ms > 0) {
          msSum += ms
          msCount += 1
        }
        const data = event.data && typeof event.data === 'object' ? event.data : null
        const usage = data && data.usage && typeof data.usage === 'object' ? data.usage : null
        if (usage) tokens += num(usage.input !== undefined ? usage.input : usage.promptTokens) + num(usage.output !== undefined ? usage.output : usage.completionTokens)
      }
      const minutes = span / 60000
      const seconds = span / 1000
      return {
        eventsPerSec: eventsCount / Math.max(1, seconds),
        toolCallsPerMin: tools / Math.max(0.0001, minutes),
        llmCallsPerMin: llms / Math.max(0.0001, minutes),
        tokensPerMin: tokens / Math.max(0.0001, minutes),
        errorsPerMin: errors / Math.max(0.0001, minutes),
        avgMs: msCount > 0 ? msSum / msCount : 0,
      }
    }

    /** Compact first-paint timing label shown in the corner status block. */
    function formatPaintTimings(firstFrameMs, detailMs, t) {
      const first = num(firstFrameMs)
      const detail = num(detailMs)
      const parts = []
      if (first > 0) parts.push(t('firstPaint') + ' ' + Math.round(first) + ' ms')
      if (detail > 0) parts.push(t('detailPaint') + ' ' + Math.round(detail) + ' ms')
      return parts.join(' · ')
    }

    /** Session id shown by the right-sidebar controller (string or object). */
    function rightMountedSessionId(right) {
      if (!right || !right.mounted || typeof right.mounted.getSnapshot !== 'function') return ''
      const value = safe(function () { return right.mounted.getSnapshot() }, null)
      if (typeof value === 'string') return value
      if (value && typeof value === 'object') return String(value.id || value.sessionId || '')
      return ''
    }

    /** Existing anatomy tab for this session (dedupe before openTab). */
    function hasOpenAnatomyTab(openTabsSnapshot, sessionId, kind) {
      const rows = Array.isArray(openTabsSnapshot) ? openTabsSnapshot : []
      const wantedKind = String(kind || 'anatomy')
      const wantedSession = String(sessionId || '')
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]
        if (!row || String(row.kind || '') !== wantedKind) continue
        if (!wantedSession || String(row.sessionId || '') === wantedSession) return true
      }
      return false
    }

    /** Open (or focus) the architecture tab without multiplying tabs. */
    function ensureAnatomyTab(right, kind) {
      const wantedKind = String(kind || 'anatomy')
      if (!right || typeof right.openTab !== 'function') return false
      const sessionId = rightMountedSessionId(right)
      let rows = []
      try {
        rows = right.openTabs && typeof right.openTabs.getSnapshot === 'function' ? right.openTabs.getSnapshot() : []
      } catch (error) {
        rows = []
      }
      if (hasOpenAnatomyTab(rows, sessionId, wantedKind)) {
        const row = (rows || []).find(function (item) { return item && String(item.kind) === wantedKind && (!sessionId || String(item.sessionId) === sessionId) })
        const tabId = row && (row.tabId || row.id)
        if (tabId && typeof right.focus === 'function') {
          try { right.focus(tabId) } catch (error) { /* ignore */ }
        }
        return false
      }
      try { right.openTab(wantedKind) } catch (error) { return false }
      return true
    }

    const RIGHT_RETRY_MS = 400
    const RIGHT_TIMEOUT_MS = 60000

    /** Resolve both optional right-sidebar services, or null when not ready. */
    function rightSidebarServices(ctx) {
      return safe(function () {
        if (!ctx || typeof ctx.get !== 'function') return null
        const tabs = ctx.get('sidebarRightTabs')
        const right = ctx.get('sidebarRight')
        if (tabs && typeof tabs.register === 'function' && right && typeof right.openTab === 'function') {
          return { tabs: tabs, right: right }
        }
        return null
      }, null)
    }

    /**
     * Idempotently register the tab type, body/title slots and header.utilities
     * entry. Returns true once registered, false while services are unavailable.
     */
    function registerRightSidebarSeat(ctx, t, anatomyTheme, state) {
      const seat = rightSidebarServices(ctx)
      if (!seat || !state || typeof state !== 'object') return false
      if (state.registered) return true
      const disposers = Array.isArray(state.disposers) ? state.disposers : []
      state.disposers = disposers
      const push = function (disposer) {
        if (typeof disposer === 'function') disposers.push(disposer)
      }
      try {
        state.registered = true
        push(seat.tabs.register({
          id: ANATOMY_TAB_ID,
          kind: ANATOMY_TAB_KIND,
          keepMounted: true,
          title: function () { return t('panel') },
          guide: [{ id: 'anatomy', order: 20, title: function () { return t('panel') } }],
        }))
        push(ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: ANATOMY_TAB_ID,
            locale: NS,
            inject: function () { return { t: t, anatomyTheme: anatomyTheme, sidebarRight: seat.right } },
          }, RightPanel)
        }))
        push(ctx.slots.inject('sidebar.right.pane.tab.title', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: ANATOMY_TAB_ID,
            locale: NS,
            inject: function () { return { t: t } },
          }, AnatomyTabTitle)
        }))
        push(ctx.slots.inject('conversation.session.header.utilities', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'dsh-anatomy:open',
            order: 20,
            registrant: 'dsh-anatomy',
            inject: function () { return { t: t, sidebarRight: seat.right } },
          }, OpenButton)
        }))
        return true
      } catch (error) {
        state.registered = false
        for (let i = disposers.length - 1; i >= 0; i -= 1) {
          try { disposers[i]() } catch (disposeError) { /* ignore */ }
        }
        disposers.length = 0
        return false
      }
    }

    function readThemeColors() {
      const read = (name, fallback) => {
        const value = safe(() => {
          if (typeof document === 'undefined' || !document.documentElement) return ''
          return getComputedStyle(document.documentElement).getPropertyValue(name)
        }, '')
        return typeof value === 'string' && value.trim() ? value.trim() : fallback
      }
      return {
        bg: read('--dsw-alias-bg-base', THEME_FALLBACK.bg),
        layer: read('--dsw-alias-bg-layer-1', THEME_FALLBACK.layer),
        border: read('--dsw-alias-border-l1', THEME_FALLBACK.border),
        brand: read('--dsw-alias-brand-primary', THEME_FALLBACK.brand),
        text: read('--dsw-alias-label-primary', THEME_FALLBACK.text),
        dim: read('--dsw-alias-label-secondary', THEME_FALLBACK.dim),
        ok: read('--dsw-alias-state-success-primary', THEME_FALLBACK.ok),
        idle: read('--dsw-alias-state-idle-primary', THEME_FALLBACK.idle),
        warn: read('--dsw-alias-state-warn-primary', THEME_FALLBACK.warn),
        error: read('--dsw-alias-state-error-primary', THEME_FALLBACK.error),
      }
    }

    function isZhLocale(t) {
      const probe = safe(() => (typeof t === 'function' ? t('panel') : ''), '')
      return /[\u3400-\u9fff]/.test(String(probe || ''))
    }

    function safeJson(value, maxLength) {
      const cap = typeof maxLength === 'number' ? maxLength : 240
      try {
        const text = JSON.stringify(value)
        if (typeof text !== 'string') return ''
        return text.length > cap ? text.slice(0, cap) + '…' : text
      } catch (error) {
        return ''
      }
    }

    function curveControl(ax, ay, bx, by, seed) {
      const dx = bx - ax
      const dy = by - ay
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const size = clamp(dist * 0.14, 6, 54)
      const direction = (seed % 2 === 0 ? 1 : -1) * (0.55 + ((seed % 7) / 7) * 0.45)
      const offset = size * direction
      return { x: (ax + bx) / 2 + (-dy / dist) * offset, y: (ay + by) / 2 + (dx / dist) * offset }
    }

    function buildNodeMap(list) {
      const map = Object.create(null)
      const source = Array.isArray(list) && list.length > 0 ? list : DOMAIN_DEFS
      for (const node of source) {
        if (!node || typeof node.id !== 'string') continue
        map[node.id] = node
      }
      return map
    }

    /** Static canvas node table (id + diagram position + orbit size). */
    const NODE_FALLBACK = DOMAIN_DEFS.map(function (def) {
      return { id: def.id, x: def.x, y: def.y, size: NODE_ENGINE_SIZE }
    })

    /** Merge the Host snapshot's per-domain data onto the architecture table. */
    function nodeViews(snapshotOrgans) {
      const byId = Object.create(null)
      const source = Array.isArray(snapshotOrgans) ? snapshotOrgans : []
      for (const item of source) {
        if (item && typeof item.id === 'string') byId[item.id] = item
      }
      return DOMAIN_DEFS.map(function (def) {
        const view = byId[def.id]
        return {
          id: def.id, layer: def.layer, x: def.x, y: def.y,
          zh: def.zh, en: def.en, subZh: def.subZh, subEn: def.subEn, descZh: def.descZh, descEn: def.descEn,
          status: view && typeof view.status === 'string' ? view.status : 'offline',
          intensity: view ? clamp01(num(view.intensity)) : 0,
          plugins: view && Array.isArray(view.plugins) ? view.plugins : [],
          services: view && Array.isArray(view.services) ? view.services : [],
          tools: view && Array.isArray(view.tools) ? view.tools : [],
          agents: view ? num(view.agents) : 0,
          metrics: view && view.metrics && typeof view.metrics === 'object' ? view.metrics : {},
        }
      })
    }

    function domainTitle(def, zh) {
      if (!def) return ''
      if (zh) return def.zh || def.en || ''
      return def.en || def.zh || ''
    }

    function domainSubtitle(def, zh) {
      if (!def) return ''
      if (zh) return def.subZh || def.subEn || ''
      return def.subEn || def.subZh || ''
    }

    function domainDesc(def, zh) {
      if (!def) return ''
      if (zh) return def.descZh || def.descEn || ''
      return def.descEn || def.descZh || ''
    }

    function nodeActivity(node, heat, flowNodes) {
      const id = node && node.id ? node.id : ''
      const heatValue = heat && heat[id] ? num(heat[id]) : 0
      const rate = flowNodes && flowNodes[id] ? num(flowNodes[id]) : 0
      const metricsRate = node && node.metrics ? num(node.metrics.eventsPerMin) : 0
      return clamp01(Math.max(heatValue, Math.min(1, rate / 18), Math.min(1, metricsRate / 30)))
    }

    /**
     * Aggregate the last 60s of TraceEvents into per-pair flow + per-node rates.
     * Events are appended in time order, so the reverse scan stops at the first
     * event older than the window.
     */
    function computeFlows(events, windowMs) {
      const cutoff = Date.now() - (typeof windowMs === 'number' ? windowMs : FLOW_WINDOW_MS)
      const pairs = Object.create(null)
      const nodes = Object.create(null)
      const list = Array.isArray(events) ? events : []
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (at > 0 && at < cutoff) break
        const from = typeof event.organ === 'string' ? event.organ : ''
        const to = typeof event.target === 'string' && event.target !== '' && event.target !== from ? event.target : ''
        if (from) nodes[from] = (nodes[from] || 0) + 1
        if (to) nodes[to] = (nodes[to] || 0) + 1
        if (!from || !to) continue
        const key = from + '>' + to
        let row = pairs[key]
        if (!row) {
          row = { from: from, to: to, count: 0, errors: 0, ms: 0, groups: Object.create(null), labels: Object.create(null), kinds: Object.create(null) }
          pairs[key] = row
        }
        row.count += 1
        const group = kindGroup(event.kind)
        row.groups[group] = (row.groups[group] || 0) + 1
        const data = event.data && typeof event.data === 'object' ? event.data : null
        const label = data && typeof data.tool === 'string' && data.tool ? data.tool : String(event.label || event.kind || '')
        row.labels[label] = (row.labels[label] || 0) + 1
        const kind = String(event.kind || '')
        row.kinds[kind] = (row.kinds[kind] || 0) + 1
        if (event.ok === false || event.level === 'error') row.errors += 1
        row.ms += num(event.ms)
      }
      return { pairs: pairs, nodes: nodes }
    }

    /** Cap for the tool-call view node list. */
    const TOOL_VIEW_LIMIT = 24

    /** Border intersection of a node box toward a target point. */
    function rectAnchor(node, target, width, height) {
      const hw = width / 2
      const hh = height / 2
      const x = num(node.x)
      const y = num(node.y)
      const dx = num(target.x) - x
      const dy = num(target.y) - y
      if (dx === 0 && dy === 0) return { x: x, y: y }
      const scaleX = dx === 0 ? Infinity : hw / Math.abs(dx)
      const scaleY = dy === 0 ? Infinity : hh / Math.abs(dy)
      const ratio = Math.min(scaleX, scaleY)
      return { x: x + dx * ratio, y: y + dy * ratio }
    }

    /** Evenly spread n anchor offsets across [-span/2, +span/2]. */
    function spreadOffsets(count, span) {
      const n = Math.max(1, Math.floor(num(count)))
      const width = Math.max(0, num(span))
      const out = []
      if (n === 1) {
        out.push(0)
        return out
      }
      for (let i = 0; i < n; i += 1) out.push(-width / 2 + (width * i) / (n - 1))
      return out
    }

    /** Round to 1 decimal for compact SVG path strings. */
    function round1(value) {
      return Math.round(num(value) * 10) / 10
    }

    /**
     * Smooth cubic Bézier with horizontal tangents at both endpoints (a gentle
     * S-curve), plus a label anchor at the curve midpoint. `bend` offsets both
     * control points vertically so paired A→B / B→A edges never overlap.
     */
    function bezierRoute(ax, ay, bx, by, bend) {
      const x1 = round1(ax)
      const y1 = round1(ay)
      const x2 = round1(bx)
      const y2 = round1(by)
      const dx = x2 - x1
      const offset = num(bend)
      if (Math.abs(dx) < 48) {
        // Same-column pair: vertical tangents; `bend` shifts the control points
        // sideways so the two directions of a back-and-forth still separate.
        const midY = round1((y1 + y2) / 2)
        return {
          d: 'M ' + x1 + ' ' + y1 + ' C ' + round1(x1 + offset) + ' ' + midY + ' ' + round1(x2 + offset) + ' ' + midY + ' ' + x2 + ' ' + y2,
          mid: { x: round1((x1 + x2) / 2 + offset / 2), y: midY },
        }
      }
      const c1x = round1(x1 + dx * 0.42)
      const c2x = round1(x2 - dx * 0.42)
      const c1y = round1(y1 + offset)
      const c2y = round1(y2 + offset)
      return {
        d: 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + x2 + ' ' + y2,
        mid: {
          x: round1(0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2),
          y: round1(0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2),
        },
      }
    }

    /** Cubic Bézier control points (shared by the SVG path and the dot engine). */
    function bezierControls(ax, ay, bx, by, bend) {
      const x1 = num(ax)
      const y1 = num(ay)
      const x2 = num(bx)
      const y2 = num(by)
      const offset = num(bend)
      const dx = x2 - x1
      if (Math.abs(dx) < 48) {
        const midY = (y1 + y2) / 2
        return { x1: x1, y1: y1, c1x: x1 + offset, c1y: midY, c2x: x2 + offset, c2y: midY, x2: x2, y2: y2 }
      }
      return {
        x1: x1, y1: y1,
        c1x: x1 + dx * 0.42, c1y: y1 + offset,
        c2x: x2 - dx * 0.42, c2y: y2 + offset,
        x2: x2, y2: y2,
      }
    }

    /** SVG path string for one cubic Bézier control set (same as edge paths). */
    function bezierPath(controls) {
      if (!controls) return ''
      return 'M ' + round1(controls.x1) + ' ' + round1(controls.y1)
        + ' C ' + round1(controls.c1x) + ' ' + round1(controls.c1y)
        + ' ' + round1(controls.c2x) + ' ' + round1(controls.c2y)
        + ' ' + round1(controls.x2) + ' ' + round1(controls.y2)
    }

    /** Sample the cubic Bézier of an edge at t (0 = source, 1 = target). */
    function pointOnEdge(edge, t) {
      const controls = edge && edge.controls ? edge.controls : edge
      if (!controls) return { x: 0, y: 0 }
      const u = 1 - clamp01(t)
      return {
        x: u * u * u * controls.x1 + 3 * u * u * t * controls.c1x + 3 * u * t * t * controls.c2x + t * t * t * controls.x2,
        y: u * u * u * controls.y1 + 3 * u * u * t * controls.c1y + 3 * u * t * t * controls.c2y + t * t * t * controls.y2,
      }
    }

    /**
     * One dot colour per flying dot for an edge, distributed by the REAL event
     * kind mix (groups) of the last window — so a mixed edge shows both colours.
     */
    function edgeDotColors(row) {
      const plan = dotPlanForEdge(row && row.count !== undefined ? row.count : 1)
      const groups = row && row.groups && typeof row.groups === 'object' ? row.groups : null
      const entries = []
      if (groups) {
        const keys = Object.keys(groups)
        for (let i = 0; i < keys.length; i += 1) {
          const n = num(groups[keys[i]])
          if (n > 0) entries.push({ group: keys[i], count: n })
        }
      }
      entries.sort(function (a, b) { return b.count - a.count })
      if (entries.length === 0) {
        const fallback = FLOW_COLORS[dominantGroup(row)] || FLOW_COLORS.session
        const colors = []
        for (let i = 0; i < plan.dots; i += 1) colors.push(fallback)
        return colors
      }
      const total = entries.reduce(function (sum, entry) { return sum + entry.count }, 0)
      const colors = []
      // Guarantee every kind present on the edge gets at least one dot (when
      // there is room), then fill the remaining dots by real proportion.
      const guaranteed = entries.slice(0, plan.dots)
      for (let g = 0; g < guaranteed.length; g += 1) {
        colors.push(FLOW_COLORS[guaranteed[g].group] || FLOW_COLORS.other)
      }
      while (colors.length < plan.dots) {
        const target = (colors.length + 0.5) / plan.dots
        let acc = 0
        let picked = entries[entries.length - 1]
        for (let e = 0; e < entries.length; e += 1) {
          acc += entries[e].count / total
          if (target <= acc) {
            picked = entries[e]
            break
          }
        }
        colors.push(FLOW_COLORS[picked.group] || FLOW_COLORS.other)
      }
      return colors
    }

    /** Semantic class of one event inside the user→llm→tool→reply chain. */
    function causalStepKind(event) {
      const kind = String(event && event.kind ? event.kind : '').toLowerCase()
      const label = String(event && event.label ? event.label : '').toLowerCase()
      if (kind.indexOf('assistant') >= 0 || label.indexOf('assistant') >= 0) return 'assistant'
      if (kind.indexOf('turn') >= 0 && kind.indexOf('end') >= 0) return 'turn'
      if (label.indexOf('turn/end') >= 0 || label === 'turn/end') return 'turn'
      if (kind.indexOf('user') >= 0 || label.indexOf('user/message') >= 0) return 'user'
      if (kind.indexOf('request') >= 0 || kind.indexOf('header') >= 0 || label.indexOf('request') >= 0 || label.indexOf('header') >= 0) return 'request'
      if (kind.indexOf('llm.start') >= 0) return 'llm'
      if (kindGroup(kind) === 'tool') {
        return (kind.indexOf('result') >= 0 || kind.indexOf('.end') >= 0) ? 'result' : 'tool'
      }
      if (label.indexOf('tool/result') >= 0) return 'result'
      if (label.indexOf('tool/call') >= 0 || kind === 'tool/call' || label.indexOf('tool') >= 0) return 'tool'
      return 'other'
    }

    /**
     * Visible causal chain of the anchor event's session: user message →
     * request/llm.start → tool calls → tool results → assistant → turn end.
     */
    function buildCausalChain(events, anchor, windowMs) {
      if (!anchor || typeof anchor !== 'object') return { steps: [], note: true, sessionId: '' }
      const span = typeof windowMs === 'number' ? windowMs : FLOW_WINDOW_MS
      const anchorAt = num(anchor.t) || Date.now()
      const sessionId = typeof anchor.sessionId === 'string' ? anchor.sessionId : ''
      const list = Array.isArray(events) ? events : []
      const steps = []
      for (let i = 0; i < list.length; i += 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (!(at > 0) || at < anchorAt - span) continue
        if (sessionId && event.sessionId !== sessionId) continue
        const stepKind = causalStepKind(event)
        if (stepKind === 'other') continue
        steps.push({
          kind: stepKind,
          eventId: event.id,
          t: at,
          relMs: at - anchorAt,
          ms: num(event.ms),
          label: String(event.label || event.kind || ''),
          ok: event.ok !== false && event.level !== 'error',
          active: event === anchor || (anchor.id !== undefined && event.id === anchor.id),
        })
      }
      steps.sort(function (a, b) { return a.t - b.t })
      const trimmed = steps.slice(-24)
      return { steps: trimmed, sessionId: sessionId, note: trimmed.length < steps.length || steps.length < 4 }
    }

    /** Latency distribution of one tool over the recent window (ms). */
    function buildLatencyStats(events, toolName, windowMs) {
      const cutoff = Date.now() - (typeof windowMs === 'number' ? windowMs : FLOW_WINDOW_MS)
      const list = Array.isArray(events) ? events : []
      const values = []
      const wanted = typeof toolName === 'string' ? toolName : ''
      for (let i = 0; i < list.length; i += 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (at > 0 && at < cutoff) continue
        if (kindGroup(event.kind) !== 'tool') continue
        const data = event.data && typeof event.data === 'object' ? event.data : null
        const name = data && typeof data.tool === 'string' ? data.tool : String(event.label || '')
        if (wanted && name !== wanted) continue
        const ms = num(event.ms)
        if (ms > 0) values.push(ms)
      }
      if (values.length === 0) {
        return { count: 0, min: 0, avg: 0, p50: 0, max: 0, values: [] }
      }
      values.sort(function (a, b) { return a - b })
      const sum = values.reduce(function (acc, value) { return acc + value }, 0)
      return {
        count: values.length,
        min: values[0],
        avg: sum / values.length,
        p50: values[Math.floor((values.length - 1) / 2)],
        max: values[values.length - 1],
        values: values.slice(-120),
      }
    }

    /** Recent LLM calls in the anchor's session (nearest first). */
    function relatedLlmCalls(events, anchor, limit) {
      const cap = typeof limit === 'number' ? limit : 5
      if (!anchor || typeof anchor !== 'object') return []
      const cutoff = (num(anchor.t) || Date.now()) - FLOW_WINDOW_MS
      const sessionId = typeof anchor.sessionId === 'string' ? anchor.sessionId : ''
      const list = Array.isArray(events) ? events : []
      const rows = []
      for (let i = 0; i < list.length; i += 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (!(at > 0) || at < cutoff) continue
        if (kindGroup(event.kind) !== 'llm') continue
        if (sessionId && event.sessionId !== sessionId) continue
        const data = event.data && typeof event.data === 'object' ? event.data : null
        const usage = data && data.usage && typeof data.usage === 'object' ? data.usage : null
        rows.push({
          id: event.id,
          t: at,
          label: String(event.label || event.kind || 'llm'),
          ms: num(event.ms),
          ok: event.ok !== false && event.level !== 'error',
          usage: usage,
        })
      }
      rows.sort(function (a, b) { return b.t - a.t })
      return rows.slice(0, cap)
    }

    /** Chinese labels for tool/event kind codes (raw code kept elsewhere). */
    const KIND_LABEL_KEYS = {
      fs: 'kindFs', shell: 'kindShell', web: 'kindWeb', agent: 'kindAgent',
      ui: 'kindUi', inspect: 'kindInspect', other: 'kindOther', tool: 'kindTool',
      llm: 'kindLlm', session: 'kindSession', approval: 'kindApproval',
      plugin: 'kindPlugin', error: 'kindError',
    }

    function localizedKind(kind, t) {
      const raw = String(kind || '').toLowerCase()
      let key = KIND_LABEL_KEYS[raw] || ''
      if (!key) {
        if (raw.indexOf('fs') >= 0) key = 'kindFs'
        else if (raw.indexOf('shell') >= 0 || raw.indexOf('terminal') >= 0) key = 'kindShell'
        else if (raw.indexOf('web') >= 0 || raw.indexOf('network') >= 0) key = 'kindWeb'
        else if (raw.indexOf('agent') >= 0) key = 'kindAgent'
        else if (raw.indexOf('ui') >= 0) key = 'kindUi'
        else if (raw.indexOf('inspect') >= 0 || raw.indexOf('read') >= 0) key = 'kindInspect'
        else key = 'kindOther'
      }
      return typeof t === 'function' ? t(key) : raw
    }

    /** Known provider families for tools (mcp_github_* / cordis_* / …). */
    function toolSourceKey(name) {
      const text = String(name || '')
      if (/^mcp_github_/i.test(text)) return 'sourceGithubMcp'
      if (/^cordis_/i.test(text)) return 'sourceCordis'
      if (/^hindsight_/i.test(text)) return 'sourceHindsight'
      if (/^mcp_/i.test(text)) return 'sourceMcp'
      if (/^git_/i.test(text)) return 'sourceGit'
      if (/^(fs|file)_/.test(text) || /^(read|write|edit|glob|grep)/i.test(text)) return 'sourceLocal'
      return ''
    }

    function isMostlyEnglish(text) {
      const value = String(text || '')
      if (!value.trim()) return false
      const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length
      const words = (value.match(/[A-Za-z]{2,}/g) || []).length
      return cjk === 0 && words >= 3
    }

    /** Moving-dot plan for one observed edge: count and per-frame speed. */
    function dotPlanForEdge(count) {
      const n = Math.max(1, Math.floor(num(count)))
      return {
        dots: Math.min(5, 1 + Math.floor(n / 3)),
        speed: (2 + Math.min(8, n / 2)) / 1000,
      }
    }

    /** Runtime names a plugin may be registered under (provider matching). */
    function pluginRuntimeNames(plugin) {
      const names = []
      if (!plugin) return names
      if (typeof plugin.name === 'string' && plugin.name) names.push(plugin.name)
      if (typeof plugin.entryId === 'string' && plugin.entryId) {
        names.push(plugin.entryId)
        const parts = plugin.entryId.split(/[\\/]/)
        if (parts.length > 0 && parts[parts.length - 1]) names.push(parts[parts.length - 1])
      }
      return names
    }

    /** Services owned by a plugin: match snapshot.services[].provider to it. */
    function servicesForPlugin(snapshot, plugin) {
      const services = snapshot && Array.isArray(snapshot.services) ? snapshot.services : []
      const names = pluginRuntimeNames(plugin)
      if (names.length === 0) return []
      return services.filter(function (service) {
        if (!service || typeof service.provider !== 'string' || !service.provider) return false
        for (let i = 0; i < names.length; i += 1) {
          const name = names[i]
          if (name === service.provider || name.indexOf(service.provider) >= 0 || service.provider.indexOf(name) >= 0) return true
        }
        return false
      })
    }

    /** The plugin providing a service (best-effort exact/partial provider match). */
    function pluginForService(snapshot, service) {
      const plugins = snapshot && Array.isArray(snapshot.plugins) ? snapshot.plugins : []
      if (!service || typeof service.provider !== 'string' || !service.provider) return null
      const provider = service.provider
      for (let i = 0; i < plugins.length; i += 1) {
        const names = pluginRuntimeNames(plugins[i])
        for (let n = 0; n < names.length; n += 1) {
          const name = names[n]
          if (name === provider || name.indexOf(provider) >= 0 || provider.indexOf(name) >= 0) return plugins[i]
        }
      }
      return null
    }

    /** Plugins/services that belong to either endpoint domain of an edge. */
    function relatedEntitiesForEdge(snapshot, from, to) {
      const services = snapshot && Array.isArray(snapshot.services) ? snapshot.services : []
      const plugins = snapshot && Array.isArray(snapshot.plugins) ? snapshot.plugins : []
      const matches = function (value) { return value === from || value === to }
      return {
        services: services.filter(function (service) { return service && matches(service.organ) }).slice(0, 8),
        plugins: plugins.filter(function (plugin) { return plugin && matches(plugin.organ) }).slice(0, 8),
      }
    }

    /** 0..1 position of a timestamp inside the timeline window. */
    function timelinePct(value, cutoff, now) {
      const span = Math.max(1, num(now) - num(cutoff))
      return clamp01((num(value) - num(cutoff)) / span)
    }

    /**
     * Build the call timeline: pair llm.start/end sequentially per session and
     * tool.start/end per session+call id, then group segments into session lanes.
     */
    function buildTimeline(events, windowMs, nowMs) {
      const span = typeof windowMs === 'number' ? windowMs : 60000
      const now = typeof nowMs === 'number' ? nowMs : Date.now()
      const cutoff = now - span
      const list = Array.isArray(events) ? events : []
      const openLlm = Object.create(null)
      const openTool = Object.create(null)
      const segments = []
      const laneOrder = []
      const laneSet = Object.create(null)
      const pushSegment = function (segment) {
        const sid = segment.sessionId || '—'
        segment.sessionId = sid
        segments.push(segment)
        if (!laneSet[sid]) {
          laneSet[sid] = true
          laneOrder.push(sid)
        }
      }
      for (let i = 0; i < list.length; i += 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (at > 0 && at < cutoff) continue
        const group = kindGroup(event.kind)
        if (group !== 'llm' && group !== 'tool') continue
        const data = event.data && typeof event.data === 'object' ? event.data : null
        const sessionId = typeof event.sessionId === 'string' && event.sessionId ? event.sessionId : ''
        const kindText = String(event.kind || '').toLowerCase()
        const isEnd = kindText.indexOf('.end') >= 0 || kindText.indexOf('result') >= 0
        if (group === 'tool') {
          const callId = data && (data.callId || data.rootCallId) ? String(data.callId || data.rootCallId) : ''
          const toolKey = (sessionId || '—') + '|' + (callId || String((data && data.tool) || event.label || 'tool'))
          if (!isEnd) {
            openTool[toolKey] = event
            continue
          }
          const startEvent = openTool[toolKey]
          delete openTool[toolKey]
          const startAt = startEvent && num(startEvent.t) > 0 ? num(startEvent.t) : at - num(event.ms)
          pushSegment({
            kind: 'tool', sessionId: sessionId, start: startAt,
            end: at > 0 ? at : startAt + num(event.ms),
            label: String((data && (data.tool || data.name)) || (startEvent && startEvent.label) || event.label || 'tool'),
            ok: event.ok !== false && event.level !== 'error',
            ms: num(event.ms) || Math.max(0, at - startAt),
            eventId: event.id,
          })
        } else {
          const llmKey = sessionId || '—'
          if (!isEnd) {
            openLlm[llmKey] = event
            continue
          }
          const startEvent = openLlm[llmKey]
          delete openLlm[llmKey]
          const startAt = startEvent && num(startEvent.t) > 0 ? num(startEvent.t) : at - num(event.ms)
          pushSegment({
            kind: 'llm', sessionId: sessionId, start: startAt,
            end: at > 0 ? at : startAt + num(event.ms),
            label: String((startEvent && startEvent.label) || event.label || 'llm'),
            ok: event.ok !== false && event.level !== 'error',
            ms: num(event.ms) || Math.max(0, at - startAt),
            eventId: event.id,
          })
        }
      }
      // Still-open calls continue to "now".
      const closeOpen = function (map, kind) {
        const keys = Object.keys(map)
        for (let i = 0; i < keys.length; i += 1) {
          const startEvent = map[keys[i]]
          if (!startEvent) continue
          const startAt = num(startEvent.t) > 0 ? num(startEvent.t) : cutoff
          const data = startEvent.data && typeof startEvent.data === 'object' ? startEvent.data : null
          pushSegment({
            kind: kind,
            sessionId: typeof startEvent.sessionId === 'string' ? startEvent.sessionId : '',
            start: startAt,
            end: now,
            label: String((data && (data.tool || data.name)) || startEvent.label || kind),
            ok: true,
            ms: Math.max(0, now - startAt),
            eventId: startEvent.id,
            ongoing: true,
          })
        }
      }
      closeOpen(openLlm, 'llm')
      closeOpen(openTool, 'tool')
      const laneMap = Object.create(null)
      const lanes = []
      for (let i = 0; i < laneOrder.length; i += 1) {
        laneMap[laneOrder[i]] = { sessionId: laneOrder[i], segments: [] }
        lanes.push(laneMap[laneOrder[i]])
      }
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i]
        if (!laneMap[segment.sessionId]) continue
        laneMap[segment.sessionId].segments.push(segment)
      }
      for (let i = 0; i < lanes.length; i += 1) {
        lanes[i].segments.sort(function (a, b) { return a.start - b.start })
      }
      return { windowMs: span, cutoff: cutoff, now: now, lanes: lanes, segments: segments }
    }

    /** Viewport rectangle (viewBox units) for a zoom level centered on (cx, cy). */
    function zoomFrame(zoom, cx, cy) {
      const level = clamp(num(zoom) || 1, MIN_ZOOM, MAX_ZOOM)
      const w = VIEW_W / level
      const h = VIEW_H / level
      const x = clamp(num(cx), w / 2, VIEW_W - w / 2) - w / 2
      const y = clamp(num(cy), h / 2, VIEW_H - h / 2) - h / 2
      return { x: x, y: y, w: w, h: h }
    }

    /**
     * Clamp the viewport center so the view stays within the content box plus a
     * small overscroll margin, i.e. panning can never lose the diagram.
     */
    function clampViewCenter(zoom, cx, cy) {
      const level = clamp(num(zoom) || 1, MIN_ZOOM, MAX_ZOOM)
      const w = VIEW_W / level
      const h = VIEW_H / level
      const marginX = w * 0.2
      const marginY = h * 0.2
      return {
        x: clamp(num(cx), w / 2 - marginX, VIEW_W - w / 2 + marginX),
        y: clamp(num(cy), h / 2 - marginY, VIEW_H - h / 2 + marginY),
      }
    }

    /**
     * Cursor-anchored zoom: the viewBox point under the pointer keeps its
     * normalized position; the result is clamped to the content bounds.
     */
    function zoomAtAnchor(zoom, center, anchor, factor) {
      const level = clamp(num(zoom) || 1, MIN_ZOOM, MAX_ZOOM)
      const next = clamp(level * (num(factor) || 1), MIN_ZOOM, MAX_ZOOM)
      const frame = zoomFrame(level, num(center && center.x), num(center && center.y))
      const pointX = num(anchor && anchor.x)
      const pointY = num(anchor && anchor.y)
      const u = clamp01(frame.w > 0 ? (pointX - frame.x) / frame.w : 0.5)
      const v = clamp01(frame.h > 0 ? (pointY - frame.y) / frame.h : 0.5)
      const w = VIEW_W / next
      const h = VIEW_H / next
      const clamped = clampViewCenter(next, pointX - u * w + w / 2, pointY - v * h + h / 2)
      return { zoom: next, center: clamped }
    }

    /** Convert a pointer position on screen into a viewBox point. */
    function screenToViewPoint(rect, frame, clientX, clientY) {
      const width = num(rect && rect.width)
      const height = num(rect && rect.height)
      const box = frame && frame.w && frame.h ? frame : { x: 0, y: 0, w: VIEW_W, h: VIEW_H }
      const scale = Math.min(width / box.w, height / box.h) || 1
      const ox = (width - box.w * scale) / 2
      const oy = (height - box.h * scale) / 2
      return {
        x: box.x + (num(clientX) - num(rect && rect.left) - ox) / scale,
        y: box.y + (num(clientY) - num(rect && rect.top) - oy) / scale,
      }
    }

    /** SVG viewBox string for a zoom level centered on (cx, cy). */
    function zoomViewBox(zoom, cx, cy) {
      const frame = zoomFrame(zoom, cx, cy)
      return round1(frame.x) + ' ' + round1(frame.y) + ' ' + round1(frame.w) + ' ' + round1(frame.h)
    }

    /**
     * Greedy label placement (above → below → further above/below) so edge
     * labels never stack on top of each other.
     */
    function placeEdgeLabels(items, boundsWidth, boundsHeight) {
      const list = Array.isArray(items) ? items : []
      const boundW = num(boundsWidth) || VIEW_W
      const boundH = num(boundsHeight) || VIEW_H
      const placed = []
      const overlaps = function (rect) {
        for (let i = 0; i < placed.length; i += 1) {
          const other = placed[i]
          if (rect.x < other.x + other.w && rect.x + rect.w > other.x && rect.y < other.y + other.h && rect.y + rect.h > other.y) return true
        }
        return false
      }
      for (let i = 0; i < list.length; i += 1) {
        const item = list[i]
        const width = Math.max(36, num(item.width) || 40)
        const candidates = [
          { x: num(item.x) - width / 2, y: num(item.y) - 23, w: width, h: 16 },
          { x: num(item.x) - width / 2, y: num(item.y) + 7, w: width, h: 16 },
          { x: num(item.x) - width / 2, y: num(item.y) - 41, w: width, h: 16 },
          { x: num(item.x) - width / 2, y: num(item.y) + 25, w: width, h: 16 },
        ]
        let chosen = candidates[0]
        for (let c = 0; c < candidates.length; c += 1) {
          const candidate = candidates[c]
          if (candidate.x < 4 || candidate.x + candidate.w > boundW - 4) continue
          if (candidate.y < 4 || candidate.y + candidate.h > boundH - 4) continue
          if (!overlaps(candidate)) {
            chosen = candidate
            break
          }
        }
        placed.push(chosen)
      }
      const out = []
      for (let i = 0; i < list.length; i += 1) {
        out.push({ x: placed[i].x + placed[i].w / 2, y: placed[i].y + placed[i].h / 2, w: placed[i].w, h: placed[i].h })
      }
      return out
    }

    /** Observed upstream/downstream neighbours of one domain. */
    function computeDomainNeighbors(flows, domainId) {
      const pairs = flows && flows.pairs && typeof flows.pairs === 'object' ? flows.pairs : {}
      const downstream = Object.create(null)
      const upstream = Object.create(null)
      const keys = Object.keys(pairs)
      for (let i = 0; i < keys.length; i += 1) {
        const row = pairs[keys[i]]
        if (!row) continue
        if (row.from === domainId) downstream[row.to] = (downstream[row.to] || 0) + num(row.count)
        if (row.to === domainId) upstream[row.from] = (upstream[row.from] || 0) + num(row.count)
      }
      const toRows = function (map) {
        return Object.keys(map).map(function (id) { return { id: id, count: map[id] } }).sort(function (a, b) { return b.count - a.count })
      }
      return { downstream: toRows(downstream), upstream: toRows(upstream) }
    }

    /** Right-drawer payload for one observed edge (domain view or tool view). */
    function buildEdgeDetail(selection, flows, toolFlows, events, windowMs) {
      if (!selection || selection.type !== 'edge') return null
      const mode = selection.mode === 'tool' ? 'tool' : 'domain'
      const from = String(selection.from || '')
      const to = String(selection.to || '')
      if (!from || !to) return null
      const key = from + '>' + to
      const source = mode === 'tool'
        ? (toolFlows && toolFlows.edges ? toolFlows.edges[key] : null)
        : (flows && flows.pairs ? flows.pairs[key] : null)
      if (!source) return null
      const cutoff = Date.now() - (typeof windowMs === 'number' ? windowMs : FLOW_WINDOW_MS)
      const samples = []
      const list = Array.isArray(events) ? events : []
      for (let i = list.length - 1; i >= 0 && samples.length < 5; i -= 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (at > 0 && at < cutoff) break
        if (mode === 'tool') {
          if (kindGroup(event.kind) !== 'tool') continue
          const data = event.data && typeof event.data === 'object' ? event.data : null
          const name = data && typeof data.tool === 'string' ? data.tool : String(event.label || '')
          if (name !== from) continue
        } else if (event.organ !== from || event.target !== to) {
          continue
        }
        samples.push({ id: event.id, t: event.t, kind: event.kind, label: event.label, ms: event.ms, ok: event.ok !== false && event.level !== 'error' })
      }
      const toRows = function (map) {
        return map ? topEntries(map, 6).map(function (row) { return { label: row.key, count: row.count } }) : []
      }
      return {
        mode: mode, from: from, to: to, key: key,
        count: num(source.count), errors: num(source.errors),
        okCount: Math.max(0, num(source.count) - num(source.errors)),
        avgMs: num(source.count) > 0 ? num(source.ms) / num(source.count) : 0,
        labels: toRows(source.labels), kinds: toRows(source.kinds), samples: samples,
      }
    }

    /** Which side of `node` faces `other` (right/left/bottom/top). */
    function sideToward(node, other) {
      const dx = num(other.x) - num(node.x)
      const dy = num(other.y) - num(node.y)
      if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
      return dy >= 0 ? 'bottom' : 'top'
    }

    /** Anchor point on one node side, displaced by `offset` along that side. */
    function sideAnchor(node, side, offset) {
      const x = num(node.x)
      const y = num(node.y)
      const shift = num(offset)
      if (side === 'right') return { x: x + NODE_W / 2, y: y + shift }
      if (side === 'left') return { x: x - NODE_W / 2, y: y + shift }
      if (side === 'bottom') return { x: x + shift, y: y + NODE_H / 2 }
      return { x: x + shift, y: y - NODE_H / 2 }
    }

    /** Node rectangle as an obstacle, inflated by pad. */
    function rectOfNode(node, pad) {
      const w = num(node && node.w) || NODE_W
      const h = num(node && node.h) || NODE_H
      const inset = num(pad)
      return {
        x1: num(node && node.x) - w / 2 - inset,
        y1: num(node && node.y) - h / 2 - inset,
        x2: num(node && node.x) + w / 2 + inset,
        y2: num(node && node.y) + h / 2 + inset,
      }
    }

    /** Obstacle table for all nodes except the edge's own endpoints. */
    function buildObstacles(nodes, pad, excludeIds) {
      const list = Array.isArray(nodes) ? nodes : []
      const excluded = Object.create(null)
      if (Array.isArray(excludeIds)) for (let i = 0; i < excludeIds.length; i += 1) excluded[String(excludeIds[i])] = true
      const rects = []
      for (let i = 0; i < list.length; i += 1) {
        const node = list[i]
        if (!node) continue
        const id = node.id || node.name || ''
        if (excluded[String(id)]) continue
        rects.push(rectOfNode(node, pad))
      }
      return rects
    }

    function pointInRect(point, rect) {
      return point.x > rect.x1 && point.x < rect.x2 && point.y > rect.y1 && point.y < rect.y2
    }

    /** Dense samples for any route: cubic, polyline or Catmull-Rom spline. */
    function routeSamples(route) {
      if (!route) return []
      if (Array.isArray(route._samples) && route._samples.length > 1) return route._samples
      let samples = []
      if (route.type === 'cubic' || route.controls) {
        for (let i = 0; i <= 24; i += 1) samples.push(pointOnEdge(route, i / 24))
      } else if (route.type === 'spline' && Array.isArray(route.segments)) {
        for (let s = 0; s < route.segments.length; s += 1) {
          const controls = route.segments[s]
          for (let k = 0; k < 12; k += 1) samples.push(pointOnEdge({ controls: controls }, k / 12))
        }
        samples.push(pointOnEdge({ controls: route.segments[route.segments.length - 1] }, 1))
      } else if (Array.isArray(route.points) && route.points.length > 0) {
        samples = route.points.slice()
      }
      route._samples = samples
      return samples
    }

    /** Sample a route (cubic / spline / polyline) at fraction t of its length. */
    function pointOnPath(route, t) {
      if (!route) return { x: 0, y: 0 }
      if (route.type === 'cubic' || route.controls) return pointOnEdge(route, t)
      const points = routeSamples(route)
      if (points.length < 2) return points.length === 1 ? points[0] : { x: 0, y: 0 }
      const lengths = []
      let total = 0
      for (let i = 1; i < points.length; i += 1) {
        const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
        lengths.push(length)
        total += length
      }
      if (total <= 0) return { x: points[0].x, y: points[0].y }
      let target = clamp01(t) * total
      for (let i = 0; i < lengths.length; i += 1) {
        if (target <= lengths[i] || i === lengths.length - 1) {
          const ratio = lengths[i] > 0 ? clamp01(target / lengths[i]) : 0
          return {
            x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
            y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
          }
        }
        target -= lengths[i]
      }
      return { x: points[0].x, y: points[0].y }
    }

    function pathPoints(route) {
      const samples = routeSamples(route)
      return samples.length > 1 ? samples : []
    }

    function pathIntersectsRects(route, rects) {
      const points = pathPoints(route)
      for (let i = 0; i < points.length; i += 1) {
        for (let r = 0; r < rects.length; r += 1) {
          if (pointInRect(points[i], rects[r])) return true
        }
      }
      return false
    }

    function routeLength(route) {
      const points = pathPoints(route)
      let total = 0
      for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
      return total
    }

    function cubicRouteFromPoints(start, end, bend) {
      const controls = bezierControls(start.x, start.y, end.x, end.y, bend)
      return { type: 'cubic', controls: controls, d: bezierPath(controls), mid: pointOnEdge({ controls: controls }, 0.5) }
    }

    /** Catmull-Rom→cubic Bézier spline through waypoints: always curved. */
    function splineRouteFromPoints(points) {
      const clean = []
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i]
        if (!point) continue
        if (clean.length > 0 && Math.abs(clean[clean.length - 1].x - point.x) < 0.5 && Math.abs(clean[clean.length - 1].y - point.y) < 0.5) continue
        clean.push({ x: round1(point.x), y: round1(point.y) })
      }
      if (clean.length < 3) return polyRouteFromPoints(clean)
      const segments = []
      let d = 'M ' + clean[0].x + ' ' + clean[0].y
      for (let i = 0; i < clean.length - 1; i += 1) {
        const p0 = clean[i - 1] || clean[i]
        const p1 = clean[i]
        const p2 = clean[i + 1]
        const p3 = clean[i + 2] || p2
        const controls = {
          x1: round1(p1.x), y1: round1(p1.y),
          c1x: round1(p1.x + (p2.x - p0.x) / 6), c1y: round1(p1.y + (p2.y - p0.y) / 6),
          c2x: round1(p2.x - (p3.x - p1.x) / 6), c2y: round1(p2.y - (p3.y - p1.y) / 6),
          x2: round1(p2.x), y2: round1(p2.y),
        }
        segments.push(controls)
        d += ' C ' + controls.c1x + ' ' + controls.c1y + ' ' + controls.c2x + ' ' + controls.c2y + ' ' + controls.x2 + ' ' + controls.y2
      }
      const route = { type: 'spline', segments: segments, points: clean, d: d, mid: null }
      route.mid = pointOnPath(route, 0.5)
      return route
    }

    function polyRouteFromPoints(points) {
      const clean = []
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i]
        if (!point) continue
        if (clean.length > 0 && Math.abs(clean[clean.length - 1].x - point.x) < 0.5 && Math.abs(clean[clean.length - 1].y - point.y) < 0.5) continue
        clean.push({ x: round1(point.x), y: round1(point.y) })
      }
      let d = ''
      for (let i = 0; i < clean.length; i += 1) d += (i === 0 ? 'M ' : ' L ') + clean[i].x + ' ' + clean[i].y
      return { type: 'poly', points: clean, d: d, mid: pointOnPath({ type: 'poly', points: clean }, 0.5) }
    }

    function sideOutwardVector(side) {
      if (side === 'left') return { x: -1, y: 0 }
      if (side === 'top') return { x: 0, y: -1 }
      if (side === 'bottom') return { x: 0, y: 1 }
      return { x: 1, y: 0 }
    }

    /** Anchor offset clamped to the node boundary side extent. */
    function clampSideOffset(side, value) {
      const limit = side === 'left' || side === 'right' ? NODE_H / 2 - 4 : NODE_W / 2 - 4
      return clamp(num(value), -limit, limit)
    }

    function routeFromControls(controls) {
      return { type: 'cubic', controls: controls, d: bezierPath(controls), mid: pointOnEdge({ controls: controls }, 0.5) }
    }

    /** Cubic whose endpoint tangents are normal to the anchor sides (18–60). */
    function cubicRouteForSides(start, startSide, end, endSide, bend) {
      const outStart = sideOutwardVector(startSide)
      const outEnd = sideOutwardVector(endSide)
      const horizontal = Math.abs(num(end.x) - num(start.x)) >= Math.abs(num(end.y) - num(start.y))
      const axisLength = horizontal ? Math.abs(num(end.x) - num(start.x)) : Math.abs(num(end.y) - num(start.y))
      const distance = clamp(axisLength * 0.35, 24, 90)
      const c1 = { x: round1(num(start.x) + outStart.x * distance), y: round1(num(start.y) + outStart.y * distance) }
      const c2 = { x: round1(num(end.x) + outEnd.x * distance), y: round1(num(end.y) + outEnd.y * distance) }
      if (num(bend) !== 0) {
        if (Math.abs(num(end.x) - num(start.x)) >= Math.abs(num(end.y) - num(start.y))) {
          c1.y = round1(c1.y + num(bend))
          c2.y = round1(c2.y + num(bend))
        } else {
          c1.x = round1(c1.x + num(bend))
          c2.x = round1(c2.x + num(bend))
        }
      }
      return routeFromControls({
        x1: num(start.x), y1: num(start.y),
        c1x: c1.x, c1y: c1.y, c2x: c2.x, c2y: c2.y,
        x2: num(end.x), y2: num(end.y),
      })
    }

    /** Column index of a domain node (0-based layer order). */
    function columnIndexOf(node) {
      const index = LAYER_ORDER.indexOf(node && node.layer)
      return index < 0 ? 0 : index
    }

    /** x positions of the blank corridors between layer frames. */
    function layerGutters() {
      const out = []
      for (let i = 0; i < LAYER_DEFS.length - 1; i += 1) out.push(LAYER_DEFS[i].x2)
      return out
    }

    /** Lane offsets inside a gutter (spacing 16, total width ±48). */
    function gutterLaneOffset(index) {
      const sequence = [0, 16, 32, 48, -16, -32, -48]
      return sequence[Math.abs(Math.floor(num(index))) % sequence.length]
    }

    /** Adjacent columns: moderate horizontal S (diagrams.net-like curvature). */
    function laneRouteAdjacent(start, startSide, end, endSide) {
      const outStart = sideOutwardVector(startSide)
      const outEnd = sideOutwardVector(endSide)
      const distance = clamp(Math.abs(num(end.x) - num(start.x)) * 0.5, 40, 140)
      return routeFromControls({
        x1: num(start.x), y1: num(start.y),
        c1x: round1(num(start.x) + outStart.x * distance), c1y: round1(num(start.y) + outStart.y * distance),
        c2x: round1(num(end.x) + outEnd.x * distance), c2y: round1(num(end.y) + outEnd.y * distance),
        x2: num(end.x), y2: num(end.y),
      })
    }

    /** Same column: vertical S curve, horizontal bow bounded to ±22. */
    function laneRouteSameColumn(start, startSide, end, endSide) {
      const outStart = sideOutwardVector(startSide)
      const outEnd = sideOutwardVector(endSide)
      const distance = clamp(Math.abs(num(end.y) - num(start.y)) * 0.5, 40, 140)
      const bow = clamp((num(end.x) - num(start.x)) * 0.5, -22, 22)
      return routeFromControls({
        x1: num(start.x), y1: num(start.y),
        c1x: round1(num(start.x) + outStart.x * distance + bow), c1y: round1(num(start.y) + outStart.y * distance),
        c2x: round1(num(end.x) + outEnd.x * distance + bow), c2y: round1(num(end.y) + outEnd.y * distance),
        x2: num(end.x), y2: num(end.y),
      })
    }

    /** Rounded-corner polyline (r=12) sampled densely for dots/collision. */
    function roundedRoute(points, radius) {
      const pts = []
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i]
        if (!point) continue
        if (pts.length > 0 && Math.abs(pts[pts.length - 1].x - point.x) < 0.5 && Math.abs(pts[pts.length - 1].y - point.y) < 0.5) continue
        pts.push({ x: num(point.x), y: num(point.y) })
      }
      if (pts.length < 2) return polyRouteFromPoints(pts)
      const r = num(radius) > 0 ? num(radius) : 12
      let d = 'M ' + round1(pts[0].x) + ' ' + round1(pts[0].y)
      const samples = [{ x: pts[0].x, y: pts[0].y }]
      const pushLine = function (from, to) {
        const steps = Math.max(2, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 8))
        for (let s = 1; s <= steps; s += 1) samples.push({ x: from.x + (to.x - from.x) * (s / steps), y: from.y + (to.y - from.y) * (s / steps) })
      }
      let current = pts[0]
      for (let i = 1; i < pts.length - 1; i += 1) {
        const prev = pts[i - 1]
        const corner = pts[i]
        const next = pts[i + 1]
        const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y)
        const outLen = Math.hypot(next.x - corner.x, next.y - corner.y)
        const cut = Math.min(r, inLen / 2, outLen / 2)
        const entry = { x: corner.x + (prev.x - corner.x) * (cut / (inLen || 1)), y: corner.y + (prev.y - corner.y) * (cut / (inLen || 1)) }
        const exit = { x: corner.x + (next.x - corner.x) * (cut / (outLen || 1)), y: corner.y + (next.y - corner.y) * (cut / (outLen || 1)) }
        d += ' L ' + round1(entry.x) + ' ' + round1(entry.y)
        pushLine(current, entry)
        d += ' Q ' + round1(corner.x) + ' ' + round1(corner.y) + ' ' + round1(exit.x) + ' ' + round1(exit.y)
        for (let q = 1; q <= 8; q += 1) {
          const ratio = q / 8
          const inv = 1 - ratio
          samples.push({
            x: inv * inv * entry.x + 2 * inv * ratio * corner.x + ratio * ratio * exit.x,
            y: inv * inv * entry.y + 2 * inv * ratio * corner.y + ratio * ratio * exit.y,
          })
        }
        current = exit
      }
      const last = pts[pts.length - 1]
      d += ' L ' + round1(last.x) + ' ' + round1(last.y)
      pushLine(current, last)
      const route = { type: 'rounded', points: samples, d: d, mid: null }
      route.mid = pointOnPath(route, 0.5)
      return route
    }

    /** Cross-column route via a layer gutter, lane-separated from siblings. */
    function gutterRoute(start, startSide, end, endSide, gutterX, laneIndex) {
      const laneX = num(gutterX) + gutterLaneOffset(laneIndex)
      const route = roundedRoute([start, { x: laneX, y: start.y }, { x: laneX, y: end.y }, end], 16)
      route.gutterX = num(gutterX)
      route.laneX = laneX
      return route
    }

    /** Pick the gutter corridor between two columns closest to the edge midpoint. */
    function gutterBetween(start, end, colA, colB) {
      const gutters = layerGutters()
      const lo = Math.min(colA, colB)
      const hi = Math.max(colA, colB)
      const midpoint = (num(start.x) + num(end.x)) / 2
      let chosen = null
      for (let i = 0; i < gutters.length; i += 1) {
        if (i < lo || i >= hi) continue
        if (chosen === null || Math.abs(gutters[i] - midpoint) < Math.abs(chosen - midpoint)) chosen = gutters[i]
      }
      return chosen === null ? gutters[Math.min(gutters.length - 1, Math.max(0, lo))] : chosen
    }

    /** Top N tools with traffic (used by the tool-view Top-8 edge filter). */
    function pickTopTools(toolNodes, limit) {
      const list = Array.isArray(toolNodes) ? toolNodes : []
      const cap = typeof limit === 'number' ? limit : 8
      const rows = []
      for (let i = 0; i < list.length; i += 1) {
        const node = list[i]
        const count = num(node && node.data ? node.data.count : 0)
        if (count > 0) rows.push({ name: node.name, count: count })
      }
      rows.sort(function (a, b) { return b.count - a.count })
      return rows.slice(0, cap).map(function (row) { return row.name })
    }

    /**
     * Choose the shortest collision-free curved route between two anchors.
     * Endpoint tangents follow the anchor side normal (right → horizontal out,
     * bottom → vertical out, …); waypoint routes are splines with outward stubs.
     */
    function chooseEdgeRoute(start, end, obstacles, bendBias, strictBend, startSide, endSide) {
      const rects = Array.isArray(obstacles) ? obstacles : []
      const candidates = []
      const bias = num(bendBias)
      const bends = strictBend
        ? [bias, bias + 4, bias - 4, bias + 8]
        : [bias, bias - 10, bias + 10, -22, 22, -36, 36]
      for (let i = 0; i < bends.length; i += 1) {
        candidates.push(cubicRouteForSides(start, startSide, end, endSide, bends[i]))
      }
      const outStart = sideOutwardVector(startSide)
      const outEnd = sideOutwardVector(endSide)
      const stubStart = { x: round1(start.x + outStart.x * 26), y: round1(start.y + outStart.y * 26) }
      const stubEnd = { x: round1(end.x + outEnd.x * 26), y: round1(end.y + outEnd.y * 26) }
      const gutterXs = [272, 504, 736, 968]
      const sameColumn = Math.abs(end.x - start.x) < 40
      for (let i = 0; i < gutterXs.length; i += 1) {
        const gx = gutterXs[i]
        if (!sameColumn && (gx <= Math.min(start.x, end.x) + 12 || gx >= Math.max(start.x, end.x) - 12)) continue
        candidates.push(splineRouteFromPoints([start, stubStart, { x: gx, y: stubStart.y }, { x: gx, y: stubEnd.y }, stubEnd, end]))
      }
      const outerLanes = [30, 606]
      for (let i = 0; i < outerLanes.length; i += 1) {
        const laneY = outerLanes[i]
        if (laneY > Math.min(start.y, end.y) - 30 && laneY < Math.max(start.y, end.y) + 30) continue
        candidates.push(splineRouteFromPoints([start, stubStart, { x: stubStart.x, y: laneY }, { x: stubEnd.x, y: laneY }, stubEnd, end]))
      }
      const outerXs = [22, 1218]
      for (let i = 0; i < outerXs.length; i += 1) {
        const laneX = outerXs[i]
        candidates.push(splineRouteFromPoints([start, stubStart, { x: laneX, y: stubStart.y }, { x: laneX, y: stubEnd.y }, stubEnd, end]))
      }
      let best = null
      let bestLength = Infinity
      let fallback = candidates[0]
      let fallbackHits = Infinity
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i]
        const points = pathPoints(candidate)
        let hits = 0
        for (let p = 0; p < points.length; p += 1) {
          for (let r = 0; r < rects.length; r += 1) if (pointInRect(points[p], rects[r])) hits += 1
        }
        if (hits < fallbackHits) {
          fallbackHits = hits
          fallback = candidate
        }
        if (hits > 0) continue
        const length = routeLength(candidate)
        if (length < bestLength) {
          bestLength = length
          best = candidate
        }
      }
      return best || fallback
    }

    /** Canvas focus point for the current selection (zoom "focus" button). */
    function focusPoint(selection, view, nodes, toolNodes) {
      if (!selection || typeof selection !== 'object') return null
      if (view === 'tools') {
        const toolLayout = layoutToolNodes(toolNodes)
        const targetLayout = layoutToolTargets(nodes)
        if (selection.type === 'tool') {
          for (let i = 0; i < toolLayout.length; i += 1) if (toolLayout[i].id === selection.id) return { x: toolLayout[i].x, y: toolLayout[i].y }
          return null
        }
        if (selection.type === 'domain') {
          for (let i = 0; i < targetLayout.length; i += 1) if (targetLayout[i].id === selection.id) return { x: targetLayout[i].x, y: targetLayout[i].y }
          return null
        }
        if (selection.type === 'edge') {
          let from = null
          let to = null
          for (let i = 0; i < toolLayout.length; i += 1) if (toolLayout[i].name === selection.from) from = toolLayout[i]
          for (let i = 0; i < targetLayout.length; i += 1) if (targetLayout[i].id === selection.to) to = targetLayout[i]
          if (from && to) return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
          return null
        }
        return null
      }
      if (selection.type === 'domain') {
        const def = DOMAIN_BY_ID[selection.id]
        return def ? { x: def.x, y: def.y } : null
      }
      if (selection.type === 'tool') {
        const list = Array.isArray(toolNodes) ? toolNodes : []
        for (let i = 0; i < list.length; i += 1) {
          if (list[i] && list[i].name === selection.id && list[i].organ && DOMAIN_BY_ID[list[i].organ]) {
            const def = DOMAIN_BY_ID[list[i].organ]
            return { x: def.x, y: def.y }
          }
        }
        return null
      }
      if (selection.type === 'edge') {
        const a = DOMAIN_BY_ID[selection.from]
        const b = DOMAIN_BY_ID[selection.to]
        return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null
      }
      return null
    }

    /** Find one observed edge row in either mode (used by edge clicks/drawer). */
    function findEdgeRow(flows, toolFlows, from, to, mode) {
      const key = String(from) + '>' + String(to)
      if (mode === 'tool') return toolFlows && toolFlows.edges ? toolFlows.edges[key] || null : null
      return flows && flows.pairs ? flows.pairs[key] || null : null
    }


    /**
     * Observed tool→domain call graph (dispatch events only) for the tool view.
     * Tool identity comes from data.tool / event.label; the affected domain is
     * the snapshot tool's organ, falling back to the event target.
     */
    function computeToolFlows(events, tools, windowMs) {
      const cutoff = Date.now() - (typeof windowMs === 'number' ? windowMs : FLOW_WINDOW_MS)
      const byName = Object.create(null)
      const toolList = Array.isArray(tools) ? tools : []
      for (let i = 0; i < toolList.length; i += 1) {
        const tool = toolList[i]
        if (tool && typeof tool.name === 'string') byName[tool.name] = tool
      }
      const edges = Object.create(null)
      const toolsByName = Object.create(null)
      const list = Array.isArray(events) ? events : []
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (at > 0 && at < cutoff) break
        if (kindGroup(event.kind) !== 'tool') continue
        const data = event.data && typeof event.data === 'object' ? event.data : null
        let name = ''
        if (data && typeof data.tool === 'string' && data.tool) name = data.tool
        else if (typeof event.label === 'string' && event.label) name = event.label
        if (!name) continue
        const tool = byName[name]
        const domainId = tool && tool.organ
          ? tool.organ
          : (typeof event.target === 'string' && event.target ? event.target : 'stomach')
        const kind = String(event.kind || 'tool')
        // Count dispatch calls for tool→domain edges; result/end events are the
        // return leg and must not inflate the outgoing call volume.
        const dispatch = kind.indexOf('.end') < 0 && kind.indexOf('result') < 0
        const key = name + '>' + domainId
        if (dispatch) {
          let edge = edges[key]
          if (!edge) {
            edge = { tool: name, domain: domainId, count: 0, errors: 0, labels: Object.create(null), kinds: Object.create(null) }
            edges[key] = edge
          }
          edge.count += 1
          if (event.ok === false || event.level === 'error') edge.errors += 1
          edge.labels[name] = (edge.labels[name] || 0) + 1
          edge.kinds[kind] = (edge.kinds[kind] || 0) + 1
        }
        let stat = toolsByName[name]
        if (!stat) {
          stat = { name: name, count: 0, domains: Object.create(null), kinds: Object.create(null), labels: Object.create(null) }
          toolsByName[name] = stat
        }
        stat.count += 1
        stat.domains[domainId] = (stat.domains[domainId] || 0) + 1
        stat.kinds[kind] = (stat.kinds[kind] || 0) + 1
        const label = String(event.label || name)
        stat.labels[label] = (stat.labels[label] || 0) + 1
      }
      return { edges: edges, tools: toolsByName }
    }

    function topEntries(map, limit) {
      const rows = []
      const source = map && typeof map === 'object' ? map : {}
      const keys = Object.keys(source)
      for (let i = 0; i < keys.length; i += 1) rows.push({ key: keys[i], count: num(source[keys[i]]) })
      rows.sort(function (a, b) { return b.count - a.count })
      return rows.slice(0, typeof limit === 'number' ? limit : 8)
    }

    /**
     * Top tool nodes for the tool-call view: window activity first, then the
     * snapshot's historical call count. Each node carries its outgoing edges.
     */
    function buildToolView(snapshot, toolFlows) {
      const tools = snapshot && Array.isArray(snapshot.tools) ? snapshot.tools : []
      const stats = toolFlows && toolFlows.tools ? toolFlows.tools : Object.create(null)
      const edges = toolFlows && toolFlows.edges ? toolFlows.edges : Object.create(null)
      const candidates = []
      const seen = Object.create(null)
      for (let i = 0; i < tools.length; i += 1) {
        const tool = tools[i]
        if (!tool || typeof tool.name !== 'string') continue
        seen[tool.name] = true
        const stat = stats[tool.name]
        candidates.push({
          name: tool.name,
          organ: tool.organ || '',
          count: stat ? stat.count : 0,
          calls: num(tool.calls),
          errors: num(tool.errors),
          avgMs: num(tool.avgMs),
          kinds: stat ? stat.kinds : {},
          labels: stat ? stat.labels : {},
          domains: stat ? stat.domains : {},
        })
      }
      const observed = Object.keys(stats)
      for (let i = 0; i < observed.length; i += 1) {
        const name = observed[i]
        if (seen[name]) continue
        const stat = stats[name]
        candidates.push({ name: name, organ: '', count: stat.count, calls: 0, errors: 0, avgMs: 0, kinds: stat.kinds, labels: stat.labels, domains: stat.domains })
      }
      candidates.sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count
        if (b.calls !== a.calls) return b.calls - a.calls
        return String(a.name).localeCompare(String(b.name))
      })
      const selected = candidates.slice(0, TOOL_VIEW_LIMIT)
      const edgesForTool = Object.create(null)
      const edgeKeys = Object.keys(edges)
      for (let i = 0; i < edgeKeys.length; i += 1) {
        const edge = edges[edgeKeys[i]]
        if (!edge) continue
        if (!edgesForTool[edge.tool]) edgesForTool[edge.tool] = []
        edgesForTool[edge.tool].push(edge)
      }
      for (let i = 0; i < selected.length; i += 1) {
        const item = selected[i]
        item.edges = edgesForTool[item.name] || []
        let top = null
        for (let e = 0; e < item.edges.length; e += 1) {
          if (!top || item.edges[e].count > top.count) top = item.edges[e]
        }
        item.topDomain = top
      }
      return selected
    }

    /** Pure geometry for the tool-call view (panels, card rows, labels, kernel). */
    function toolViewGeometry() {
      return {
        left: { x: 32, y: 110, w: 560, h: 500 },
        right: { x: 608, y: 110, w: 600, h: 500 },
        tool: { cols: 2, colX: [170, 430], startY: 172, step: 38, w: 240, h: 30, rowsMax: 12 },
        target: { cols: 1, colX: [908], startY: 166, step: 32, w: 460, h: 26, rowsMax: 14 },
        toolLabel: { x: 40, y: 132, w: 280, h: 20 },
        targetLabel: { x: 616, y: 132, w: 260, h: 20 },
        kernel: { x: 40, y: 618, w: 1160, h: 74 },
      }
    }

    /** Characters that fit in a tool card title once the rate column is reserved. */
    function toolTitleMaxChars(width) {
      return Math.max(8, Math.floor((num(width) - 22 - 82) / 6.8))
    }

    /** Lay out up to 24 tool nodes in two columns inside the tool panel. */
    function layoutToolNodes(toolList) {
      const list = Array.isArray(toolList) ? toolList : []
      const geometry = toolViewGeometry()
      const nodes = []
      for (let i = 0; i < list.length && i < TOOL_VIEW_LIMIT; i += 1) {
        const col = i % geometry.tool.cols
        const row = Math.floor(i / geometry.tool.cols)
        nodes.push({
          id: list[i].name,
          name: list[i].name,
          data: list[i],
          x: geometry.tool.colX[col],
          y: geometry.tool.startY + row * geometry.tool.step,
          w: geometry.tool.w,
          h: geometry.tool.h,
        })
      }
      return nodes
    }

    /** Layout for the 14 target domains in the tool view (3 columns × 5 rows). */
    function layoutToolTargets(nodes) {
      const list = Array.isArray(nodes) ? nodes : []
      const geometry = toolViewGeometry()
      const out = []
      for (let i = 0; i < list.length; i += 1) {
        const col = i % geometry.target.cols
        const row = Math.floor(i / geometry.target.cols)
        out.push({
          id: list[i].id,
          data: list[i],
          x: geometry.target.colX[col],
          y: geometry.target.startY + row * geometry.target.step,
          w: geometry.target.w,
          h: geometry.target.h,
        })
      }
      return out
    }

    /** Tool hover panel rows: the domains this tool affected in the window. */
    function computeToolCallDetail(toolFlows, toolName, zh, limit) {
      const stat = toolFlows && toolFlows.tools ? toolFlows.tools[toolName] : null
      if (!stat) return []
      const rows = topEntries(stat.domains, limit || 6)
      return rows.map(function (row) {
        const def = DOMAIN_BY_ID[row.key]
        return { label: def ? domainTitle(def, zh) : String(row.key), count: row.count, kind: 'tool' }
      })
    }

    /** Domain hover panel rows: tool/event labels touching the domain, 60s. */
    function computeDomainCallDetail(events, domainId, windowMs, limit) {
      const cutoff = Date.now() - (typeof windowMs === 'number' ? windowMs : FLOW_WINDOW_MS)
      const rows = Object.create(null)
      const list = Array.isArray(events) ? events : []
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const event = list[i]
        if (!event || typeof event !== 'object') continue
        const at = num(event.t)
        if (at > 0 && at < cutoff) break
        if (event.organ !== domainId && event.target !== domainId) continue
        const data = event.data && typeof event.data === 'object' ? event.data : null
        const label = data && typeof data.tool === 'string' && data.tool
          ? data.tool
          : String(event.label || event.kind || '')
        const kind = String(event.kind || '')
        let row = rows[label]
        if (!row) {
          row = { label: label, kind: '', count: 0, kinds: Object.create(null) }
          rows[label] = row
        }
        row.count += 1
        row.kinds[kind] = (row.kinds[kind] || 0) + 1
      }
      const out = Object.keys(rows).map(function (key) {
        const row = rows[key]
        const best = topEntries(row.kinds, 1)[0]
        return { label: row.label, kind: best ? best.key : '', count: row.count }
      })
      out.sort(function (a, b) { return b.count - a.count })
      return out.slice(0, typeof limit === 'number' ? limit : 8)
    }

    /** Domain id → up to six representative plugin/tool names (card tooltip). */
    function buildNodeExamples(snapshot) {
      const map = Object.create(null)
      const push = function (organ, name) {
        if (!organ || !name) return
        if (!map[organ]) map[organ] = []
        if (map[organ].length < 6 && map[organ].indexOf(name) < 0) map[organ].push(String(name))
      }
      const plugins = snapshot && Array.isArray(snapshot.plugins) ? snapshot.plugins : []
      for (let i = 0; i < plugins.length; i += 1) {
        const plugin = plugins[i]
        if (plugin) push(plugin.organ, plugin.title || plugin.name || plugin.entryId)
      }
      const tools = snapshot && Array.isArray(snapshot.tools) ? snapshot.tools : []
      for (let i = 0; i < tools.length; i += 1) {
        const tool = tools[i]
        if (tool) push(tool.organ, tool.name)
      }
      return map
    }

    // ---------------------------------------------------------------------
    // Locale dictionaries (zh primary, en fallback). Every visible string in
    // this file resolves through t(); the DOMAIN_DEFS table carries the
    // bilingual domain names that are part of the architecture model.
    // ---------------------------------------------------------------------

    const zh = {
      panel: '架构透视', title: 'DSH 架构透视 · 实时架构', stageLiveTag: '实时架构图',
      openPanel: '在右侧栏打开架构透视', fullscreen: '全屏', recentCalls: '最近调用',
      firstPaintPending: '首屏计时中…', detailPaintPending: '详情计时中…',
      connConnecting: '连接中', connLive: '实时在线', connReconnecting: '重连中', connOffline: '离线',
      pause: '暂停', resume: '继续', paused: '已暂停',
      events: '事件', totalEvents: '累计事件', domains: '组件域', components: '组件',
      tabMetrics: '运行指标', tabComponents: '组件架构', tabCalls: '调用日志',
      overview: '运行总览', detail: '详情', close: '关闭', search: '搜索', noData: '暂无数据', none: '—',
      layerEntry: '入口层', layerReasoning: '推理层', layerExecution: '执行层', layerState: '状态层', layerKernel: '内核与安全层',
      metrics: '指标', eventsPerSec: '事件 (events/s)', eventsPerMin: '事件/分', toolCallsPerMin: '工具调用 (calls/min)',
      llmCallsPerMin: '模型调用 (calls/min)', tokensPerMin: 'Token (tokens/s)', errorsPerMin: '错误 (errors/min)', errors: '错误',
      callsPerMin: '调用/分', avgMs: '平均耗时', throughputTitle: '吞吐趋势', topTools: '调用热度排行', rankEmpty: '暂无调用数据',
      runtime: '运行时', version: '版本', node: '运行环境', platform: '平台', profile: '配置档', pid: '进程号',
      uptime: '运行时长', origin: '站点', startedAt: '启动于',
      diagTitle: '连接诊断', diagBase: 'API 基址', diagTransport: '传输', diagFrames: '已收帧', diagPolls: '轮询', diagState: '状态', diagTheme: '主题', diagError: '最后错误',
      topDomains: '活跃组件域', activity: '活跃度', statusDot: '状态',
      statusActive: '活跃', statusIdle: '待机', statusWarn: '警戒', statusError: '异常', statusOffline: '离线',
      domainDetail: '组件域详情', composition: '组成', relatedEvents: '最近事件', recentEventsNone: '该组件域暂无近期事件',
      pluginDetail: '插件详情', serviceDetail: '服务详情', toolDetail: '工具详情', eventDetail: '事件详情',
      clientBundleDetail: '客户端包详情', modelDetail: '模型详情',
      entryId: '入口', kind: '类型', bundle: '所属包', enabled: '已启用', disabled: '已禁用', pluginPhase: '纤维阶段',
      provider: '提供者', methods: '方法', calls: '调用', label: '标签', ms: '耗时', session: '会话', agent: '代理',
      data: '数据', description: '描述', goDomain: '查看组件域',
      plugins: '插件', services: '服务', tools: '工具', agents: '代理', models: '模型',
      clientBundles: '客户端包', mcp: 'MCP', fibers: '纤维', nodesUnit: '节点', edgesUnit: '连接', layersUnit: '层',
      statusAll: '全部', filterPlaceholder: '过滤标签 / 组件…',
      callTime: '时间', callKind: '类型', callRoute: '从 → 到', callLabel: '标签', callMs: '耗时', callStatus: '状态',
      autoScroll: '自动滚动', statusOk: '成功', statusFail: '失败',
      kindTool: '工具', kindLlm: '模型', kindSession: '会话', kindFs: '文件', kindApproval: '审批', kindPlugin: '插件', kindError: '错误', kindOther: '其他',
      searchPlaceholder: '搜索插件 / 服务 / 工具 / 组件域…', searchEmpty: '无匹配结果',
      emptySearchHint: '输入关键词过滤组件清单', emptyComponents: '无组件数据',
      waitingSnapshot: '等待宿主快照…', noSnapshotData: '快照尚未就绪，显示离线骨架',
      crashTitle: '透视视图故障', crashHint: '渲染遇到异常，运行时行为未受影响。', retry: '重试',
      collapseRail: '收起组件域栏', expandRail: '展开组件域栏', collapseDetail: '收起详情', expandDetail: '展开详情',
      footerNote: '只读旁路观测 · 不改变运行时行为',
      stageHint: '实时调用流 · 点击节点查看详情', liveFlowTag: '实时流量', activeLinks: '活跃链路',
      kernelBandTitle: 'CORDIS 内核 · 插件宿主', kernelFibers: '纤维',
      modelDefault: '默认模型', contextWindow: '上下文窗口', modelProvider: '提供方', modelId: '模型标识',
      clientBundleId: '包入口', clientBundleRev: '版本标识', noSelection: '选择组件域或组件查看详情',
      selectedDomain: '组件域', selectedPlugin: '插件', selectedService: '服务', selectedTool: '工具',
      selectedEvent: '事件', selectedClientBundle: '客户端包', selectedModel: '模型',
      justNow: '刚刚', secAgo: ' 秒前', minAgo: ' 分钟前', hourAgo: ' 小时前', dayAgo: ' 天前',
      viewDomains: '组件域视图', viewTools: '工具调用视图', viewSwitch: '视图',
      help: '交互说明', helpTitle: '交互说明 · 图例与操作', helpClose: '关闭',
      helpClick: '点击组件域 / 工具 → 右侧查看详情',
      helpView: '顶部开关切换「组件域视图 / 工具调用视图」',
      helpHover: '悬停节点 → 高亮相邻连线，左下角显示该节点近 120s 调用明细',
      helpPause: '暂停只冻结动画，数据持续接收；按 Esc 关闭本说明',
      legendTitle: '图例',
      legendDomain: '卡片 = 组件域',
      legendEdge: '实线 = 调用关系 · 粗细 = 近 120s 调用量',
      showAllEdges: '显示全部连线', showTop8Edges: '仅 Top 8', legendEdgeLabel: '连线标签 = 近 120s 调用次数（次/min）',
      legendDot: '光点 = 实时调用',
      legendKernel: '内核带 = 插件宿主',
      selectedBadge: '已选中',
      callDetailTitle: '调用明细 · 近 120s',
      callDetailEmpty: '近 120s 无调用',
      toolViewTitle: '工具调用',
      toolViewTargets: '受影响的组件域',
      callsUnit: '次',
      examples: '代表作',
      edgeDetail: '调用关系详情', edgeFrom: '起点', edgeTo: '终点', edgeCount: '次数 · 近 120s',
      edgeErrors: '错误数', edgeAvgMs: '平均耗时', edgeSources: '按来源明细', edgeKinds: '按类型明细',
      edgeSamples: '最近样本', filterInLog: '在调用日志中过滤', goFrom: '查看起点域', goTo: '查看终点域',
      emptyTraffic: '暂无调用 · 有调用时会在这里流动', windowTag: '近 120s',
      zoomIn: '放大', zoomOut: '缩小', zoomReset: '重置视图', zoomFocus: '聚焦选中项', zoomFocusShort: '聚焦', zoomLabel: '缩放',
      legendHide: '收起图例', upstreamDownstream: '上下游', upstream: '上游 · 入边', downstream: '下游 · 出边',
      noUpstream: '近 120s 无入边', noDownstream: '近 120s 无出边', topSources: '主要来源 / 工具',
      edgeClickHint: '点击连线查看调用关系',
      tabTimeline: '时间线', timelineSessions: '会话', timelineSegments: '调用段',
      timelineEmpty: '暂无调用', timelineLlm: 'LLM 调用', timelineTool: '工具调用',
      timelineOngoing: '进行中', window60: '近 60s', window120: '近 120s',
      providedServices: '它提供的服务', providerPlugin: '提供者插件',
      relatedPlugins: '相关插件', relatedServices: '相关服务',
      causalChain: '因果链', causalNote: '仅显示最近窗口内可见步骤',
      causalEmpty: '最近窗口内没有可关联的步骤',
      causalUser: '用户消息', causalRequest: '请求头', causalLlm: 'LLM 推理',
      causalTool: '工具调用', causalResult: '工具结果', causalAssistant: '助手回复', causalTurn: '回合结束', causalStep: '步骤',
      viewTimeline: '查看时间线', viewCallLog: '在调用日志中过滤', viewDomain: '查看组件域',
      colorLlm: 'LLM', colorTool: '工具', colorSession: '会话', colorFs: '文件', colorApproval: '审批', colorError: '错误', colorPlugin: '插件',
      resizeDrawer: '拖拽调整详情栏宽度', argsResult: '参数与结果', argsPreview: '参数', resultPreview: '结果',
      back: '返回', backTools: '返回工具调用视图', backDomains: '返回组件域视图', backPrevious: '返回上一级',
      allSessions: '全部会话', sessionFilter: '会话过滤', sessionBadge: '会话', currentSessionTag: '(当前)', clearSessionFilter: '清除会话过滤',
      firstPaint: '首屏', detailPaint: '详情',
      latencyDist: '耗时分布 · 近 120s', latencyMin: '最小', latencyAvg: '平均', latencyP50: '中位', latencyMax: '最大',
      relatedLlmCalls: '相关 LLM 调用', timestamp: '时间戳', usageTokens: '令牌用量', tokensIn: '输入', tokensOut: '输出',
      kindFs: '文件', kindShell: '终端', kindWeb: '网络', kindAgent: '代理', kindUi: '界面',
      kindInspect: '检查', kindOther: '其他', kindTool: '工具', kindLlm: 'LLM', kindSession: '会话',
      kindApproval: '审批', kindPlugin: '插件', kindError: '错误',
      phaseActive: '活跃', phaseInactive: '未激活', phasePending: '等待', phaseUnloading: '卸载中', phaseFailed: '失败', phaseUnknown: '未知',
      kindOfficial: '官方', kindThirdParty: '第三方', kindLocal: '本地', kindClient: '客户端',
      pluginSummaryPrefix: '该插件属于', serviceSummaryPrefix: '本服务由插件', serviceSummaryMid: '提供，属于',
      serviceSummaryEnd: '组件域，共', serviceSummarySuffix: '个方法', methodsTitle: '方法（接口名）',
      clientBundleSummary: '客户端 Bundle：Web 客户端资源包', modelSummary: '模型信息：由提供方提供并用于推理',
      dataKeyTool: '工具', dataKeyCallId: '调用 ID', dataKeyArgsPreview: '参数预览', dataKeyResultPreview: '结果预览',
      dataKeyOk: '成功', dataKeyMs: '耗时', dataKeyCount: '次数', dataKeyProvider: '提供方', dataKeyModel: '模型',
      dataKeyUsage: '用量', dataKeyPurpose: '用途', dataKeyReason: '原因', dataKeySource: '来源', dataKeyType: '类型',
      dataKeySeq: '序号', dataKeyStatus: '状态', dataKeyOrgan: '来源域', dataKeyTarget: '目标域', dataKeyLabel: '标签',
      dataKeyName: '名称', dataKeyKind: '类型', dataKeyLevel: '级别', dataKeySessionId: '会话 ID',
      sourceGithubMcp: 'GitHub MCP', sourceCordis: 'Cordis 工具', sourceHindsight: 'Hindsight 记忆',
      sourceMcp: 'MCP 工具', sourceGit: 'Git 工具', sourceLocal: '本地工具', sourceUnknown: '未识别来源',
      statCalls: '调用次数', statErrors: '错误数', statAvgMs: '平均耗时', statLastMs: '最近耗时',
      originalDescription: '原始描述（英文）', toolFromDomain: '所属组件域：', toolSource: '工具来源',
      toolZhTitle: '中文说明', autoParsed: '（自动解析名称，暂无内置中文说明）',
      expandEnglish: '展开英文原文', collapseEnglish: '收起英文原文', originalText: '英文原文',
      statusRunning: '运行中', statusIdle: '空闲', statusWaiting: '等待数据',
      statusIdleConnected: '已连接 · 空闲', statusPaused: '已暂停', statusOffline: '离线', statusReconnecting: '重连中',
      statusLoadingDetails: '加载详情…', statusLastEvent: '最近事件', statusNoEvents: '暂无事件',
      secondsAgo: '秒前', justNowShort: '刚刚', connectingDataStream: '正在连接 Host 数据流…',
      hudRecent: '近 120s 事件', hudLinks: '活跃链路',
    }

    const en = {
      panel: 'Architecture', title: 'DSH LIVE ARCHITECTURE · HUD', stageLiveTag: 'LIVE ARCHITECTURE',
      openPanel: 'Open architecture in the right sidebar', fullscreen: 'Fullscreen', recentCalls: 'Recent calls',
      firstPaintPending: 'First paint timing…', detailPaintPending: 'Details timing…',
      connConnecting: 'Connecting', connLive: 'Live', connReconnecting: 'Reconnecting', connOffline: 'Offline',
      pause: 'Pause', resume: 'Resume', paused: 'PAUSED',
      events: 'Events', totalEvents: 'Total events', domains: 'Domains', components: 'Components',
      tabMetrics: 'Runtime metrics', tabComponents: 'Component architecture', tabCalls: 'Call log',
      overview: 'Runtime overview', detail: 'Detail', close: 'Close', search: 'Search', noData: 'No data', none: '—',
      layerEntry: 'ENTRY', layerReasoning: 'REASONING', layerExecution: 'EXECUTION', layerState: 'STATE', layerKernel: 'KERNEL & SECURITY',
      metrics: 'Metrics', eventsPerSec: 'Events (events/s)', eventsPerMin: 'events/min', toolCallsPerMin: 'Tool calls (calls/min)',
      llmCallsPerMin: 'Model calls (calls/min)', tokensPerMin: 'Tokens (tokens/s)', errorsPerMin: 'Errors (errors/min)', errors: 'errors',
      callsPerMin: 'calls/min', avgMs: 'avg latency', throughputTitle: 'Throughput trend', topTools: 'Top tools', rankEmpty: 'No call data yet',
      runtime: 'Runtime', version: 'Version', node: 'Node', platform: 'Platform', profile: 'Profile', pid: 'PID',
      uptime: 'Uptime', origin: 'Origin', startedAt: 'Started',
      diagTitle: 'Connection diagnostics', diagBase: 'API base', diagTransport: 'Transport', diagFrames: 'Frames', diagPolls: 'polls', diagState: 'State', diagTheme: 'Theme', diagError: 'Last error',
      topDomains: 'Busiest domains', activity: 'activity', statusDot: 'Status',
      statusActive: 'active', statusIdle: 'idle', statusWarn: 'warn', statusError: 'error', statusOffline: 'offline',
      domainDetail: 'Domain detail', composition: 'Composition', relatedEvents: 'Recent events', recentEventsNone: 'No recent events for this domain',
      pluginDetail: 'Plugin detail', serviceDetail: 'Service detail', toolDetail: 'Tool detail', eventDetail: 'Event detail',
      clientBundleDetail: 'Client bundle detail', modelDetail: 'Model detail',
      entryId: 'Entry', kind: 'Kind', bundle: 'Bundle', enabled: 'enabled', disabled: 'disabled', pluginPhase: 'Fiber phase',
      provider: 'Provider', methods: 'Methods', calls: 'calls', label: 'Label', ms: 'Latency', session: 'Session', agent: 'Agent',
      data: 'Data', description: 'Description', goDomain: 'View domain',
      plugins: 'plugins', services: 'services', tools: 'tools', agents: 'agents', models: 'models',
      clientBundles: 'client bundles', mcp: 'MCP', fibers: 'Fibers', nodesUnit: 'nodes', edgesUnit: 'edges', layersUnit: 'layers',
      statusAll: 'All', filterPlaceholder: 'Filter by label / component…',
      callTime: 'Time', callKind: 'Kind', callRoute: 'From → to', callLabel: 'Label', callMs: 'Latency', callStatus: 'Status',
      autoScroll: 'Auto-scroll', statusOk: 'ok', statusFail: 'fail',
      kindTool: 'tool', kindLlm: 'llm', kindSession: 'session', kindFs: 'fs', kindApproval: 'approval', kindPlugin: 'plugin', kindError: 'error', kindOther: 'other',
      searchPlaceholder: 'Search plugins / services / tools / domains…', searchEmpty: 'No matches',
      emptySearchHint: 'Type to filter the component list', emptyComponents: 'No component data',
      waitingSnapshot: 'Waiting for host snapshot…', noSnapshotData: 'Snapshot not ready — showing the offline skeleton',
      crashTitle: 'Architecture view crashed', crashHint: 'A rendering error occurred; runtime behaviour is unaffected.', retry: 'Retry',
      collapseRail: 'Collapse domain rail', expandRail: 'Expand domain rail', collapseDetail: 'Collapse detail', expandDetail: 'Expand detail',
      footerNote: 'Read-only side-channel observation · runtime behaviour untouched',
      stageHint: 'Live call flow · click a node for details', liveFlowTag: 'LIVE FLOW', activeLinks: 'active links',
      kernelBandTitle: 'CORDIS KERNEL · HOST LAYER', kernelFibers: 'Fibers',
      modelDefault: 'Default model', contextWindow: 'Context window', modelProvider: 'Provider', modelId: 'Model ID',
      clientBundleId: 'Bundle entry', clientBundleRev: 'Revision', noSelection: 'Select a domain or component to inspect it',
      selectedDomain: 'Domain', selectedPlugin: 'Plugin', selectedService: 'Service', selectedTool: 'Tool',
      selectedEvent: 'Event', selectedClientBundle: 'Client bundle', selectedModel: 'Model',
      justNow: 'just now', secAgo: 's ago', minAgo: 'm ago', hourAgo: 'h ago', dayAgo: 'd ago',
      viewDomains: 'Domain view', viewTools: 'Tool-call view', viewSwitch: 'View',
      help: 'Help', helpTitle: 'HOW TO READ', helpClose: 'Close',
      helpClick: 'Click a domain / tool to inspect it on the right',
      helpView: 'Switch views at the top: Domain view ↔ Tool-call view',
      helpHover: 'Hover a node to highlight its links and show that node\'s last-120s call breakdown (bottom-left)',
      helpPause: 'Pause freezes the animation only; press Esc to close this help',
      legendTitle: 'Legend',
      legendDomain: 'card = domain',
      legendEdge: 'solid line = call link · width = last-120s volume',
      showAllEdges: 'Show all links', showTop8Edges: 'Top 8 only', legendEdgeLabel: 'edge label = calls in the last 120s (calls/min)',
      legendDot: 'dot = live call',
      legendKernel: 'kernel band = plugin host',
      selectedBadge: 'selected',
      callDetailTitle: 'Call detail · last 120s',
      callDetailEmpty: 'no calls in the last 120s',
      toolViewTitle: 'Tool calls',
      toolViewTargets: 'Affected domains',
      callsUnit: 'calls',
      examples: 'Top',
      edgeDetail: 'Call relation detail', edgeFrom: 'From', edgeTo: 'To', edgeCount: 'Count · last 120s',
      edgeErrors: 'Errors', edgeAvgMs: 'Avg latency', edgeSources: 'Sources', edgeKinds: 'Event kinds',
      edgeSamples: 'Recent samples', filterInLog: 'Filter call log', goFrom: 'View source domain', goTo: 'View target domain',
      emptyTraffic: 'No calls yet · calls will flow here while running', windowTag: 'last 120s',
      zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset view', zoomFocus: 'Focus selection', zoomFocusShort: 'Focus', zoomLabel: 'Zoom',
      legendHide: 'Collapse legend', upstreamDownstream: 'Upstream / downstream', upstream: 'Upstream · inbound', downstream: 'Downstream · outbound',
      noUpstream: 'No inbound edges in the last 120s', noDownstream: 'No outbound edges in the last 120s', topSources: 'Top sources / tools',
      edgeClickHint: 'Click a link to inspect the call relation',
      tabTimeline: 'Timeline', timelineSessions: 'sessions', timelineSegments: 'call segments',
      timelineEmpty: 'No calls yet', timelineLlm: 'LLM call', timelineTool: 'Tool call',
      timelineOngoing: 'ongoing', window60: 'last 60s', window120: 'last 120s',
      providedServices: 'Services it provides', providerPlugin: 'Provider plugin',
      relatedPlugins: 'Related plugins', relatedServices: 'Related services',
      causalChain: 'Causal chain', causalNote: 'only steps visible in the recent window are shown',
      causalEmpty: 'No related steps in the current window',
      causalUser: 'user', causalRequest: 'request', causalLlm: 'LLM',
      causalTool: 'tool call', causalResult: 'tool result', causalAssistant: 'assistant', causalTurn: 'turn end', causalStep: 'step',
      viewTimeline: 'View timeline', viewCallLog: 'Filter call log', viewDomain: 'View domain',
      colorLlm: 'LLM', colorTool: 'tool', colorSession: 'session', colorFs: 'fs', colorApproval: 'approval', colorError: 'error', colorPlugin: 'plugin',
      resizeDrawer: 'Drag to resize the detail panel', argsResult: 'Arguments & result', argsPreview: 'Arguments', resultPreview: 'Result',
      back: 'Back', backTools: 'Back to tool-call view', backDomains: 'Back to domain view', backPrevious: 'Back one level',
      allSessions: 'All sessions', sessionFilter: 'Session filter', sessionBadge: 'Session', currentSessionTag: '(current)', clearSessionFilter: 'Clear session filter',
      firstPaint: 'First paint', detailPaint: 'Details',
      latencyDist: 'Latency distribution · last 120s', latencyMin: 'min', latencyAvg: 'avg', latencyP50: 'p50', latencyMax: 'max',
      relatedLlmCalls: 'Related LLM calls', timestamp: 'Timestamp', usageTokens: 'Token usage', tokensIn: 'input', tokensOut: 'output',
      kindFs: 'file', kindShell: 'terminal', kindWeb: 'network', kindAgent: 'agent', kindUi: 'ui',
      kindInspect: 'inspect', kindOther: 'other', kindTool: 'tool', kindLlm: 'LLM', kindSession: 'session',
      kindApproval: 'approval', kindPlugin: 'plugin', kindError: 'error',
      phaseActive: 'active', phaseInactive: 'inactive', phasePending: 'pending', phaseUnloading: 'unloading', phaseFailed: 'failed', phaseUnknown: 'unknown',
      kindOfficial: 'official', kindThirdParty: 'third-party', kindLocal: 'local', kindClient: 'client',
      pluginSummaryPrefix: 'This plugin belongs to', serviceSummaryPrefix: 'Provided by plugin', serviceSummaryMid: 'in domain',
      serviceSummaryEnd: 'with', serviceSummarySuffix: 'methods', methodsTitle: 'Methods (interface names)',
      clientBundleSummary: 'Client bundle: Web client asset package', modelSummary: 'Model info: provided by provider for inference',
      dataKeyTool: 'tool', dataKeyCallId: 'call ID', dataKeyArgsPreview: 'arguments preview', dataKeyResultPreview: 'result preview',
      dataKeyOk: 'ok', dataKeyMs: 'duration', dataKeyCount: 'count', dataKeyProvider: 'provider', dataKeyModel: 'model',
      dataKeyUsage: 'usage', dataKeyPurpose: 'purpose', dataKeyReason: 'reason', dataKeySource: 'source', dataKeyType: 'type',
      dataKeySeq: 'seq', dataKeyStatus: 'status', dataKeyOrgan: 'source domain', dataKeyTarget: 'target domain', dataKeyLabel: 'label',
      dataKeyName: 'name', dataKeyKind: 'kind', dataKeyLevel: 'level', dataKeySessionId: 'session ID',
      sourceGithubMcp: 'GitHub MCP', sourceCordis: 'Cordis tool', sourceHindsight: 'Hindsight memory',
      sourceMcp: 'MCP tool', sourceGit: 'Git tool', sourceLocal: 'local tool', sourceUnknown: 'unknown source',
      statCalls: 'Calls', statErrors: 'Errors', statAvgMs: 'Avg latency', statLastMs: 'Last latency',
      originalDescription: 'Original description (English)', toolFromDomain: 'Owning domain:', toolSource: 'Source',
      toolZhTitle: 'Chinese summary', autoParsed: '(auto-parsed name, no built-in Chinese summary)',
      expandEnglish: 'Show English original', collapseEnglish: 'Hide English original', originalText: 'English original',
      statusRunning: 'running', statusIdle: 'idle', statusWaiting: 'waiting for data',
      statusIdleConnected: 'idle · connected', statusPaused: 'paused', statusOffline: 'offline', statusReconnecting: 'reconnecting',
      statusLoadingDetails: 'Loading details…', statusLastEvent: 'Last event', statusNoEvents: 'no events yet',
      secondsAgo: 's ago', justNowShort: 'just now', connectingDataStream: 'Connecting to Host data stream…',
      hudRecent: 'last-120s events', hudLinks: 'active links',
    }

    /** Localized layer label for the five architecture layers. */
    function layerLabelKey(layerId) {
      const id = String(layerId || '')
      if (!id) return 'layerEntry'
      return 'layer' + id.charAt(0).toUpperCase() + id.slice(1)
    }

    /** Relative time label (刚刚 / 12 秒前 ...). */
    function fmtRel(epochMs, t) {
      const n = Number(epochMs)
      if (!Number.isFinite(n) || n <= 0) return ''
      const delta = Date.now() - n
      if (delta < 5000) return t('justNow')
      if (delta < 60000) return Math.round(delta / 1000) + t('secAgo')
      if (delta < 3600000) return Math.round(delta / 60000) + t('minAgo')
      if (delta < 86400000) return Math.round(delta / 3600000) + t('hourAgo')
      return Math.round(delta / 86400000) + t('dayAgo')
    }

    function fallbackT(key) {
      return String(key)
    }

    // ---------------------------------------------------------------------
    // Stylesheet. Rendered as a React <style> element inside the page root, so
    // unmounting the page removes it; every class name is namespaced `da-`.
    // Controls use `--dsw-alias-*` tokens; the diagram artwork may use its own
    // technical palette (cyan/violet/amber…) as the contract allows.
    // ---------------------------------------------------------------------

    const CSS_TEXT = `
.da-root {
  --da-cyan: #3ee8ff; --da-blue: #4f9dff; --da-violet: #b18cff; --da-amber: #ffc04d;
  --da-red: #ff5f6d; --da-magenta: #ff6ad5; --da-green: #3ddc97;
  --da-ink: rgba(4,10,18,0.92); --da-ink-2: rgba(9,19,30,0.86);
  --da-line: rgba(62,232,255,0.16); --da-line-soft: rgba(62,232,255,0.08);
  --da-mono: var(--ds-font-family-code, ui-monospace, "Cascadia Mono", Consolas, monospace);
  position: relative; display: flex; flex-direction: column; width: 100%; height: 100%;
  min-width: 0; min-height: 0; overflow: hidden; box-sizing: border-box;
  color: var(--dsw-alias-label-primary, #dff1ff); background: var(--dsw-alias-bg-base, #060b12);
  font-family: inherit; font-size: 13px; line-height: 1.45;
}
.da-root *, .da-root *::before, .da-root *::after { box-sizing: border-box; }
.da-root ::selection { background: rgba(62,232,255,0.25); }
.da-scroll { overflow: auto; scrollbar-width: thin; }
.da-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.da-scroll::-webkit-scrollbar-thumb { background: rgba(120,180,220,0.22); border-radius: 4px; }
.da-scroll::-webkit-scrollbar-track { background: transparent; }
.da-mono { font-family: var(--da-mono); }

/* header */
.da-header { flex: none; display: flex; align-items: center; gap: 12px; height: 54px; padding: 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); background: var(--dsw-alias-bg-layer-1, #0c141e); }
.da-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.da-logo { flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--da-cyan); border: 1px solid var(--da-line); background: radial-gradient(circle at 50% 45%, rgba(62,232,255,0.20), rgba(9,19,30,0) 72%); box-shadow: inset 0 0 14px rgba(62,232,255,0.12); }
.da-titles { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.da-title { display: flex; align-items: baseline; gap: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.06em; white-space: nowrap; }
.da-livetag { font-family: var(--da-mono); font-size: 9px; letter-spacing: 0.18em; color: var(--da-cyan); opacity: 0.85; }
.da-sub { font-family: var(--da-mono); font-size: 10.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46vw; }
.da-spacer { flex: 1 1 auto; min-width: 8px; }
.da-status { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 3px 9px; border-radius: 999px; font-family: var(--da-mono); font-size: 10.5px; letter-spacing: 0.04em; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-layer-2, #101a26); color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-status.da-status-live { color: var(--dsw-alias-state-success-primary, #3ddc97); border-color: currentColor; }
.da-status.da-status-offline { color: var(--dsw-alias-state-error-primary, #ff5f6d); border-color: currentColor; }
.da-status.da-status-reconnecting { color: var(--dsw-alias-state-warn-primary, #ffc04d); border-color: currentColor; }
.da-dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 7px currentColor; }
.da-dot-pulse { animation: none; }
.da-paused-tag { animation: none; }
.da-btn { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 6px; font: inherit; font-size: 11.5px; cursor: pointer; color: var(--dsw-alias-label-primary, #dff1ff); background: var(--dsw-alias-bg-layer-2, #101a26); border: 1px solid var(--dsw-alias-border-l1, #22303e); }
.da-btn:hover { border-color: var(--dsw-alias-border-l2, #33465a); background: rgba(255,255,255,0.06); }
.da-btn.da-btn-icon { width: 28px; padding: 0; justify-content: center; }
.da-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #3ee8ff); outline-offset: -2px; }

/* three-column body */
.da-main { flex: 1 1 auto; display: flex; min-height: 0; min-width: 0; }
.da-rail { flex: none; width: 238px; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); background: var(--dsw-alias-bg-layer-1, #0c141e); transition: width 0.16s ease; }
.da-rail.da-collapsed { width: 58px; }
.da-rail-head { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 10px 6px; }
.da-rail-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-family: var(--da-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-search { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-base, #060b12); color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-search:focus-within { border-color: var(--da-line); }
.da-search-input { flex: 1; min-width: 0; height: 100%; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary, #dff1ff); font: inherit; font-size: 11.5px; }
.da-search-input::placeholder { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-results { flex: none; display: flex; flex-direction: column; gap: 1px; max-height: 44%; padding: 4px 6px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); }
.da-result { display: flex; align-items: center; gap: 7px; width: 100%; padding: 4px 5px; border: none; border-radius: 5px; background: transparent; color: inherit; font: inherit; font-size: 11.5px; text-align: left; cursor: pointer; }
.da-result:hover { background: rgba(255,255,255,0.06); }
.da-result.da-selected { background: rgba(62,232,255,0.10); }
.da-result-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.da-result-name { font-family: var(--da-mono); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-result-sub { font-family: var(--da-mono); font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-result-empty { padding: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-rail-list { flex: 1 1 auto; min-height: 0; padding: 2px 6px 10px; overflow-y: auto; overflow-x: hidden; }
@media (max-width: 1120px) { .da-rail { width: 206px; } }
@media (max-width: 880px) { .da-rail { display: none; } }
.da-layer-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 5px 3px; font-family: var(--da-mono); font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(126,208,255,0.7); }
.da-layer-head b { font-weight: 500; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-domain { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 6px; margin: 1px 0; border-radius: 6px; border: 1px solid transparent; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.da-domain:hover { background: rgba(255,255,255,0.05); }
.da-domain.da-selected { border-color: var(--da-line); background: linear-gradient(90deg, rgba(62,232,255,0.12), rgba(62,232,255,0.02)); }
.da-domain-icon { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-domain.da-selected .da-domain-icon { color: var(--da-cyan); }
.da-domain-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.da-domain-name { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-rank-track { flex: 1 1 auto; min-width: 24px; max-width: 110px; display: flex; align-items: center; }
.da-domain-bar { width: 100%; min-width: 0; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.07); overflow: hidden; }
.da-domain-bar > i { display: block; height: 100%; border-radius: 2px; transition: width 0.4s ease; }
.da-domain-badge { flex: none; font-family: var(--da-mono); font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); min-width: 18px; text-align: right; }
.da-rail.da-collapsed .da-rail-title, .da-rail.da-collapsed .da-search, .da-rail.da-collapsed .da-results,
.da-rail.da-collapsed .da-domain-body, .da-rail.da-collapsed .da-domain-badge, .da-rail.da-collapsed .da-layer-head { display: none; }
.da-rail.da-collapsed .da-domain { justify-content: center; padding: 7px 0; }

/* stage */
.da-stage-wrap { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.da-stage { position: relative; flex: 1 1 auto; min-height: 0; margin: 10px 10px 0; overflow: hidden; border-radius: 8px; border: 1px solid var(--da-line); background: var(--da-ink); }
.da-stage-grid { position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(rgba(62,232,255,0.02) 1px, transparent 1px); background-size: 24px 24px; -webkit-mask-image: linear-gradient(180deg, #000 70%, transparent); mask-image: linear-gradient(180deg, #000 70%, transparent); }
.da-layer-sep { stroke: rgba(96,196,246,0.10); stroke-width: 1; stroke-dasharray: 2 10; }
.da-stage-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.da-stage-svgwrap { position: absolute; inset: 0; }
.da-zoom-pct { height: 20px; text-align: center; font-family: var(--da-mono); font-size: 9.5px; line-height: 20px; color: rgba(190,235,255,0.85); }
.da-stage { cursor: grab; outline: none; touch-action: none; }
.da-stage:focus-visible { box-shadow: inset 0 0 0 1px rgba(62,232,255,0.35); }
.da-stage.da-dragging { cursor: grabbing; user-select: none; }
.da-stage.da-dragging .da-stage-svgwrap { pointer-events: none; }
.da-corner { position: absolute; width: 16px; height: 16px; pointer-events: none; border: 0 solid rgba(62,232,255,0.55); }
.da-corner-tl { left: 6px; top: 6px; border-left-width: 1px; border-top-width: 1px; }
.da-corner-tr { right: 6px; top: 6px; border-right-width: 1px; border-top-width: 1px; }
.da-corner-bl { left: 6px; bottom: 6px; border-left-width: 1px; border-bottom-width: 1px; }
.da-corner-br { right: 6px; bottom: 6px; border-right-width: 1px; border-bottom-width: 1px; }
.da-stage-hud { position: absolute; pointer-events: none; font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.14em; line-height: 1.6; color: rgba(126,208,255,0.55); text-transform: uppercase; }
.da-hud-tl { left: 16px; top: 12px; }
.da-hud-tr { right: 16px; top: 12px; text-align: right; }
.da-hud-bl { left: 16px; bottom: 12px; }
.da-hud-br { right: 16px; bottom: 12px; text-align: right; }
.da-hud-strong { color: rgba(190,240,255,0.85); }
.da-paused-tag { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); padding: 3px 12px; border-radius: 999px; border: 1px solid var(--dsw-alias-state-warn-primary, #ffc04d); color: var(--dsw-alias-state-warn-primary, #ffc04d); background: rgba(20,14,2,0.7); font-family: var(--da-mono); font-size: 10px; letter-spacing: 0.16em; pointer-events: none; animation: da-pulse 2s ease-in-out infinite; }
.da-empty-overlay { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary, #8fa3b8); font-family: var(--da-mono); font-size: 11px; text-align: center; pointer-events: none; }
.da-spin { display: inline-block; width: 16px; height: 16px; border-radius: 50%; border: 1px solid currentColor; border-top-color: transparent; animation: da-spin 1s linear infinite; }

/* SVG layered diagram */
.da-layer-band { fill: rgba(62,232,255,0.018); stroke: rgba(62,232,255,0.09); stroke-width: 1; }
.da-layer-band.da-layer-alt { fill: rgba(120,150,255,0.022); }
.da-layer-label { fill: rgba(165,228,255,0.82); font-family: var(--da-mono); font-size: 15px; letter-spacing: 0.12em; }
.da-layer-sub { fill: rgba(140,205,240,0.46); font-family: var(--da-mono); font-size: 10px; letter-spacing: 0.14em; }
.da-node { cursor: pointer; }
.da-node-card { fill: rgba(10,22,34,0.96); stroke: rgba(120,214,255,0.32); stroke-width: 1.1; transition: fill 0.15s ease, stroke 0.15s ease; }
.da-node:hover .da-node-card { fill: rgba(15,32,48,0.98); stroke: rgba(140,228,255,0.6); }
.da-node.da-node-on .da-node-card { stroke: rgba(62,232,255,0.42); }
.da-node.da-node-dim { opacity: 0.45; }
.da-node-selected { fill: rgba(62,232,255,0.10); stroke: var(--dsw-alias-brand-primary, #3ee8ff); stroke-width: 1; }
.da-node-badge-bg { fill: rgba(9,30,43,0.96); stroke: var(--dsw-alias-brand-primary, #3ee8ff); stroke-width: 1; }
.da-node-badge-text { fill: var(--dsw-alias-brand-primary, #3ee8ff); font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.04em; }
.da-node-title { fill: #f4fbff; font-size: 14px; font-weight: 600; letter-spacing: 0.01em; }
.da-node-sub { fill: rgba(185,222,246,0.85); font-size: 11px; }
.da-node-examples { fill: rgba(185,225,248,0.82); font-family: var(--da-mono); font-size: 10px; }
.da-node-counts { fill: rgba(190,226,246,0.9); font-family: var(--da-mono); font-size: 10px; }
.da-node-status { font-family: var(--da-mono); font-size: 10.5px; letter-spacing: 0.04em; }
.da-node-bar-bg { fill: rgba(255,255,255,0.08); }
.da-edge { fill: none; stroke: rgba(96,196,246,0.13); stroke-width: 1; stroke-dasharray: 4 9; animation: da-dash 14s linear infinite; }
.da-edge-flow { fill: none; stroke-linecap: round; stroke-linejoin: round; transition: opacity 0.12s ease, stroke-width 0.12s ease; }
.da-edge-flow.da-edge-dim, .da-edge.da-edge-dim { opacity: 0.12 !important; }
.da-edge-flow.da-edge-hot { filter: none; }
.da-node-popover { pointer-events: none; }
.da-popover-bg { fill: rgba(6,16,25,0.97); stroke: rgba(96,214,255,0.42); stroke-width: 1; }
.da-popover-title { fill: rgba(205,242,255,0.95); font-family: var(--da-mono); font-size: 11px; }
.da-popover-sub { fill: rgba(175,215,240,0.8); font-size: 10px; }
.da-popover-stat { fill: rgba(120,228,255,0.95); font-family: var(--da-mono); font-size: 10.5px; }
.da-popover-examples { fill: rgba(185,225,248,0.78); font-family: var(--da-mono); font-size: 9.5px; }
.da-layer-box { fill: none; stroke: rgba(140,210,245,0.22); stroke-width: 1; stroke-dasharray: 4 6; pointer-events: none; }
.da-flow-dot { pointer-events: none; }
.da-flow-flash { pointer-events: none; }
.da-empty-traffic { position: absolute; left: 50%; top: 52px; transform: translateX(-50%); padding: 5px 12px; border-radius: 999px; border: 1px dashed rgba(96,206,246,0.3); background: rgba(6,15,23,0.62); color: rgba(185,222,246,0.8); font-family: var(--da-mono); font-size: 10.5px; letter-spacing: 0.04em; pointer-events: none; z-index: 3; }
/* drawer card surfaces are scoped to .da-drawer-cards (the bare .da-cards class
   belongs to the bottom-console metrics grid and must never apply to the drawer) */
.da-stat-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.da-stat-item { flex: 1 1 92px; min-width: 88px; padding: 9px 10px; border-radius: 10px; border: 1px solid rgba(120,170,205,0.14); background: rgba(14,26,38,0.7); display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.da-stat-value { font-family: var(--da-mono); font-size: 17px; font-weight: 600; color: #eafaff; }
.da-stat-label { font-size: 9px; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #8fa3b8); text-transform: uppercase; }
.da-detail-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.da-causal { display: flex; flex-direction: column; gap: 4px; }
.da-causal-list { display: flex; flex-direction: column; gap: 2px; }
.da-causal-step { display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 5px; border: none; border-radius: 7px; background: transparent; color: inherit; font: inherit; font-size: 10.5px; text-align: left; cursor: pointer; }
.da-causal-step:hover, .da-causal-step.da-active { background: rgba(62,232,255,0.08); }
.da-causal-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; }
.da-causal-kind { flex: none; font-family: var(--da-mono); font-size: 9px; letter-spacing: 0.04em; }
.da-causal-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e6f6ff; }
.da-causal-time { flex: none; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-pre { margin: 0; padding: 8px 9px; border-radius: 8px; border: 1px solid rgba(120,170,205,0.16); background: rgba(6,14,22,0.72); font-family: var(--da-mono); font-size: 10px; line-height: 1.5; color: #d9efff; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-height: 120px; overflow: auto; }
.da-causal-ok { flex: none; font-size: 8px; }
.da-causal-note { margin-top: 5px; font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); opacity: 0.85; }
.da-causal-empty { font-size: 11px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-zoomctl { position: absolute; right: 14px; bottom: 52px; display: flex; flex-direction: column; gap: 4px; z-index: 4; }
.da-zoom-btn { width: 30px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 6px; border: 1px solid rgba(110,200,240,0.35); background: rgba(7,17,27,0.9); color: rgba(210,240,255,0.9); font-family: var(--da-mono); font-size: 12px; cursor: pointer; padding: 0; }
.da-zoom-btn:hover { border-color: rgba(120,224,255,0.7); color: #eafaff; }
.da-zoom-btn.da-zoom-fit { width: 30px; font-size: 10px; color: rgba(120,228,255,0.95); }
.da-node-popover .da-popover-bg { filter: none; }
.da-edge-label { fill: rgba(215,244,255,0.96); font-family: var(--da-mono); font-size: 12.5px; }
.da-edge-label.da-edge-label-error { fill: rgba(255,160,165,0.98); }
.da-edge-label-bg { fill: rgba(5,14,22,0.94); stroke: rgba(96,196,246,0.28); stroke-width: 0.8; }
.da-grid-line { stroke: rgba(62,232,255,0.03); stroke-width: 1; }
.da-kernel-band { fill: rgba(10,24,38,0.94); stroke: rgba(62,232,255,0.20); stroke-width: 1; }
.da-kernel-band:hover { stroke: rgba(62,232,255,0.45); }
.da-kernel-title { fill: rgba(200,244,255,0.9); font-family: var(--da-mono); font-size: 14px; letter-spacing: 0.14em; }
.da-kernel-sub { fill: rgba(140,208,240,0.5); font-family: var(--da-mono); font-size: 10px; letter-spacing: 0.1em; }
.da-kernel-stat { fill: rgba(175,222,245,0.82); font-family: var(--da-mono); font-size: 11px; }

/* tool-call view */
.da-panel { fill: rgba(8,18,28,0.72); stroke: rgba(62,232,255,0.14); stroke-width: 1; }
.da-panel-title { fill: rgba(190,240,255,0.85); font-family: var(--da-mono); font-size: 13px; letter-spacing: 0.12em; }
.da-panel-sub { fill: rgba(140,205,240,0.5); font-family: var(--da-mono); font-size: 10px; }
.da-panel-back { fill: rgba(62,232,255,0.85); font-family: var(--da-mono); font-size: 11px; }
.da-tool-node { cursor: pointer; }
.da-tool-card { fill: rgba(10,22,34,0.94); stroke: rgba(62,232,255,0.2); stroke-width: 1; transition: fill 0.15s ease, stroke 0.15s ease; }
.da-tool-node:hover .da-tool-card { fill: rgba(15,32,48,0.97); stroke: rgba(62,232,255,0.45); }
.da-tool-selected { fill: rgba(62,232,255,0.10); stroke: var(--dsw-alias-brand-primary, #3ee8ff); stroke-width: 1; }
.da-tool-dim { opacity: 0.4; }
.da-tool-title { fill: #eef8ff; font-family: var(--da-mono); font-size: 13px; }
.da-tool-meta { fill: rgba(170,212,238,0.68); font-family: var(--da-mono); font-size: 10px; }
.da-tool-count { fill: rgba(62,232,255,0.9); font-family: var(--da-mono); font-size: 11px; }

/* right drawer */
.da-drawer { position: relative; flex: none; width: var(--da-drawer-w, clamp(300px, 24vw, 360px)); min-width: 272px; max-width: 420px; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); background: var(--dsw-alias-bg-layer-1, #0c141e); }
.da-drawer.da-collapsed { display: none; }
.da-drawer-resize { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 6; background: transparent; }
.da-drawer-resize::after { content: ''; position: absolute; left: 3px; top: 40%; bottom: 40%; width: 2px; border-radius: 2px; background: rgba(140,210,245,0.22); }
.da-drawer-resize:hover::after { background: var(--da-cyan, #3ee8ff); box-shadow: 0 0 6px rgba(62,232,255,0.5); }
.da-drawer.da-resizing { user-select: none; }
@media (max-width: 899px) {
  .da-drawer { position: fixed; right: 0; top: 0; bottom: 0; width: min(92vw, 420px); min-width: 0; max-width: none; z-index: 40; box-shadow: -18px 0 40px rgba(0,0,0,0.45); }
}
.da-drawer-head { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 40px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); }
.da-drawer-headtext { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.da-drawer-breadcrumb { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--da-mono); font-size: 9px; letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-drawer-back { flex: none; font-size: 14px; }
.da-drawer-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--da-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-drawer-body { flex: 1 1 auto; min-height: 0; padding: 10px 12px 28px; overflow-x: hidden; }
.da-drawer-body.da-scroll { overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.da-drawer-cards { min-width: 0; max-width: 100%; }
.da-drawer-cards .da-domain-head { padding: 12px 14px; margin-bottom: 10px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: linear-gradient(180deg, rgba(22,40,58,0.72), rgba(10,20,30,0.72)); backdrop-filter: blur(8px); }
.da-drawer-cards .da-section { padding: 12px 14px; margin-bottom: 10px; border-radius: 12px; border: 1px solid rgba(120,170,205,0.14); background: linear-gradient(180deg, rgba(17,31,45,0.66), rgba(10,19,28,0.66)); backdrop-filter: blur(6px); }
.da-drawer-cards .da-section .da-section { padding: 0; margin: 0; border: none; background: none; backdrop-filter: none; }
.da-drawer-cards .da-section > * + * { margin-top: 7px; }
.da-drawer-cards .da-domain-head, .da-drawer-cards .da-section { max-width: 100%; min-width: 0; box-sizing: border-box; overflow-wrap: anywhere; }
.da-overview { display: flex; flex-direction: column; gap: 10px; min-width: 0; max-width: 100%; }
.da-overview > * { min-width: 0; max-width: 100%; }
.da-overview .da-section { margin-bottom: 0; }
.da-section { margin-bottom: 14px; }
.da-section:last-child { margin-bottom: 0; }
.da-latency { margin-top: 6px; }
.da-latency-svg { display: block; width: 100%; height: 26px; }
.da-latency-caption { margin-top: 3px; font-family: var(--da-mono); font-size: 9px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-section-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 6px; min-width: 0; width: 100%; box-sizing: border-box; }
.da-stat { min-width: 0; max-width: 100%; overflow: hidden; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-layer-2, #101a26); }
.da-stat-value { font-family: var(--da-mono); font-size: clamp(13px, 1.4vw, 17px); line-height: 1.15; color: var(--da-cyan); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.da-stat-label { margin-top: 2px; font-size: 10px; color: var(--dsw-alias-label-secondary, #8fa3b8); letter-spacing: 0.06em; overflow-wrap: anywhere; }
.da-stat.da-stat-wide { grid-column: span 2; }
.da-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; padding: 2.5px 0; border-bottom: 1px dashed rgba(255,255,255,0.055); font-family: var(--da-mono); font-size: 11px; }
.da-kv:last-child { border-bottom: none; }
.da-kv-k { flex: none; max-width: 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-kv-v { min-width: 0; max-width: 62%; text-align: right; overflow: hidden; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: normal; }
.da-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.da-list-row { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 3px 4px; border: none; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.da-list-row:hover { background: rgba(255,255,255,0.06); }
.da-list-row.da-selected { background: rgba(62,232,255,0.10); }
.da-name { flex: 1; min-width: 0; font-family: var(--da-mono); font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-chip { flex: none; max-width: 46%; overflow: hidden; text-overflow: ellipsis; padding: 0 5px; border-radius: 3px; font-family: var(--da-mono); font-size: 9px; line-height: 15px; letter-spacing: 0.03em; border: 1px solid currentColor; opacity: 0.92; white-space: nowrap; }
.da-dot-sm { width: 6px; height: 6px; border-radius: 50%; flex: none; display: inline-block; background: currentColor; box-shadow: 0 0 5px currentColor; }
.da-domain-head { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 8px; min-width: 0; }
.da-domain-head > div { min-width: 0; }
.da-domain-title { font-size: 15px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.da-domain-en { min-width: 0; overflow-wrap: anywhere; }
.da-domain-en { font-family: var(--da-mono); font-size: 10px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-desc { margin: 6px 0 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-recent { display: flex; flex-direction: column; gap: 1px; }
.da-recent-row { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 3px 4px; border: none; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-size: 10.5px; text-align: left; cursor: pointer; }
.da-recent-row:hover { background: rgba(255,255,255,0.06); }
.da-recent-time { flex: none; font-family: var(--da-mono); font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-recent-label { flex: 1; min-width: 0; font-family: var(--da-mono); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-diag-row { display: flex; gap: 8px; align-items: baseline; padding: 2px 0; font-size: 10.5px; }
.da-diag-key { flex: none; min-width: 62px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-diag-val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--da-mono); }
.da-subtle { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-empty { padding: 12px 10px; text-align: center; font-family: var(--da-mono); font-size: 11px; color: var(--dsw-alias-label-secondary, #8fa3b8); }

/* bottom console */
.da-console { flex: none; height: clamp(120px, 22vh, 168px); min-height: 120px; display: flex; flex-direction: column; margin: 8px 10px 10px; overflow: hidden; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); background: var(--dsw-alias-bg-layer-1, #0c141e); }
.da-tabs { flex: none; display: flex; align-items: stretch; gap: 2px; height: 33px; padding: 0 8px; overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); }
.da-tab { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary, #8fa3b8); font: inherit; font-size: 12px; cursor: pointer; }
.da-tab:hover { color: var(--dsw-alias-label-primary, #dff1ff); }
.da-tab.da-tab-on { color: var(--dsw-alias-label-primary, #dff1ff); border-bottom-color: var(--da-cyan); }
.da-tab-count { font-family: var(--da-mono); font-size: 9.5px; padding: 0 5px; border-radius: 999px; background: rgba(255,255,255,0.08); color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-tab-aux { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.da-tab-body { flex: 1 1 auto; min-height: 0; display: flex; overflow: hidden; padding: 8px 10px; }
@media (max-height: 700px) { .da-console { height: 134px; } }
@media (max-height: 560px) { .da-console { height: 116px; min-height: 100px; } }

/* metrics tab */
.da-metrics { display: flex; flex-wrap: wrap; gap: 10px; width: 100%; min-width: 0; min-height: 0; overflow: auto; align-content: flex-start; box-sizing: border-box; }
.da-cards { flex: 1 1 240px; min-width: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); grid-auto-rows: auto; gap: 6px; box-sizing: border-box; }
.da-card { min-width: 0; max-width: 100%; overflow: hidden; box-sizing: border-box; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-layer-2, #101a26); display: flex; flex-direction: column; justify-content: center; }
.da-card-value { font-family: var(--da-mono); font-size: clamp(12px, 1.2vw, 15px); line-height: 1.15; color: var(--da-cyan); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-card-label { font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); letter-spacing: 0.05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-spark-box { position: relative; flex: 1; min-width: 0; overflow: hidden; box-sizing: border-box; display: flex; flex-direction: column; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--da-ink-2); overflow: hidden; }
.da-spark-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 8px; font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.1em; color: rgba(126,208,255,0.65); text-transform: uppercase; }
.da-spark-canvas { position: relative; flex: 1; min-height: 0; margin: 0 6px 4px; overflow: hidden; }
.da-spark-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.da-spark-cursor { position: absolute; top: 0; bottom: 0; width: 1px; background: linear-gradient(180deg, rgba(62,232,255,0.05), rgba(62,232,255,0.75), rgba(62,232,255,0.05)); box-shadow: 0 0 8px rgba(62,232,255,0.7); animation: da-cursor 4.2s linear infinite; }
.da-rank { flex: 0.95; min-width: 0; overflow: hidden; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; }
.da-rank-row { display: flex; align-items: center; gap: 6px; font-size: 10.5px; }
.da-rank-name { flex: none; width: 34%; min-width: 0; font-family: var(--da-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-rank-bar { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.07); overflow: hidden; }
.da-rank-bar > i { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, var(--da-cyan), var(--da-blue)); }
.da-rank-val { flex: none; width: 40px; text-align: right; font-family: var(--da-mono); font-size: 10px; color: var(--dsw-alias-label-secondary, #8fa3b8); }

/* components tab */
.da-comp { display: flex; flex-direction: column; width: 100%; min-height: 0; gap: 6px; }
.da-comp-filter { flex: none; display: flex; align-items: center; gap: 8px; }
.da-comp-input { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-base, #060b12); color: var(--dsw-alias-label-secondary, #8fa3b8); font-size: 10.5px; }
.da-comp-input input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: inherit; font: inherit; }
.da-comp-groups { flex: 1; min-height: 0; overflow: auto; columns: 2; column-gap: 16px; }
.da-comp-group { break-inside: avoid; margin-bottom: 8px; }
.da-comp-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 1px 2px; border-bottom: 1px solid rgba(255,255,255,0.07); font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-comp-head b { color: var(--dsw-alias-label-primary, #dff1ff); font-weight: 500; }
.da-comp-row { display: flex; align-items: center; gap: 5px; width: 100%; padding: 1.5px 2px; border: none; border-radius: 3px; background: transparent; color: inherit; font: inherit; font-size: 10px; text-align: left; cursor: pointer; }
.da-comp-row:hover { background: rgba(255,255,255,0.06); }
.da-comp-row.da-selected { background: rgba(62,232,255,0.10); }
.da-comp-name { flex: 1; min-width: 0; font-family: var(--da-mono); font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-comp-extra { flex: none; font-family: var(--da-mono); font-size: 8.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }

/* calls tab */
.da-calls { display: flex; flex-direction: column; width: 100%; min-height: 0; }
.da-calls-filter { flex: none; display: flex; align-items: center; gap: 8px; height: 24px; }
.da-select { height: 22px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-base, #060b12); color: var(--dsw-alias-label-primary, #dff1ff); font: inherit; font-size: 10.5px; padding: 0 4px; }
.da-calls-input { flex: 1; min-width: 0; display: flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-base, #060b12); color: var(--dsw-alias-label-secondary, #8fa3b8); font-size: 10.5px; }
.da-calls-input input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary, #dff1ff); font: inherit; }
.da-calls-head { flex: none; display: flex; align-items: center; gap: 8px; height: 22px; padding: 0 4px; border-bottom: 1px solid rgba(255,255,255,0.07); font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.08em; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-calls-body { flex: 1; min-height: 0; overflow: auto; }
.da-call-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 1.5px 4px; border: none; border-radius: 3px; background: transparent; color: inherit; font: inherit; font-size: 10.5px; text-align: left; cursor: pointer; }
.da-call-row:hover { background: rgba(255,255,255,0.06); }
.da-call-row.da-selected { background: rgba(62,232,255,0.10); }
.da-c-time { flex: none; width: 62px; font-family: var(--da-mono); font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-c-kind { flex: none; width: 86px; overflow: hidden; }
.da-c-route { flex: none; width: 176px; font-family: var(--da-mono); font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-c-label { flex: 1; min-width: 0; font-family: var(--da-mono); font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-c-ms { flex: none; width: 54px; text-align: right; font-family: var(--da-mono); font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-c-status { flex: none; width: 42px; text-align: right; font-family: var(--da-mono); font-size: 9.5px; }
.da-c-status.da-ok { color: var(--dsw-alias-state-success-primary, #3ddc97); }
.da-c-status.da-fail { color: var(--dsw-alias-state-error-primary, #ff5f6d); }
.da-auto { display: flex; align-items: center; gap: 4px; font-size: 9.5px; cursor: pointer; user-select: none; }

/* view switch + legend + help + call detail */
.da-viewswitch { flex: none; display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-base, #060b12); }
.da-viewswitch-btn { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #8fa3b8); font: inherit; font-size: 11.5px; cursor: pointer; white-space: nowrap; }
.da-viewswitch-btn:hover { color: var(--dsw-alias-label-primary, #dff1ff); background: rgba(255,255,255,0.05); }
.da-viewswitch-btn.da-on { color: var(--da-cyan); background: rgba(62,232,255,0.12); box-shadow: inset 0 0 0 1px rgba(62,232,255,0.35); }
.da-legend-toggle { position: absolute; left: 14px; bottom: 52px; z-index: 4; height: 26px; padding: 0 10px; border-radius: 6px; border: 1px solid rgba(110,200,240,0.32); background: rgba(7,17,27,0.9); color: rgba(200,232,250,0.82); font-family: var(--da-mono); font-size: 10px; letter-spacing: 0.08em; cursor: pointer; }
.da-legend-toggle:hover { border-color: rgba(120,224,255,0.6); color: #eafaff; }
.da-legend { position: absolute; left: 14px; bottom: 52px; display: flex; flex-direction: column; gap: 3px; padding: 7px 10px; border-radius: 6px; border: 1px solid rgba(110,200,240,0.3); background: rgba(6,15,23,0.94); font-family: var(--da-mono); font-size: 10px; color: rgba(200,232,250,0.88); pointer-events: auto; z-index: 4; }
.da-legend-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 2px; }
.da-legend-close { border: none; background: transparent; color: rgba(180,220,242,0.7); cursor: pointer; font-size: 12px; padding: 0 2px; }
.da-legend-title { color: rgba(170,228,255,0.85); letter-spacing: 0.12em; text-transform: uppercase; font-size: 9px; }
.da-legend-row { display: flex; align-items: center; gap: 6px; }
.da-legend-swatch { width: 12px; height: 8px; border-radius: 2px; border: 1px solid rgba(62,232,255,0.5); background: rgba(62,232,255,0.10); flex: none; }
.da-legend-line { width: 14px; height: 0; border-top: 2px solid rgba(62,232,255,0.75); flex: none; }
.da-legend-dot { width: 7px; height: 7px; border-radius: 50%; background: #3ee8ff; box-shadow: 0 0 5px rgba(62,232,255,0.8); flex: none; }
.da-legend-band { width: 14px; height: 7px; border-radius: 2px; border: 1px solid rgba(62,232,255,0.4); background: rgba(16,40,58,0.9); flex: none; }
.da-neighbor-title { margin: 6px 0 3px; font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.08em; color: rgba(190,226,246,0.82); }
.da-calldetail { position: absolute; left: 14px; top: 46px; width: 236px; max-height: 150px; overflow: auto; padding: 7px 9px; border-radius: 6px; border: 1px solid rgba(62,232,255,0.2); background: rgba(6,15,23,0.92); z-index: 3; font-family: var(--da-mono); }
.da-legend-sep { height: 1px; margin: 3px 0; background: rgba(140,210,245,0.16); }
.da-calldetail-title { display: flex; justify-content: space-between; gap: 6px; margin-bottom: 4px; font-size: 9.5px; letter-spacing: 0.1em; color: rgba(160,225,255,0.8); text-transform: uppercase; }
.da-calldetail-row { display: flex; align-items: center; gap: 6px; padding: 1px 0; font-size: 10px; color: rgba(196,232,250,0.82); }
.da-calldetail-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.da-calldetail-count { flex: none; color: rgba(62,232,255,0.9); }
.da-calldetail-empty { font-size: 10px; color: rgba(150,190,215,0.55); }
.da-calltarget { flex: none; font-size: 9px; color: rgba(150,190,215,0.6); }
.da-help-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(2,6,11,0.6); }
.da-help { width: min(520px, calc(100vw - 40px)); max-height: calc(100vh - 80px); overflow: auto; padding: 18px 20px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-layer-1, #0c141e); box-shadow: 0 18px 60px rgba(0,0,0,0.5); }
.da-help-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.da-help-title { font-size: 14px; font-weight: 600; letter-spacing: 0.06em; }
.da-help-list { display: flex; flex-direction: column; gap: 9px; }
.da-help-item { display: flex; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, #8fa3b8); line-height: 1.5; }
.da-help-item b { flex: none; color: var(--da-cyan); font-weight: 600; }

/* timeline tab */
.da-timeline { display: flex; flex-direction: column; width: 100%; min-height: 0; gap: 5px; }
.da-timeline-controls { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.da-timeline-windows { display: inline-flex; gap: 2px; }
.da-timeline-window { height: 21px; padding: 0 9px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: transparent; color: var(--dsw-alias-label-secondary, #8fa3b8); font: inherit; font-size: 10px; cursor: pointer; }
.da-timeline-window.da-on { color: var(--da-cyan); border-color: rgba(62,232,255,0.5); background: rgba(62,232,255,0.1); }
.da-timeline-body { flex: 1; min-height: 0; overflow: auto; }
.da-timeline-ruler { display: flex; align-items: center; height: 18px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.da-timeline-track { position: relative; flex: 1; min-width: 0; height: 100%; }
.da-timeline-tick { position: absolute; top: 0; transform: translateX(-50%); font-family: var(--da-mono); font-size: 8.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); white-space: nowrap; }
.da-timeline-lane { display: flex; align-items: center; gap: 8px; height: 24px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.da-timeline-lane-label { flex: none; width: 132px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--da-mono); font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-timeline-bar { position: absolute; top: 7px; height: 10px; min-width: 2px; border: none; border-radius: 3px; padding: 0; cursor: pointer; opacity: 0.85; }
.da-timeline-bar.da-timeline-llm { background: linear-gradient(90deg, #ff5f6d, #ff8b93); }
.da-timeline-bar.da-timeline-tool { background: linear-gradient(90deg, #2bb8d6, #3ee8ff); }
.da-timeline-bar.da-timeline-error { background: #ff3b3b; }
.da-timeline-bar.da-hovered { opacity: 1; box-shadow: 0 0 0 1px rgba(240,250,255,0.8); }
.da-timeline-tip { flex: none; display: flex; align-items: center; gap: 8px; height: 22px; padding: 0 8px; border-radius: 5px; border: 1px solid rgba(62,232,255,0.25); background: rgba(6,15,23,0.92); font-family: var(--da-mono); font-size: 9.5px; color: rgba(205,240,255,0.9); overflow: hidden; }
.da-timeline-tip-kind { flex: none; color: var(--da-cyan); }
.da-timeline-tip-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* v7.2 light-theme surfaces: right drawer + bottom overview cards turn white.
   The architecture stage keeps its dark HUD look and is intentionally excluded. */
.da-light .da-drawer { background: #f7f9fc; border-left-color: rgba(20,44,66,0.12); color: #1b2c3b; }
.da-light .da-drawer-head { border-bottom-color: rgba(20,44,66,0.12); }
.da-light .da-drawer-title { color: #4d6478; }
.da-light .da-drawer-body { color: #1b2c3b; }
.da-light .da-drawer-cards .da-section,
.da-light .da-drawer-cards .da-domain-head { background: #ffffff; border-color: rgba(20,44,66,0.12); box-shadow: 0 1px 2px rgba(20,44,66,0.05); backdrop-filter: none; }
.da-light .da-drawer .da-kv { border-bottom-color: rgba(20,44,66,0.10); color: #223748; }
.da-light .da-drawer .da-kv-k,
.da-light .da-drawer .da-domain-en,
.da-light .da-drawer .da-subtle { color: #5b7284; }
.da-light .da-drawer .da-diag-row { color: #223748; }
.da-light .da-drawer .da-diag-key { color: #5b7284; }
.da-light .da-drawer .da-diag-val { color: #1c3345; }
.da-light .da-drawer .da-stat,
.da-light .da-drawer .da-stat-item { background: #f6f9fc; border-color: rgba(20,44,66,0.12); }
.da-light .da-drawer .da-stat-value { color: #0b6c84; }
.da-light .da-drawer .da-stat-label { color: #5b7284; }
.da-light .da-drawer .da-chip { color: #3f5a6d; border-color: rgba(20,44,66,0.22); background: rgba(20,44,66,0.04); }
.da-light .da-drawer .da-pre { background: #f4f8fb; border-color: rgba(20,44,66,0.12); color: #1c3345; }
.da-light .da-drawer .da-list-row { color: #223748; }
.da-light .da-drawer .da-list-row:hover { background: rgba(20,44,66,0.06); }
.da-light .da-drawer .da-list-row.da-selected { background: rgba(13,110,134,0.10); }
.da-light .da-drawer .da-causal-step { color: #223748; }
.da-light .da-drawer .da-causal-step:hover,
.da-light .da-drawer .da-causal-step.da-active { background: rgba(13,110,134,0.08); }
.da-light .da-drawer .da-causal-label { color: #1c3345; }
.da-light .da-drawer .da-causal-note,
.da-light .da-drawer .da-causal-time { color: #5b7284; }
.da-light .da-drawer .da-causal-dot { box-shadow: 0 0 0 1px rgba(20,44,66,0.16); }
.da-light .da-drawer .da-btn { background: #eef3f8; border-color: rgba(20,44,66,0.16); color: #1c3345; }
.da-light .da-drawer .da-btn:hover { background: #e2ebf3; border-color: rgba(20,44,66,0.28); }
.da-light .da-drawer .da-domain-bar,
.da-light .da-drawer .da-node-bar-bg { background: rgba(20,44,66,0.10); }
.da-light .da-drawer .da-dot-sm { box-shadow: none; }
.da-light .da-drawer .da-drawer-resize::after { background: rgba(20,44,66,0.22); }
.da-light .da-console { background: #ffffff; border-color: rgba(20,44,66,0.12); }
.da-light .da-console .da-tabs { border-bottom-color: rgba(20,44,66,0.12); }
.da-light .da-console .da-tab { color: #5b7284; }
.da-light .da-console .da-tab.da-tab-on { color: #14313f; }
.da-light .da-console .da-tab-count { background: rgba(20,44,66,0.08); color: #3f5a6d; }
.da-light .da-console .da-card { background: #f7fafc; border-color: rgba(20,44,66,0.12); }
.da-light .da-console .da-card-value { color: #0b6c84; }
.da-light .da-console .da-card-label { color: #5b7284; }
.da-light .da-console .da-spark-box { background: #f7fafc; border-color: rgba(20,44,66,0.12); }
.da-light .da-console .da-spark-head { color: #5b7284; }
.da-light .da-console .da-rank-row { color: #3f5a6d; }
.da-light .da-console .da-rank-bar { background: rgba(20,44,66,0.10); }
.da-light .da-console .da-recent-row:hover { background: rgba(20,44,66,0.06); }
.da-light .da-console .da-list-row:hover { background: rgba(20,44,66,0.06); }
.da-light .da-console .da-calls { color: #223748; }

/* v8 HUD status pill (right-top, never covers layer labels/nodes) */
.da-hud-tr { align-items: flex-end; text-align: right; }
.da-hud-line { font-family: var(--da-mono); font-size: 9.5px; color: rgba(196,232,250,0.82); }
.da-hud-hint { margin-top: 2px; font-family: var(--da-mono); font-size: 9px; color: rgba(160,205,230,0.72); max-width: 240px; }
.da-hud-timing { margin-top: 3px; font-family: var(--da-mono); font-size: 10.5px; font-weight: 600; letter-spacing: 0.02em; color: rgba(225,248,255,0.95); text-shadow: 0 0 6px rgba(62,232,255,0.25); white-space: nowrap; }
.da-status-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(120,200,240,0.28); background: rgba(6,15,23,0.7); font-family: var(--da-mono); font-size: 9.5px; letter-spacing: 0.04em; }
.da-status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: rgba(140,160,175,0.8); }
.da-status-live { color: #9ff0c4; border-color: rgba(61,220,151,0.45); }
.da-status-live .da-status-dot { background: #3ddc97; box-shadow: 0 0 5px rgba(61,220,151,0.6); }
.da-status-running { color: #9ff0c4; border-color: rgba(61,220,151,0.45); }
.da-status-running .da-status-dot { background: #3ddc97; box-shadow: 0 0 5px rgba(61,220,151,0.6); }
.da-status-idleConnected { color: rgba(180,225,210,0.9); border-color: rgba(61,220,151,0.3); }
.da-status-idleConnected .da-status-dot { background: #3ddc97; opacity: 0.75; }
.da-status-paused { color: rgba(200,210,225,0.85); }
.da-status-offline { color: rgba(255,120,125,0.9); border-color: rgba(255,95,109,0.4); }
.da-status-offline .da-status-dot { background: #ff5f6d; }
.da-status-reconnecting { color: rgba(255,192,77,0.9); border-color: rgba(255,192,77,0.4); }
.da-status-reconnecting .da-status-dot { background: #ffc04d; }
.da-status-idle { color: rgba(180,205,222,0.85); }
.da-status-waiting { color: rgba(255,192,77,0.85); border-color: rgba(255,192,77,0.35); }
/* v8 theme-token surfaces: drawer + console follow host tokens (light => white surfaces,
   dark => dark surfaces). Stage/HUD keep their dark --da-* palette above. */
.da-drawer { background: var(--dsw-alias-bg-layer-1, #0c141e); border-left-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer-head { border-bottom-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)); }
.da-drawer-title { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-drawer-body { color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer-cards .da-section, .da-drawer-cards .da-domain-head { background: var(--dsw-alias-bg-layer-2, #101a26); border-color: var(--dsw-alias-border-l1, #22303e); box-shadow: none; backdrop-filter: none; }
.da-drawer .da-kv { border-bottom-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.06)); color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer .da-kv-k, .da-drawer .da-domain-en, .da-drawer .da-subtle, .da-drawer .da-diag-key { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-drawer .da-diag-val { color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer .da-stat, .da-drawer .da-stat-item { background: var(--dsw-alias-bg-layer-1, #0c141e); border-color: var(--dsw-alias-border-l1, #22303e); }
.da-drawer .da-stat-value { color: var(--dsw-alias-brand-primary, #3ee8ff); }
.da-drawer .da-stat-label { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-drawer .da-chip { color: var(--dsw-alias-label-secondary, #8fa3b8); border-color: var(--dsw-alias-border-l2, rgba(255,255,255,0.18)); background: transparent; }
.da-drawer .da-pre { background: var(--dsw-alias-bg-base, #060b12); border-color: var(--dsw-alias-border-l1, #22303e); color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer .da-list-row { color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer .da-list-row:hover { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06)); }
.da-drawer .da-list-row.da-selected { background: var(--dsw-alias-bg-layer-2, rgba(62,232,255,0.12)); }
.da-drawer .da-causal-step { color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer .da-causal-step:hover, .da-drawer .da-causal-step.da-active { background: var(--dsw-alias-bg-layer-2, rgba(62,232,255,0.10)); }
.da-drawer .da-causal-label { color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer .da-causal-note, .da-drawer .da-causal-time { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-drawer .da-btn { background: var(--dsw-alias-bg-layer-2, #101a26); border-color: var(--dsw-alias-border-l1, #22303e); color: var(--dsw-alias-label-primary, #dff1ff); }
.da-drawer .da-btn:hover { border-color: var(--dsw-alias-brand-primary, #3ee8ff); }
.da-drawer .da-domain-bar, .da-drawer .da-node-bar-bg { background: var(--dsw-alias-border-l2, rgba(255,255,255,0.08)); }
.da-drawer .da-dot-sm { box-shadow: none; }
.da-drawer .da-drawer-resize::after { background: var(--dsw-alias-border-l2, rgba(255,255,255,0.2)); }
.da-console { background: var(--dsw-alias-bg-layer-1, #0c141e); border-color: var(--dsw-alias-border-l1, #22303e); }
.da-console .da-tabs { border-bottom-color: var(--dsw-alias-border-l1, #22303e); }
.da-console .da-tab { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-console .da-tab.da-tab-on { color: var(--dsw-alias-label-primary, #dff1ff); border-bottom-color: var(--dsw-alias-brand-primary, #3ee8ff); }
.da-console .da-tab-count { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.08)); color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-console .da-card { background: var(--dsw-alias-bg-layer-2, #101a26); border-color: var(--dsw-alias-border-l1, #22303e); }
.da-console .da-card-value { color: var(--dsw-alias-brand-primary, #3ee8ff); }
.da-console .da-card-label { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-console .da-spark-box { background: var(--dsw-alias-bg-layer-1, #0c141e); border-color: var(--dsw-alias-border-l1, #22303e); }
.da-console .da-rank-row { color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-console .da-rank-bar { background: var(--dsw-alias-border-l2, rgba(255,255,255,0.08)); }
.da-console .da-recent-row:hover, .da-console .da-list-row:hover { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06)); }
.da-console .da-calls { color: var(--dsw-alias-label-primary, #dff1ff); }
.da-tool-summary { font-size: 10.5px; color: var(--dsw-alias-label-primary, #dff1ff); overflow-wrap: anywhere; }
.da-tool-source { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.da-raw-desc summary { cursor: pointer; font-family: var(--da-mono); font-size: 9.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-raw-desc[open] summary { margin-bottom: 6px; }

.da-raw-desc .da-when-open { display: none; }
.da-raw-desc[open] .da-when-closed { display: none; }
.da-raw-desc[open] .da-when-open { display: inline; }
.da-raw-desc .da-desc-full { display: block; margin: 0; max-height: none; height: auto; overflow: visible; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; text-overflow: clip; -webkit-line-clamp: unset; -webkit-box-orient: initial; }

.da-session-select { height: 26px; max-width: 220px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-layer-2, #101a26); color: var(--dsw-alias-label-primary, #dff1ff); font-family: var(--da-mono); font-size: 10px; }
.da-session-badge { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 4px 0 8px; border-radius: 999px; border: 1px solid rgba(62,232,255,0.35); color: rgba(190,240,255,0.9); font-family: var(--da-mono); font-size: 9.5px; white-space: nowrap; }
.da-session-badge-clear { border: none; background: transparent; color: rgba(200,235,255,0.7); cursor: pointer; font-size: 12px; padding: 0 3px; }
.da-session-badge-clear:hover { color: #eafaff; }

/* right-sidebar anatomy tab (compact) */
.da-rp-root { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; padding: 10px; box-sizing: border-box; overflow: auto; color: var(--dsw-alias-label-primary, #dff1ff); background: var(--dsw-alias-bg-base, #0a111a); font-family: var(--da-font); }
.da-rp-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: none; }
.da-rp-title { font-size: 12px; font-weight: 700; letter-spacing: 0.03em; }
.da-rp-session { height: 24px; max-width: 150px; padding: 0 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: var(--dsw-alias-bg-layer-2, #101a26); color: var(--dsw-alias-label-primary, #dff1ff); font-family: var(--da-mono); font-size: 9.5px; }
.da-rp-pill { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(120,190,230,0.25); font-family: var(--da-mono); font-size: 9px; }
.da-rp-pill .da-status-dot { width: 5px; height: 5px; border-radius: 50%; }
.da-rp-pill.da-status-running { color: #9ff0c4; border-color: rgba(61,220,151,0.45); }
.da-rp-pill.da-status-running .da-status-dot { background: #3ddc97; }
.da-rp-pill.da-status-idleConnected { color: rgba(180,225,210,0.9); }
.da-rp-pill.da-status-idleConnected .da-status-dot { background: #3ddc97; opacity: 0.75; }
.da-rp-pill.da-status-paused { color: rgba(200,210,225,0.85); }
.da-rp-pill.da-status-waiting { color: rgba(160,180,200,0.8); }
.da-rp-pill.da-status-offline { color: #ff8a90; }
.da-rp-pill.da-status-reconnecting { color: #ffc04d; }
.da-rp-spacer { flex: 1 1 auto; }
.da-rp-btn { height: 22px; padding: 0 7px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1, #22303e); background: rgba(20,38,54,0.6); color: var(--dsw-alias-label-primary, #dff1ff); font-family: var(--da-mono); font-size: 9.5px; cursor: pointer; }
.da-rp-btn:hover { border-color: rgba(62,232,255,0.45); }
.da-rp-wait { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 160px; border: 1px dashed rgba(120,190,230,0.22); border-radius: 8px; color: var(--dsw-alias-label-secondary, #8fa3b8); font-size: 11px; }
.da-rp-stage { position: relative; flex: none; width: 100%; border: 1px solid rgba(120,190,230,0.16); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-2, #101a26); }
.da-rp-stage svg { display: block; width: 100%; height: auto; }
.da-rp-tip { position: absolute; right: 6px; bottom: 4px; font-family: var(--da-mono); font-size: 8.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); opacity: 0.8; pointer-events: none; }
.da-rp-detail { flex: none; border: 1px solid rgba(120,190,230,0.18); border-radius: 7px; padding: 6px 8px; background: var(--dsw-alias-bg-layer-2, #101a26); font-size: 10px; }
.da-rp-detail-head { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; }
.da-rp-detail-desc { margin-top: 3px; color: var(--dsw-alias-label-secondary, #8fa3b8); font-size: 9.5px; line-height: 1.5; }
.da-rp-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; flex: none; }
.da-rp-metric { border: 1px solid rgba(120,190,230,0.14); border-radius: 6px; padding: 5px 6px; background: rgba(14,26,38,0.6); min-width: 0; }
.da-rp-metric-label { font-family: var(--da-mono); font-size: 8px; color: var(--dsw-alias-label-secondary, #8fa3b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-rp-metric-value { font-family: var(--da-mono); font-size: 13px; font-weight: 600; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.da-rp-recent { flex: none; display: flex; flex-direction: column; gap: 3px; }
.da-rp-recent-title { font-size: 9px; font-family: var(--da-mono); color: var(--dsw-alias-label-secondary, #8fa3b8); }
.da-rp-recent-row { display: flex; align-items: center; gap: 6px; font-size: 9.5px; padding: 2px 0; border-bottom: 1px solid rgba(120,190,230,0.08); min-width: 0; }
.da-rp-recent-kind { flex: none; font-family: var(--da-mono); font-size: 8.5px; opacity: 0.8; }
.da-rp-recent-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.da-rp-recent-time { flex: none; font-family: var(--da-mono); font-size: 8.5px; opacity: 0.7; }
.da-open-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary, #8fa3b8); cursor: pointer; }
.da-open-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(120,190,230,0.14)); color: var(--dsw-alias-label-primary, #dff1ff); }
.da-tab-title { display: inline-flex; align-items: center; gap: 5px; }

/* error boundary */
.da-error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; background: var(--dsw-alias-bg-base, #060b12); }
.da-error-icon { font-size: 26px; color: var(--dsw-alias-state-error-primary, #ff5f6d); }
.da-error-title { font-size: 15px; font-weight: 600; }
.da-error-msg { max-width: 560px; font-family: var(--da-mono); font-size: 11px; color: var(--dsw-alias-label-secondary, #8fa3b8); white-space: pre-wrap; word-break: break-word; }
.da-error-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #8fa3b8); }

/* animations */
@keyframes da-dash { to { stroke-dashoffset: -240; } }
@keyframes da-cursor { 0% { left: 0%; } 100% { left: 100%; } }
@keyframes da-spin { to { transform: rotate(360deg); } }
.da-paused .da-edge, .da-paused .da-edge-flow,
.da-paused .da-spark-cursor { animation-play-state: paused !important; }
.da-narrow .da-sub { display: none; }
.da-narrow .da-title { font-size: 12.5px; letter-spacing: 0.04em; }
.da-narrow .da-livetag { display: none; }
.da-narrow .da-header { gap: 8px; padding: 0 10px; }
.da-narrow .da-viewswitch-btn { padding: 0 7px; font-size: 10.5px; }

/* v7.3 theme-token surfaces: the right drawer and the bottom console follow the
   host theme through its own tokens (light theme = white surfaces, dark theme =
   dark surfaces). This deliberately does NOT depend on the JS isDark/da-light
   detection, which can fail when the host exposes no theme flag. The
   architecture stage keeps its own dark HUD. */
.da-root .da-drawer { background: var(--dsw-alias-bg-layer-1, #0c141e) !important; color: var(--dsw-alias-label-primary, #e6f6ff) !important; border-left-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)) !important; }
.da-root .da-drawer-head { background: var(--dsw-alias-bg-layer-1, #0c141e) !important; border-bottom-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)) !important; }
.da-root .da-drawer-title { color: var(--dsw-alias-label-secondary, #8fa3b8) !important; }
.da-root .da-drawer-body { color: var(--dsw-alias-label-primary, #dff1ff) !important; }
.da-root .da-drawer-cards .da-section,
.da-root .da-drawer-cards .da-domain-head { background: var(--dsw-alias-bg-layer-2, #101a26) !important; border-color: var(--dsw-alias-border-l1, #22303e) !important; box-shadow: none !important; backdrop-filter: none !important; }
.da-root .da-drawer-cards .da-section .da-section { background: none !important; border: none !important; box-shadow: none !important; }
.da-root .da-drawer .da-kv { color: var(--dsw-alias-label-primary, #dff1ff) !important; border-bottom-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)) !important; }
.da-root .da-drawer .da-kv-k,
.da-root .da-drawer .da-diag-key,
.da-root .da-drawer .da-section-title,
.da-root .da-drawer .da-subtle,
.da-root .da-drawer .da-empty,
.da-root .da-drawer .da-causal-note,
.da-root .da-drawer .da-causal-time,
.da-root .da-drawer .da-domain-en,
.da-root .da-drawer .da-sub { color: var(--dsw-alias-label-secondary, #8fa3b8) !important; }
.da-root .da-drawer .da-kv-v,
.da-root .da-drawer .da-diag-val,
.da-root .da-drawer .da-causal-label,
.da-root .da-drawer .da-list-row,
.da-root .da-drawer .da-recent-label,
.da-root .da-drawer .da-domain-name { color: var(--dsw-alias-label-primary, #dff1ff) !important; }
.da-root .da-drawer .da-stat { background: var(--dsw-alias-bg-base, #0a141d) !important; border-color: var(--dsw-alias-border-l1, #22303e) !important; }
.da-root .da-drawer .da-stat-label { color: var(--dsw-alias-label-secondary, #8fa3b8) !important; }
.da-root .da-drawer .da-chip { color: var(--dsw-alias-label-secondary, #8fa3b8) !important; border-color: var(--dsw-alias-border-l1, #22303e) !important; background: var(--dsw-alias-bg-base, rgba(255,255,255,0.04)) !important; }
.da-root .da-drawer .da-pre { background: var(--dsw-alias-bg-base, #060e16) !important; border-color: var(--dsw-alias-border-l1, #22303e) !important; color: var(--dsw-alias-label-primary, #dff1ff) !important; }
.da-root .da-drawer .da-btn { background: var(--dsw-alias-bg-layer-2, #101a26) !important; border-color: var(--dsw-alias-border-l1, #22303e) !important; color: var(--dsw-alias-label-primary, #dff1ff) !important; }
.da-root .da-drawer .da-btn:hover { background: var(--dsw-alias-bg-overlay, #16222f) !important; }
.da-root .da-drawer .da-list-row:hover,
.da-root .da-drawer .da-recent-row:hover,
.da-root .da-drawer .da-causal-step:hover { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.06)) !important; }
.da-root .da-console { background: var(--dsw-alias-bg-layer-1, #0c141e) !important; border-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)) !important; }
.da-root .da-console .da-tabs { border-bottom-color: var(--dsw-alias-border-l1, rgba(255,255,255,0.08)) !important; }
.da-root .da-console .da-tab { color: var(--dsw-alias-label-secondary, #8fa3b8) !important; }
.da-root .da-console .da-tab.da-tab-on,
.da-root .da-console .da-tab:hover { color: var(--dsw-alias-label-primary, #dff1ff) !important; }
.da-root .da-console .da-card,
.da-root .da-console .da-spark-box { background: var(--dsw-alias-bg-layer-2, #101a26) !important; border-color: var(--dsw-alias-border-l1, #22303e) !important; }
.da-root .da-console .da-card-value { color: var(--dsw-alias-brand-primary, #3ee8ff) !important; }
.da-root .da-console .da-card-label,
.da-root .da-console .da-rank-val,
.da-root .da-console .da-spark-head { color: var(--dsw-alias-label-secondary, #8fa3b8) !important; }
.da-root .da-console .da-tab-count { background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.08)) !important; color: var(--dsw-alias-label-secondary, #8fa3b8) !important; }
`

    // ---------------------------------------------------------------------
    // Data connection: NDJSON stream first, polling fallback, exponential
    // reconnect, buffered-carrier watchdog and live connection diagnostics.
    // The controller owns no React state — it only forwards frames through
    // callbacks that are all guarded against disposal.
    // ---------------------------------------------------------------------

    function noop() {}

    function callSafely(fn, arg) {
      if (typeof fn !== 'function') return
      try {
        fn(arg)
      } catch (error) {
        // A malformed frame must never tear the connection down.
      }
    }

    /** Short, renderable text for one transport failure. */
    function describeTransportError(error) {
      if (error === undefined || error === null) return 'unknown'
      if (typeof error === 'string') return error.slice(0, 160)
      let message = ''
      try {
        const name = error.name && String(error.name) !== '' ? String(error.name) : ''
        const detail = error.message ? String(error.message) : String(error)
        message = name && detail.indexOf(name) < 0 ? name + ': ' + detail : detail
      } catch (innerError) {
        message = 'unreadable error'
      }
      return message.slice(0, 160)
    }

    function createController(options) {
      const opts = options && typeof options === 'object' ? options : {}
      let disposed = false
      let started = false
      let seq = 0
      let attempt = 0
      let pollFails = 0
      let gotFrame = false
      let streamLive = false
      let connState = ''
      let abortRef = null
      let readerRef = null
      let reconnectTimer = 0
      let pollTimer = 0
      let snapshotInflight = false
      let generation = 0
      // Liveness bookkeeping for carriers that resolve the stream fetch but
      // never deliver body frames (buffered Electron protocol handlers do).
      let lastFrameAt = 0
      let startAt = 0
      let watchdogTimer = 0
      // Live connection diagnostics surfaced in the HUD (useful when the page
      // cannot reach the Host at all: the card shows the resolved base URL).
      let diagInfo = { base: '', transport: '', state: '', frames: 0, polls: 0, lastError: '' }
      function reportDiag(patch) {
        try {
          diagInfo = Object.assign({}, diagInfo, patch || {})
          callSafely(opts.onDiag, diagInfo)
        } catch (error) {
          // diagnostics must never break the connection
        }
      }

      function emitConn(next) {
        if (disposed || !next || connState === next) return
        connState = next
        callSafely(opts.onConn, next)
        reportDiag({ state: next })
      }

      function dispatch(frame, origin) {
        if (disposed || !frame || typeof frame !== 'object') return
        try {
          // Only frames that prove the live channel works may stop polling.
          // A resolved stream fetch alone does NOT prove that: an intermediary
          // can buffer the body forever, so polling runs until a real frame
          // arrives here (see the watchdog in start()).
          const fromStream = origin === 'stream'
          const fromPoll = origin === 'poll'
          if (fromStream || fromPoll) {
            gotFrame = true
            lastFrameAt = Date.now()
            if (fromStream && pollTimer) stopPolling()
            diagInfo.frames += 1
            if (diagInfo.frames === 1 || diagInfo.frames % 20 === 0) reportDiag({ frames: diagInfo.frames, lastError: '' })
          }
          if (typeof frame.seq === 'number' && Number.isFinite(frame.seq) && frame.seq > 0) seq = frame.seq
          const type = frame.type
          if (type === 'hello') {
            gotFrame = true
            emitConn('live')
            return
          }
          if (type === 'snapshot') {
            gotFrame = true
            emitConn('live')
            if (frame.snapshot && typeof frame.snapshot === 'object') {
              callSafely(opts.onSnapshot, frame.snapshot)
              // A host-side size-trimmed stream snapshot (large real profiles)
              // must never be the final state: immediately re-read the complete
              // HTTP snapshot so architecture lists stay populated.
              if (frame.snapshot.truncated === true) fetchSnapshot()
            }
            return
          }
          if (type === 'events') {
            gotFrame = true
            emitConn('live')
            callSafely(opts.onEvents, {
              events: Array.isArray(frame.events) ? frame.events : [],
              metrics: frame.metrics,
              orgMetrics: frame.orgMetrics,
              toolMetrics: frame.toolMetrics,
              seq: seq,
            })
            return
          }
          if (type === 'metrics') {
            // Dedicated ~2s metrics frame (CONTRACT §8.5). Funnel it through
            // the SAME reducer as events-frame metrics with an empty event
            // list, so idle vitals/domain metrics/throughput keep refreshing
            // without a second code path.
            gotFrame = true
            emitConn('live')
            callSafely(opts.onEvents, {
              events: [],
              metrics: frame.metrics,
              orgMetrics: frame.orgMetrics,
              toolMetrics: frame.toolMetrics,
              seq: seq,
            })
            return
          }
          if (type === 'ping') emitConn('live')
          // Unknown frame types are ignored on purpose (forward compatibility).
        } catch (error) {
          // keep the stream alive on any frame-level surprise
        }
      }

      function processLine(line) {
        const text = String(line === undefined || line === null ? '' : line).trim()
        if (!text) return
        let frame
        try {
          frame = JSON.parse(text)
        } catch (error) {
          return
        }
        dispatch(frame, 'stream')
      }

      function decodeChunk(decoder, value) {
        if (!value) return ''
        if (decoder) {
          try {
            return decoder.decode(value, { stream: true })
          } catch (error) {
            // fall through to the byte loop
          }
        }
        let text = ''
        for (let i = 0; i < value.length; i += 1) text += String.fromCharCode(value[i])
        return text
      }

      async function pumpStream(response, gen) {
        let reader
        try {
          reader = response.body.getReader()
        } catch (error) {
          streamDown(gen)
          return
        }
        readerRef = reader
        const decoder = safe(() => (typeof TextDecoder !== 'undefined' ? new TextDecoder() : null), null)
        let buffer = ''
        try {
          for (;;) {
            const step = await reader.read()
            if (disposed || gen !== generation) return
            if (step.done) {
              streamDown(gen)
              return
            }
            buffer += decodeChunk(decoder, step.value)
            let index = buffer.indexOf('\n')
            while (index >= 0) {
              const line = buffer.slice(0, index)
              buffer = buffer.slice(index + 1)
              processLine(line)
              if (disposed || gen !== generation) return
              index = buffer.indexOf('\n')
            }
            if (buffer.length > 1048576) buffer = ''
          }
        } catch (error) {
          if (!disposed && gen === generation) streamDown(gen)
        }
      }

      function connectStream(first) {
        if (disposed) return
        if (typeof fetch !== 'function') {
          emitConn('offline')
          return
        }
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = 0
        }
        if (first && !gotFrame && !pollTimer) emitConn('connecting')
        let controller
        try {
          controller = new AbortController()
        } catch (error) {
          startPolling()
          return
        }
        abortRef = controller
        const gen = ++generation
        let requestUrl
        try {
          requestUrl = apiUrl('dsh-anatomy/api/stream')
        } catch (error) {
          emitConn('offline')
          return
        }
        fetch(requestUrl, {
          signal: controller.signal,
          cache: 'no-store',
          headers: { accept: 'application/x-ndjson' },
        }).then(function (response) {
          if (disposed || gen !== generation) return
          if (!response || response.ok === false || !response.body || typeof response.body.getReader !== 'function') {
            throw new Error('stream unavailable' + (response && response.status ? ' (HTTP ' + response.status + ')' : ''))
          }
          attempt = 0
          pollFails = 0
          streamLive = true
          emitConn('live')
          // Deliberately do NOT stop polling here: a buffered carrier resolves
          // this fetch without ever delivering a frame. The first real stream
          // frame stops polling in dispatch(); the watchdog in start() starts
          // polling when none arrives.
          return pumpStream(response, gen)
        }).catch(function (error) {
          if (disposed || gen !== generation) return
          reportDiag({ lastError: 'stream: ' + describeTransportError(error) })
          streamDown(gen)
        })
      }

      function streamDown(gen) {
        if (disposed || gen !== generation) return
        generation += 1
        streamLive = false
        if (readerRef) {
          try {
            const cancel = readerRef.cancel()
            if (cancel && typeof cancel.catch === 'function') cancel.catch(noop)
          } catch (error) {
            // ignore
          }
          readerRef = null
        }
        if (abortRef) {
          try {
            abortRef.abort()
          } catch (error) {
            // ignore
          }
          abortRef = null
        }
        if (!pollTimer) emitConn('reconnecting')
        // Keep data flowing while the stream is retried.
        startPolling()
        scheduleReconnect()
      }

      function scheduleReconnect() {
        if (disposed || reconnectTimer) return
        const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
        attempt += 1
        reconnectTimer = setTimeout(function () {
          reconnectTimer = 0
          if (!disposed) connectStream(false)
        }, delay)
      }

      function startPolling() {
        if (disposed || pollTimer) return
        pollOnce()
        pollTimer = setInterval(pollOnce, POLL_MS)
      }

      function stopPolling() {
        if (!pollTimer) return
        clearInterval(pollTimer)
        pollTimer = 0
      }

      function pollOnce() {
        if (disposed || typeof fetch !== 'function') return
        let requestUrl
        try {
          requestUrl = apiUrl('dsh-anatomy/api/events?after=' + encodeURIComponent(String(seq)) + '&limit=200')
        } catch (error) {
          return
        }
        fetch(requestUrl, { cache: 'no-store' }).then(function (response) {
          if (!response || response.ok === false) throw new Error('poll HTTP ' + (response && response.status))
          return response.json()
        }).then(function (payload) {
          if (disposed || !payload || typeof payload !== 'object') return
          pollFails = 0
          if (!streamLive) emitConn('live')
          if (payload.reset) {
            seq = 0
            // Ring buffer gap: our view of the sequence is stale.
            callSafely(opts.onReset)
            fetchSnapshot()
          }
          const events = Array.isArray(payload.events) ? payload.events : []
          if (events.length > 0 || payload.metrics || payload.orgMetrics || payload.toolMetrics) {
            dispatch({
              type: 'events',
              seq: typeof payload.seq === 'number' ? payload.seq : seq,
              events: events,
              metrics: payload.metrics,
              orgMetrics: payload.orgMetrics,
              toolMetrics: payload.toolMetrics,
            }, 'poll')
          }
          if (payload.snapshotChanged) fetchSnapshot()
        }).catch(function (error) {
          if (disposed) return
          pollFails += 1
          diagInfo.polls += 1
          reportDiag({ polls: diagInfo.polls, lastError: 'poll: ' + describeTransportError(error) })
          if (!streamLive) emitConn(pollFails >= 3 ? 'offline' : 'reconnecting')
        })
      }

      function fetchSnapshot() {
        if (disposed || snapshotInflight || typeof fetch !== 'function') return
        snapshotInflight = true
        let requestUrl
        try {
          requestUrl = apiUrl('dsh-anatomy/api/snapshot')
        } catch (error) {
          snapshotInflight = false
          return
        }
        fetch(requestUrl, { cache: 'no-store' }).then(function (response) {
          if (!response || response.ok === false) throw new Error('snapshot HTTP ' + (response && response.status))
          return response.json()
        }).then(function (snapshot) {
          snapshotInflight = false
          if (disposed || !snapshot || typeof snapshot !== 'object') return
          if (typeof snapshot.schemaVersion !== 'number') return
          dispatch({ type: 'snapshot', seq: typeof snapshot.seq === 'number' ? snapshot.seq : seq, snapshot: snapshot }, 'http')
        }).catch(function (error) {
          snapshotInflight = false
          reportDiag({ lastError: 'snapshot: ' + describeTransportError(error) })
        })
      }

      return {
        start: function start() {
          if (disposed || started) return
          started = true
          if (typeof fetch !== 'function') {
            emitConn('offline')
            return
          }
          startAt = Date.now()
          reportDiag({
            base: safe(apiBase, ''),
            transport: transportBase() ? 'host-origin (__DSH_TRANSPORT__.streamBaseUrl)' : 'page-relative',
            state: 'connecting',
          })
          connectStream(true)
          fetchSnapshot()
          // Watchdog for two failure modes a fetch cannot report by itself:
          //  (a) the stream fetch resolved but no frame ever arrived (buffered
          //      carrier) -> start the polling fallback and keep it running;
          //  (b) the stream was live but then silently stalled -> abort it so
          //      streamDown() reconnects, while polling keeps data flowing.
          watchdogTimer = setInterval(function () {
            if (disposed) return
            const now = Date.now()
            if (!pollTimer && !gotFrame && now - startAt > 2500) startPolling()
            const reference = gotFrame ? lastFrameAt : startAt
            if (streamLive && now - reference > 25000) {
              try {
                if (abortRef) abortRef.abort()
              } catch (error) {
                // ignore
              }
            }
          }, 4000)
        },
        dispose: function dispose() {
          if (disposed) return
          disposed = true
          generation += 1
          if (watchdogTimer) {
            clearInterval(watchdogTimer)
            watchdogTimer = 0
          }
          if (reconnectTimer) {
            clearTimeout(reconnectTimer)
            reconnectTimer = 0
          }
          stopPolling()
          if (readerRef) {
            try {
              const cancel = readerRef.cancel()
              if (cancel && typeof cancel.catch === 'function') cancel.catch(noop)
            } catch (error) {
              // ignore
            }
            readerRef = null
          }
          if (abortRef) {
            try {
              abortRef.abort()
            } catch (error) {
              // ignore
            }
            abortRef = null
          }
        },
      }
    }

    // ---------------------------------------------------------------------
    // Canvas flow-particle engine. One rAF loop reads mutable refs: React never
    // re-renders per frame. Particles live in diagram coordinates (VIEW_W ×
    // VIEW_H) and are projected through the same letterbox mapping the SVG uses,
    // so the canvas can simply overlay the stage at any size.
    // ---------------------------------------------------------------------

    const rafSchedule = typeof requestAnimationFrame === 'function'
      ? function (callback) { return requestAnimationFrame(callback) }
      : function (callback) { return setTimeout(function () { callback(Date.now()) }, 33) }
    const rafCancel = typeof cancelAnimationFrame === 'function'
      ? function (handle) { cancelAnimationFrame(handle) }
      : function (handle) { clearTimeout(handle) }

    function __removedParticleEngine(canvas, options) {
      const opts = options && typeof options === 'object' ? options : {}
      const readColors = typeof opts.readColors === 'function' ? opts.readColors : function () { return THEME_FALLBACK }
      const viewBox = opts.viewBox && typeof opts.viewBox === 'object' ? opts.viewBox : { w: 1000, h: 1000 }
      const vbW = num(viewBox.w) > 0 ? num(viewBox.w) : 1000
      const vbH = num(viewBox.h) > 0 ? num(viewBox.h) : 1000
      let graphic = null
      let rafHandle = 0
      let disposed = false
      let paused = false
      let lastFrame = 0
      let ambience = 0
      let particles = []
      let pulses = []
      let flashes = Object.create(null)
      let organs = NODE_FALLBACK.slice()
      let organMap = buildNodeMap(organs)
      let colors = safe(readColors, THEME_FALLBACK) || THEME_FALLBACK
      let resizeObserver = null
      let windowResizeAttached = false
      let visibilityAttached = false
      const view = { w: 0, h: 0, scale: 1, ox: 0, oy: 0, dpr: 1 }

      function getGraphic() {
        if (graphic) return graphic
        graphic = null
        return graphic
      }

      function measure() {
        let width = 0
        let height = 0
        try {
          const rect = canvas.getBoundingClientRect()
          width = rect && rect.width ? rect.width : 0
          height = rect && rect.height ? rect.height : 0
        } catch (error) {
          width = 0
          height = 0
        }
        if ((!width || !height) && canvas.parentElement) {
          const parentRect = safe(function () { return canvas.parentElement.getBoundingClientRect() }, null)
          if (parentRect) {
            if (!width) width = parentRect.width || 0
            if (!height) height = parentRect.height || 0
          }
        }
        return { width: width, height: height }
      }

      function projectX(x) {
        return view.ox + num(x) * view.scale
      }

      function projectY(y) {
        return view.oy + num(y) * view.scale
      }

      function applySize() {
        if (disposed) return
        const box = measure()
        if (!box.width || !box.height) return
        const dpr = clamp(safe(function () {
          return typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
        }, 1), 1, 2)
        view.w = box.width
        view.h = box.height
        view.dpr = dpr
        view.scale = Math.min(box.width / vbW, box.height / vbH)
        view.ox = (box.width - vbW * view.scale) / 2
        view.oy = (box.height - vbH * view.scale) / 2
        const pixelWidth = Math.max(1, Math.round(box.width * dpr))
        const pixelHeight = Math.max(1, Math.round(box.height * dpr))
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight
        if (canvas.style) {
          canvas.style.width = '100%'
          canvas.style.height = '100%'
        }
      }

      function attachResize() {
        applySize()
        if (typeof ResizeObserver === 'function') {
          try {
            resizeObserver = new ResizeObserver(function () { applySize() })
            resizeObserver.observe(canvas.parentElement || canvas)
            return
          } catch (error) {
            resizeObserver = null
          }
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('resize', applySize)
          windowResizeAttached = true
        }
      }

      function detachResize() {
        if (resizeObserver) {
          try {
            resizeObserver.disconnect()
          } catch (error) {
            // ignore
          }
          resizeObserver = null
        }
        if (windowResizeAttached && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('resize', applySize)
          windowResizeAttached = false
        }
      }

      function pushParticle(particle) {
        particles.push(particle)
        if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES)
      }

      function spawnOne(event) {
        if (!event || typeof event !== 'object') return
        const source = organMap[event.organ]
        if (!source) return
        const color = kindColor(event.kind)
        const sizeValue = clamp(num(source.size) || 90, 40, 170)
        const target = event.target && event.target !== event.organ ? organMap[event.target] : null
        if (target) {
          const ax = num(source.x) || 500
          const ay = num(source.y) || 500
          const bx = num(target.x) || 500
          const by = num(target.y) || 500
          const seed = hashText(String(event.id === undefined ? event.label || '' : event.id) + ':' + String(event.kind || ''))
          const control = curveControl(ax, ay, bx, by, seed)
          const distance = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) || 1
          pushParticle({
            mode: 'path', ax: ax, ay: ay, bx: bx, by: by, cx: control.x, cy: control.y,
            t: 0, speed: 1 / clamp(distance / 2.1, 26, 110), color: color,
            radius: 1.0 + Math.random() * 1.2, alpha: 0.95,
          })
        } else {
          pushParticle({
            mode: 'orbit', cx: num(source.x) || 500, cy: num(source.y) || 500,
            radius: sizeValue * 0.62 + 5, angle: Math.random() * Math.PI * 2,
            spin: 0.018 + Math.random() * 0.02, life: 0, maxLife: clamp(70 + Math.random() * 50, 60, 140),
            color: color, radius: 1.0 + Math.random() * 1.0, alpha: 0.9,
          })
        }
      }

      function spawn(events) {
        if (disposed || paused) return
        const list = Array.isArray(events) ? events : []
        if (list.length === 0) return
        // Cap particles per frame: sample evenly across a burst so the flow
        // stays representative instead of dropping the tail.
        if (list.length <= MAX_SPAWN_PER_BATCH) {
          for (let i = 0; i < list.length; i += 1) spawnOne(list[i])
        } else {
          const step = list.length / MAX_SPAWN_PER_BATCH
          for (let i = 0; i < MAX_SPAWN_PER_BATCH; i += 1) spawnOne(list[Math.floor(i * step)])
        }
        // LLM pulse + target glow respond to the whole burst, not the sample.
        for (let i = 0; i < list.length; i += 1) {
          const event = list[i]
          if (!event || typeof event !== 'object') continue
          const kind = String(event.kind || '').toLowerCase()
          if (kind.indexOf('llm') === 0) {
            pulses.push({ life: 0 })
            if (pulses.length > 4) pulses.splice(0, pulses.length - 4)
          }
          if (event.target && organMap[event.target]) flashes[event.target] = 0
        }
      }

      function update(deltaMs) {
        const factor = clamp(deltaMs, 0, 64) / 16.6667
        ambience += factor
        let writeIndex = 0
        for (let i = 0; i < particles.length; i += 1) {
          const particle = particles[i]
          if (particle.mode === 'path') {
            particle.t += particle.speed * factor
            if (particle.t < 1) particles[writeIndex++] = particle
          } else {
            particle.life += factor
            particle.angle += particle.spin * factor
            if (particle.life < particle.maxLife) particles[writeIndex++] = particle
          }
        }
        particles.length = writeIndex
        for (let i = pulses.length - 1; i >= 0; i -= 1) {
          pulses[i].life += deltaMs
          if (pulses[i].life > 900) pulses.splice(i, 1)
        }
        const flashIds = Object.keys(flashes)
        for (let i = 0; i < flashIds.length; i += 1) {
          const id = flashIds[i]
          flashes[id] += deltaMs
          if (flashes[id] > 700) delete flashes[id]
        }
      }

      function bezier(particle, t) {
        const inverse = 1 - t
        return {
          x: inverse * inverse * particle.ax + 2 * inverse * t * particle.cx + t * t * particle.bx,
          y: inverse * inverse * particle.ay + 2 * inverse * t * particle.cy + t * t * particle.by,
        }
      }

      function drawTrail(g, fromX, fromY, toX, toY, color) {
        g.beginPath()
        g.moveTo(fromX, fromY)
        g.lineTo(toX, toY)
        g.strokeStyle = withAlpha(color, 0.22)
        g.lineWidth = 1
        g.stroke()
      }

      function drawPulses(g) {
        const node = organMap.heart
        if (!node) return
        const cx = projectX(node.x)
        const cy = projectY(node.y)
        const baseRadius = (num(node.size) || 120) * 0.5 * view.scale
        // Ambient activity ring.
        const breath = (Math.sin(ambience / 38) + 1) / 2
        g.beginPath()
        g.arc(cx, cy, baseRadius + 6 + breath * 4, 0, Math.PI * 2)
        g.strokeStyle = withAlpha(colors.brand, 0.08 + breath * 0.06)
        g.lineWidth = 1
        g.stroke()
        // Pulse rings on LLM activity.
        for (let i = 0; i < pulses.length; i += 1) {
          const progress = clamp(pulses[i].life / 900, 0, 1)
          const radius = baseRadius * 0.8 + progress * Math.max(30, baseRadius * 1.6)
          g.beginPath()
          g.arc(cx, cy, radius, 0, Math.PI * 2)
          g.strokeStyle = withAlpha('#ff8b93', (1 - progress) * 0.6)
          g.lineWidth = 1.6
          g.stroke()
        }
      }

      function drawFlashes(g) {
        const flashIds = Object.keys(flashes)
        for (let i = 0; i < flashIds.length; i += 1) {
          const node = organMap[flashIds[i]]
          if (!node) continue
          const progress = clamp(flashes[flashIds[i]] / 700, 0, 1)
          const radius = (num(node.size) || 90) * (0.7 + progress * 0.9) * view.scale
          if (radius <= 0) continue
          const cx = projectX(node.x)
          const cy = projectY(node.y)
          const gradient = safe(function () { return g.createRadialGradient(cx, cy, 0, cx, cy, radius) }, null)
          if (!gradient) continue
          gradient.addColorStop(0, withAlpha('#ffe9b8', (1 - progress) * 0.42))
          gradient.addColorStop(0.55, withAlpha('#ffd27a', (1 - progress) * 0.16))
          gradient.addColorStop(1, withAlpha('#ffd27a', 0))
          g.fillStyle = gradient
          g.beginPath()
          g.arc(cx, cy, radius, 0, Math.PI * 2)
          g.fill()
        }
      }

      function drawParticles(g) {
        g.globalCompositeOperation = 'lighter'
        for (let i = 0; i < particles.length; i += 1) {
          const particle = particles[i]
          let headX
          let headY
          let midX
          let midY
          let tailX
          let tailY
          let fade
          if (particle.mode === 'path') {
            const head = bezier(particle, particle.t)
            const mid = bezier(particle, Math.max(0, particle.t - 0.045))
            const tail = bezier(particle, Math.max(0, particle.t - 0.09))
            headX = projectX(head.x)
            headY = projectY(head.y)
            midX = projectX(mid.x)
            midY = projectY(mid.y)
            tailX = projectX(tail.x)
            tailY = projectY(tail.y)
            fade = 1 - Math.pow(particle.t, 6)
          } else {
            const radius = particle.radius
            const baseX = projectX(particle.cx)
            const baseY = projectY(particle.cy)
            const scaledRadius = radius * view.scale
            const headAngle = particle.angle
            headX = baseX + Math.cos(headAngle) * scaledRadius
            headY = baseY + Math.sin(headAngle) * scaledRadius
            midX = baseX + Math.cos(headAngle - 0.16) * scaledRadius
            midY = baseY + Math.sin(headAngle - 0.16) * scaledRadius
            tailX = baseX + Math.cos(headAngle - 0.32) * scaledRadius
            tailY = baseY + Math.sin(headAngle - 0.32) * scaledRadius
            fade = clamp(1 - particle.life / particle.maxLife, 0, 1) * (particle.life < 8 ? particle.life / 8 : 1)
          }
          g.globalAlpha = clamp(particle.alpha * fade, 0, 1)
          drawTrail(g, tailX, tailY, midX, midY, particle.color)
          drawTrail(g, midX, midY, headX, headY, particle.color)
          const radius = Math.max(0.8, particle.radius * view.scale)
          g.beginPath()
          g.arc(headX, headY, radius, 0, Math.PI * 2)
          g.fillStyle = withAlpha(particle.color, 0.9)
          g.fill()
          g.beginPath()
          g.arc(headX, headY, radius * 2.6, 0, Math.PI * 2)
          g.fillStyle = withAlpha(particle.color, 0.10)
          g.fill()
        }
        g.globalAlpha = 1
        g.globalCompositeOperation = 'source-over'
      }

      function draw() {
        if (disposed) return
        const g = getGraphic()
        if (!g || !view.w || !view.h) return
        g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
        g.clearRect(0, 0, view.w, view.h)
        drawPulses(g)
        drawFlashes(g)
        drawParticles(g)
      }

      function tick(now) {
        rafHandle = 0
        if (disposed || paused) return
        const stamp = typeof now === 'number' ? now : Date.now()
        const delta = lastFrame > 0 ? Math.min(80, stamp - lastFrame) : 16.6667
        lastFrame = stamp
        update(delta)
        draw()
        rafHandle = rafSchedule(tick)
      }

      function startLoop() {
        if (disposed || paused || rafHandle) return
        lastFrame = 0
        rafHandle = rafSchedule(tick)
      }

      function stopLoop() {
        if (!rafHandle) return
        rafCancel(rafHandle)
        rafHandle = 0
      }

      function onVisibility() {
        const hidden = safe(function () { return typeof document !== 'undefined' && document.hidden === true }, false)
        if (hidden) stopLoop()
        else if (!paused) startLoop()
      }

      function setPaused(next) {
        paused = next === true
        if (paused) stopLoop()
        else startLoop()
      }

      attachResize()
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibility)
        visibilityAttached = true
      }
      startLoop()

      return {
        setOrgans: function setOrgans(list) {
          if (disposed) return
          if (Array.isArray(list) && list.length > 0) {
            organs = list.slice()
            organMap = buildNodeMap(organs)
          }
        },
        push: function push(events) {
          if (disposed) return
          spawn(events)
        },
        setPaused: setPaused,
        refreshTheme: function refreshTheme() {
          colors = safe(readColors, THEME_FALLBACK) || THEME_FALLBACK
          if (!paused) draw()
        },
        resize: function resize() {
          applySize()
          if (!paused) draw()
        },
        dispose: function dispose() {
          if (disposed) return
          disposed = true
          stopLoop()
          detachResize()
          if (visibilityAttached && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
            visibilityAttached = false
          }
          particles = []
          pulses = []
          flashes = Object.create(null)
          graphic = null
        },
      }
    }

    // ---------------------------------------------------------------------
    // Small presentational pieces shared by the rail, diagram, drawer and tabs.
    // ---------------------------------------------------------------------

    function layerLabelKey(layerId) {
      const id = String(layerId || '')
      if (!id) return 'layerEntry'
      return 'layer' + id.charAt(0).toUpperCase() + id.slice(1)
    }

    /** Sidebar panellist glyph: a layered system diagram with a live trace. */
    function PanelGlyph(props) {
      const size = Number(props && props.size) > 0 ? props.size : 18
      const active = !!(props && props.active)
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: 'false',
        style: { display: 'block', opacity: active ? 1 : 0.92 },
      },
        h('rect', { x: 2.6, y: 3.4, width: 5.2, height: 4.4, rx: 1 }),
        h('rect', { x: 2.6, y: 9.8, width: 5.2, height: 4.4, rx: 1 }),
        h('rect', { x: 2.6, y: 16.2, width: 5.2, height: 4.4, rx: 1 }),
        h('rect', { x: 10.2, y: 8, width: 5.4, height: 4.4, rx: 1 }),
        h('rect', { x: 10.2, y: 14.4, width: 5.4, height: 4.4, rx: 1 }),
        h('rect', { x: 17.8, y: 11.2, width: 3.6, height: 4.4, rx: 1 }),
        h('path', { d: 'M7.8 5.6h1.4c.6 0 .9.3.9.9v2.4' }),
        h('path', { d: 'M7.8 12h1.4c.6 0 .9.3.9.9v2.4' }),
        h('path', { d: 'M15.6 10.2v2.4c0 .6.3.9.9.9h1.2' }),
        h('circle', { cx: 21.1, cy: 8.2, r: 1.1, fill: 'currentColor', stroke: 'none' })
      )
    }

    /** Layer glyph used by the left rail rows. */
    function DomainGlyph(props) {
      const layer = props && props.layer ? props.layer : 'entry'
      const size = props && props.size ? props.size : 14
      const common = {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block', flex: 'none' },
      }
      if (layer === 'reasoning') {
        return h('svg', common,
          h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.4 }),
          h('rect', { x: 6.4, y: 6.4, width: 3.2, height: 3.2, rx: 0.6 }),
          h('path', { d: 'M5.6 1.8v2.2M8 1.8v2.2M10.4 1.8v2.2M5.6 12v2.2M8 12v2.2M10.4 12v2.2M1.8 5.6h2.2M1.8 8h2.2M1.8 10.4h2.2M12 5.6h2.2M12 8h2.2M12 10.4h2.2' })
        )
      }
      if (layer === 'execution') {
        return h('svg', common,
          h('rect', { x: 1.8, y: 2.6, width: 12.4, height: 10.8, rx: 1.8 }),
          h('path', { d: 'M1.8 5.4h12.4' }),
          h('path', { d: 'M4.4 8.2l2 1.8-2 1.8M7.8 11.8h3.4' })
        )
      }
      if (layer === 'state') {
        return h('svg', common,
          h('ellipse', { cx: 8, cy: 4.2, rx: 5.2, ry: 2.2 }),
          h('path', { d: 'M2.8 4.2v7.6c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V4.2' }),
          h('path', { d: 'M2.8 8c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2' })
        )
      }
      if (layer === 'kernel') {
        return h('svg', common,
          h('path', { d: 'M8 1.8 13.4 4.6v6.8L8 14.2 2.6 11.4V4.6L8 1.8z' }),
          h('circle', { cx: 8, cy: 8, r: 2.2 }),
          h('path', { d: 'M8 5.8V4M8 12v-1.8M10.2 8H12M4 8h1.8' })
        )
      }
      return h('svg', common,
        h('rect', { x: 1.8, y: 2.4, width: 12.4, height: 11.2, rx: 1.8 }),
        h('path', { d: 'M1.8 5.3h12.4' }),
        h('circle', { cx: 4, cy: 3.85, r: 0.55, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 5.9, cy: 3.85, r: 0.55, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M4.4 8.2h4.2M4.4 10.6h6.4' })
      )
    }

    function StatusDot(props) {
      const status = props && props.status ? props.status : 'idle'
      const size = props && props.size ? props.size : 7
      const pulse = props && props.pulse === true
      return h('span', {
        className: 'da-dot' + (pulse ? ' da-dot-pulse' : ''),
        style: { width: size, height: size, color: statusColorVar(status) },
        title: status,
      })
    }

    function KindChip(props) {
      const kind = String(props && props.kind !== undefined && props.kind !== null ? props.kind : '')
      const color = kindColor(kind)
      const text = kind.length > 14 ? kind.slice(0, 13) + '…' : kind
      return h('span', {
        className: 'da-chip',
        style: { color: color, borderColor: withAlpha(color, 0.5), background: withAlpha(color, 0.1) },
        title: kind,
      }, text)
    }

    function Chip(props) {
      const color = props && props.color ? props.color : 'currentColor'
      return h('span', {
        className: 'da-chip',
        style: { color: color, borderColor: withAlpha(color, 0.5), background: withAlpha(color, 0.1) },
        title: props && props.title ? props.title : undefined,
      }, props && props.label !== undefined ? String(props.label) : '')
    }

    function MetricCard(props) {
      const accent = props && props.accent ? props.accent : 'var(--da-cyan)'
      return h('div', { className: 'da-card' },
        h('div', { className: 'da-card-value', style: { color: accent } }, props.value),
        h('div', { className: 'da-card-label' }, props.label)
      )
    }

    function Stat(props) {
      return h('div', { className: 'da-stat' + (props && props.wide ? ' da-stat-wide' : '') },
        h('div', { className: 'da-stat-value', style: props && props.accent ? { color: props.accent } : undefined }, props.value),
        h('div', { className: 'da-stat-label' }, props.label)
      )
    }

    function Field(props) {
      const raw = props.value
      const text = raw === undefined || raw === null || raw === '' ? '—' : String(raw)
      return h('div', { className: 'da-kv' },
        h('span', { className: 'da-kv-k' }, props.label),
        h('span', { className: 'da-kv-v', title: props.title || text }, text)
      )
    }

    function StatRow(props) {
      const items = Array.isArray(props.items) ? props.items : []
      return h('div', { className: 'da-stat-row' }, items.map(function (item, index) {
        return h('div', { key: 'stat:' + index, className: 'da-stat-item' },
          h('span', { className: 'da-stat-value', style: item.accent ? { color: item.accent } : undefined }, String(item.value === undefined ? '-' : item.value)),
          h('span', { className: 'da-stat-label' }, String(item.label || ''))
        )
      }))
    }

    const CAUSAL_LABELS = {
      user: 'causalUser', request: 'causalRequest', llm: 'causalLlm',
      tool: 'causalTool', result: 'causalResult', assistant: 'causalAssistant', turn: 'causalTurn',
    }
    const CAUSAL_COLORS = {
      user: '#b18cff', request: '#4f9dff', llm: '#ffa64d',
      tool: '#3ee8ff', result: '#7ee0b8', assistant: '#ff6ad5', turn: '#ffc04d',
    }

    /** Vertical causal chain: user → llm → tools → results → assistant → turn. */
    function CausalChain(props) {
      const t = props.t
      const chain = props.chain && typeof props.chain === 'object' ? props.chain : { steps: [], note: true }
      const steps = Array.isArray(chain.steps) ? chain.steps : []
      if (steps.length === 0) {
        return h('div', { className: 'da-causal-empty' }, t('causalEmpty'))
      }
      return h('div', { className: 'da-causal' },
        h('div', { className: 'da-causal-list' }, steps.map(function (step, index) {
          const color = CAUSAL_COLORS[step.kind] || FLOW_COLORS.other
          return h('button', {
            key: 'causal:' + index + ':' + index,
            type: 'button',
            className: 'da-causal-step' + (step.active ? ' da-active' : ''),
            onClick: function () {
              if (typeof props.onSelectEvent === 'function') props.onSelectEvent({ type: 'event', id: step.eventId })
            },
            title: step.label,
          },
            h('span', { className: 'da-causal-dot', style: { background: color } }),
            h('span', { className: 'da-causal-kind', style: { color: color } }, t(CAUSAL_LABELS[step.kind] || 'causalStep')),
            h('span', { className: 'da-causal-label' }, step.label),
            h('span', { className: 'da-causal-time da-mono' },
              fmtRelMs(step.relMs) + (step.ms > 0 ? ' · ' + fmtMs(step.ms) : '')),
            h('span', { className: 'da-causal-ok', style: { color: step.ok ? 'var(--dsw-alias-state-success-primary, #3ddc97)' : 'var(--dsw-alias-state-error-primary, #ff5f6d)' } }, step.ok ? '●' : '✕')
          )
        })),
        h('div', { className: 'da-causal-note' }, t('causalNote'))
      )
    }

    /** Scrollable preformatted block for args/results/JSON previews. */
    function PreBlock(props) {
      const text = props.text === undefined || props.text === null ? '' : String(props.text)
      if (!text) return null
      return h('pre', { className: 'da-pre', title: props.title || text.slice(0, 160) }, text)
    }

    /** Mini bar sparkline for a latency distribution. */
    function LatencySparkline(props) {
      const t = props.t
      const values = Array.isArray(props.values) ? props.values : []
      if (values.length === 0) return null
      const max = values.reduce(function (top, value) { return Math.max(top, num(value)) }, 1)
      const width = 100
      const height = 26
      const slot = width / values.length
      return h('div', { className: 'da-latency' },
        h('svg', {
          className: 'da-latency-svg',
          viewBox: '0 0 ' + width + ' ' + height,
          preserveAspectRatio: 'none',
          'aria-hidden': true,
        }, values.map(function (value, index) {
          const barHeight = Math.max(1.5, (num(value) / max) * (height - 3))
          return h('rect', {
            key: 'lat:' + index,
            x: round1(index * slot + slot * 0.15),
            y: round1(height - barHeight),
            width: round1(Math.max(0.8, slot * 0.7)),
            height: round1(barHeight),
            rx: 1,
            style: {
              fill: num(value) === max ? 'var(--dsw-alias-state-warn-primary, #ffc04d)' : 'var(--da-cyan, #3ee8ff)',
              opacity: 0.82,
            },
          })
        })),
        h('div', { className: 'da-latency-caption' }, t('latencyDist') + ' · ' + fmtNum(values.length))
      )
    }

    /** Collapsible full-text block (English originals) — never truncates content. */
    function FoldText(props) {
      const t = props.t
      const text = props.text === undefined || props.text === null ? '' : String(props.text)
      if (!text) return null
      return h('details', { className: 'da-raw-desc' },
        h('summary', null,
          h('span', { className: 'da-when-closed' }, t('expandEnglish')),
          h('span', { className: 'da-when-open' }, t('collapseEnglish'))
        ),
        h('div', { className: 'da-desc da-desc-full' }, text)
      )
    }

    function SectionTitle(props) {
      return h('div', { className: 'da-section-title' },
        h('span', null, props.title),
        props.extra !== undefined && props.extra !== null ? h('span', { className: 'da-mono' }, props.extra) : null
      )
    }

    function Empty(props) {
      return h('div', { className: 'da-empty' }, props && props.text ? props.text : '—')
    }

    function ActivityBar(props) {
      const value = clamp01(props && props.value ? props.value : 0)
      const color = props && props.color ? props.color : 'var(--da-cyan)'
      return h('span', { className: 'da-domain-bar' },
        h('i', { style: { width: Math.round(value * 100) + '%', background: color } })
      )
    }

    function PlayPauseIcon(props) {
      const paused = props && props.paused === true
      const size = props && props.size ? props.size : 12
      if (paused) {
        return h('svg', { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true, style: { display: 'block' } },
          h('path', { d: 'M3 2.2 9.6 6 3 9.8z', fill: 'currentColor' })
        )
      }
      return h('svg', { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 2.4, y: 2.2, width: 2.6, height: 7.6, rx: 0.8, fill: 'currentColor' }),
        h('rect', { x: 7, y: 2.2, width: 2.6, height: 7.6, rx: 0.8, fill: 'currentColor' })
      )
    }

    function RailToggleIcon(props) {
      const mode = props && props.mode ? props.mode : 'rail'
      const size = props && props.size ? props.size : 13
      const right = mode === 'drawer'
      return h('svg', { width: size, height: size, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 1.5, y: 2, width: 11, height: 10, rx: 1.6 }),
        h('rect', { x: right ? 8.4 : 2.2, y: 2, width: 3.4, height: 10, rx: 1.2, fill: 'currentColor', stroke: 'none', opacity: 0.75 }),
        h('path', { d: right ? 'M6.2 4.6 4.6 7l1.6 2.4' : 'M7.8 4.6 9.4 7l-1.6 2.4', strokeWidth: 1.1 })
      )
    }

    function Header(props) {
      const t = props.t
      let statusClass = 'da-status-connecting'
      let statusLabel = t('connConnecting')
      let statusColor = 'var(--dsw-alias-state-idle-primary, #7c8b9e)'
      if (props.conn === 'live') {
        statusClass = 'da-status-live'
        statusLabel = t('connLive')
        statusColor = 'var(--dsw-alias-state-success-primary, #3ddc97)'
      } else if (props.conn === 'reconnecting') {
        statusClass = 'da-status-reconnecting'
        statusLabel = t('connReconnecting')
        statusColor = 'var(--dsw-alias-state-warn-primary, #ffc04d)'
      } else if (props.conn === 'offline') {
        statusClass = 'da-status-offline'
        statusLabel = t('connOffline')
        statusColor = 'var(--dsw-alias-state-error-primary, #ff5f6d)'
      }
      const runtime = props.runtime && typeof props.runtime === 'object' ? props.runtime : null
      const subtitleParts = []
      if (runtime) {
        if (runtime.dshVersion) subtitleParts.push('DSH ' + runtime.dshVersion)
        if (runtime.node) subtitleParts.push(String(runtime.node))
        if (runtime.profile) subtitleParts.push(String(runtime.profile))
        if (runtime.pid !== undefined && runtime.pid !== null) subtitleParts.push('pid ' + runtime.pid)
      }
      const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : t('waitingSnapshot')
      return h('div', { className: 'da-header' },
          h('div', { className: 'da-brand' },
          h('span', { className: 'da-logo' }, h(PanelGlyph, { size: 20, active: true })),
          h('div', { className: 'da-titles' },
            h('div', { className: 'da-title', title: props.paintLabel || '' },
              h('span', null, t('title'))
            ),
            h('div', { className: 'da-sub', title: subtitle + (props.paintLabel ? ' · ' + props.paintLabel : '') }, subtitle)
          )
        ),
        h(ViewSwitch, { t: t, view: props.view, onView: props.onView }),
        props.sessions && props.sessions.length > 0 ? h('select', {
          className: 'da-session-select',
          value: props.sessionFilter || '',
          title: t('sessionFilter'),
          'aria-label': t('sessionFilter'),
          onChange: function (event) {
            if (typeof props.onSessionFilter === 'function') props.onSessionFilter(event && event.target ? event.target.value : '')
          },
        },
          h('option', { value: '' }, t('allSessions')),
          props.sessions.map(function (session) {
            return h('option', { key: 'sess:' + session.id, value: session.id },
              String(session.title || String(session.id).slice(0, 8)) + (session.active ? ' ' + t('currentSessionTag') : ''))
          })
        ) : null,
        props.sessionFilter ? (() => {
          let title = String(props.sessionFilter).slice(0, 8)
          const list = props.sessions || []
          for (let i = 0; i < list.length; i += 1) if (list[i].id === props.sessionFilter) title = list[i].title || title
          return h('span', { className: 'da-session-badge', title: t('sessionBadge') + ': ' + title },
            t('sessionBadge') + ': ' + title,
            h('button', {
              type: 'button', className: 'da-session-badge-clear',
              onClick: function () { if (typeof props.onSessionFilter === 'function') props.onSessionFilter('') },
              title: t('clearSessionFilter'), 'aria-label': t('clearSessionFilter'),
            }, '×')
          )
        })() : null,
        h('div', { className: 'da-spacer' }),
        h('span', { className: 'da-status ' + statusClass, role: 'status' },
          h('span', { className: 'da-dot da-dot-pulse', style: { color: statusColor } }),
          statusLabel
        ),
        h('span', { className: 'da-status da-mono', title: t('totalEvents') },
          fmtNum(props.eventCount || 0) + ' ' + t('events')
        ),
        h('button', {
          type: 'button', className: 'da-btn da-btn-icon', onClick: props.onHelp,
          title: t('help'), 'aria-label': t('help'), 'aria-pressed': props.helpOpen === true,
        }, '?'),
        h('button', {
          type: 'button', className: 'da-btn', onClick: props.onTogglePause,
          title: props.paused ? t('resume') : t('pause'), 'aria-pressed': props.paused === true,
        }, h(PlayPauseIcon, { paused: props.paused }), props.paused ? t('resume') : t('pause')),
        h('button', {
          type: 'button', className: 'da-btn da-btn-icon', onClick: props.onToggleRail,
          title: props.railCollapsed ? t('expandRail') : t('collapseRail'), 'aria-pressed': props.railCollapsed === true,
        }, h(RailToggleIcon, { mode: 'rail' })),
        h('button', {
          type: 'button', className: 'da-btn da-btn-icon', onClick: props.onToggleDrawer,
          title: props.drawerCollapsed ? t('expandDetail') : t('collapseDetail'), 'aria-pressed': props.drawerCollapsed === true,
        }, h(RailToggleIcon, { mode: 'drawer' }))
      )
    }

    function DomainRail(props) {
      const t = props.t
      const zh = props.zh
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const heat = props.heat && typeof props.heat === 'object' ? props.heat : {}
      const flowNodes = props.flowNodes && typeof props.flowNodes === 'object' ? props.flowNodes : {}
      const selection = props.selection
      const search = String(props.search || '')
      const results = Array.isArray(props.results) ? props.results : []
      const groups = []
      for (let i = 0; i < LAYER_ORDER.length; i += 1) {
        const layerId = LAYER_ORDER[i]
        const layerNodes = nodes.filter(function (node) { return node.layer === layerId })
        if (layerNodes.length === 0) continue
        groups.push({
          id: layerId,
          label: t(layerLabelKey(layerId)),
          rows: layerNodes.map(function (node) {
            const status = node.status || 'idle'
            const activity = nodeActivity(node, heat, flowNodes)
            const cellCount = node.plugins.length + node.services.length + node.tools.length
            const selected = !!(selection && selection.type === 'domain' && selection.id === node.id)
            return h('button', {
              key: 'domain:' + node.id,
              type: 'button',
              className: 'da-domain' + (selected ? ' da-selected' : ''),
              onClick: function () { props.onSelectDomain(node.id) },
              title: domainTitle(node, zh) + ' · ' + t(statusLabelKey(status)) + ' · ' + Math.round(activity * 100) + '%',
            },
              h('span', { className: 'da-domain-icon', style: { color: statusColorVar(status) } }, h(DomainGlyph, { layer: node.layer, size: 15 })),
              h(StatusDot, { status: status, size: 6 }),
              h('span', { className: 'da-domain-body' },
                h('span', { className: 'da-domain-name' }, domainTitle(node, zh)),
                h(ActivityBar, { value: activity, color: statusColorVar(status) })
              ),
              h('span', { className: 'da-domain-badge' }, String(cellCount))
            )
          }),
        })
      }
      let resultRows = null
      if (search.trim()) {
        resultRows = h('div', { className: 'da-results da-scroll' },
          results.length === 0
            ? h('div', { className: 'da-result-empty' }, t('searchEmpty'))
            : results.map(function (result, index) {
              const rowSelected = selection && selection.type === result.type && String(selection.id) === String(result.id)
              return h('button', {
                key: 'r' + index + ':' + result.type + ':' + String(result.id),
                type: 'button',
                className: 'da-result' + (rowSelected ? ' da-selected' : ''),
                onClick: function () { props.onSelectResult(result) },
                title: result.label + (result.sub ? ' · ' + result.sub : ''),
              },
                h('span', { className: 'da-dot-sm', style: { color: result.color || 'var(--da-cyan)' } }),
                h('span', { className: 'da-result-main' },
                  h('span', { className: 'da-result-name' }, result.label),
                  h('span', { className: 'da-result-sub' }, result.typeLabel + (result.sub ? ' · ' + result.sub : ''))
                )
              )
            })
        )
      }
      return h('div', { className: 'da-rail' + (props.collapsed ? ' da-collapsed' : '') },
        h('div', { className: 'da-rail-head' },
          h('div', { className: 'da-rail-title' },
            h('span', null, t('domains')),
            h('span', { className: 'da-mono' }, String(nodes.length))
          ),
          h('label', { className: 'da-search' },
            h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
              h('circle', { cx: 5, cy: 5, r: 3.4 }),
              h('path', { d: 'M7.6 7.6 10.4 10.4' })
            ),
            h('input', {
              className: 'da-search-input', value: search, placeholder: t('searchPlaceholder'),
              'aria-label': t('search'), spellCheck: false,
              onChange: function (event) { props.onSearch(event.target.value) },
            })
          )
        ),
        resultRows,
        h('div', { className: 'da-rail-list da-scroll' },
          groups.map(function (group) {
            return h('div', { key: 'layer:' + group.id },
              h('div', { className: 'da-layer-head' },
                h('b', null, group.label),
                h('span', null, String(group.rows.length))
              ),
              group.rows
            )
          })
        )
      )
    }

    // ---- layered architecture diagram ----

    function dominantGroup(row) {
      if (!row || !row.groups) return 'session'
      let best = 'other'
      let bestCount = -1
      const keys = Object.keys(row.groups)
      for (let i = 0; i < keys.length; i += 1) {
        if (row.groups[keys[i]] > bestCount) {
          bestCount = row.groups[keys[i]]
          best = keys[i]
        }
      }
      return best
    }

    /**
     * Flow dots: SVG <circle> elements riding the exact same cubic Bézier as
     * the edge path. One rAF updates cx/cy/fill directly through refs (never
     * setState), so dots stay strictly on the visible line and follow zoom/pan
     * automatically through the shared SVG viewBox. No canvas, no projection.
     */
    function FlowDots(props) {
      const edges = Array.isArray(props.edges) ? props.edges : []
      const apiRef = props.apiRef
      const circleRefs = React.useRef(Object.create(null))
      const flashRefs = React.useRef(Object.create(null))
      const flashSlots = React.useRef([])
      const edgesRef = React.useRef(edges)
      const pausedRef = React.useRef(props.paused === true)
      edgesRef.current = edges
      React.useEffect(function () {
        if (!apiRef) return undefined
        apiRef.current = {
          push: function (events) {
            const list = Array.isArray(events) ? events : []
            const currentEdges = edgesRef.current
            const byKey = Object.create(null)
            for (let i = 0; i < currentEdges.length; i += 1) byKey[currentEdges[i].key] = currentEdges[i]
            for (let i = 0; i < list.length; i += 1) {
              const event = list[i]
              if (!event || typeof event !== 'object') continue
              const from = typeof event.organ === 'string' ? event.organ : ''
              const to = typeof event.target === 'string' ? event.target : ''
              if (!from || !to) continue
              const edge = byKey[from + '>' + to]
              if (!edge) continue
              let slot = -1
              for (let s = 0; s < 10; s += 1) if (!flashSlots.current[s]) { slot = s; break }
              if (slot < 0) continue
              flashSlots.current[slot] = { edge: edge, color: FLOW_COLORS[kindGroup(event.kind)] || FLOW_COLORS.other, start: Date.now() }
            }
          },
          setPaused: function (next) { pausedRef.current = next === true },
          setEdges: function () {},
          setEventMap: function () {},
          setViewport: function () {},
          refreshTheme: function () {},
          resize: function () {},
          dispose: function () {},
        }
        return function () {
          if (apiRef && apiRef.current) apiRef.current = null
        }
      }, [])
      React.useEffect(function () {
        pausedRef.current = props.paused === true
      }, [props.paused])
      React.useEffect(function () {
        let disposed = false
        let raf = 0
        const started = Date.now()
        const tick = function () {
          if (disposed) return
          if (!pausedRef.current) {
            const now = Date.now()
            const frames = (now - started) / 16.6667
            const list = edgesRef.current
            for (let i = 0; i < list.length; i += 1) {
              const edge = list[i]
              if (!edge || !edge.route || !Array.isArray(edge.dotColors)) continue
              const count = edge.dotColors.length
              for (let d = 0; d < count; d += 1) {
                const circle = circleRefs.current[edge.key + ':' + d]
                if (!circle || typeof circle.setAttribute !== 'function') continue
                const t = ((frames * (edge.speed || 0.004) * 1.8 + (d + 0.3) / count) % 1 + 1) % 1
                const point = pointOnPath(edge.route, t)
                circle.setAttribute('cx', String(round1(point.x)))
                circle.setAttribute('cy', String(round1(point.y)))
                circle.setAttribute('fill', edge.dotColors[d] || edge.color || '#3ee8ff')
                circle.setAttribute('opacity', '0.92')
              }
            }
            for (let slot = 0; slot < 10; slot += 1) {
              const flash = flashSlots.current[slot]
              const circle = flashRefs.current['f' + slot]
              if (!flash) {
                if (circle && typeof circle.setAttribute === 'function') circle.setAttribute('opacity', '0')
                continue
              }
              const life = (now - flash.start) / 950
              if (life >= 1) {
                flashSlots.current[slot] = null
                if (circle && typeof circle.setAttribute === 'function') circle.setAttribute('opacity', '0')
                continue
              }
              const point = pointOnPath(flash.edge.route, Math.min(0.995, life))
              if (circle && typeof circle.setAttribute === 'function') {
                circle.setAttribute('cx', String(round1(point.x)))
                circle.setAttribute('cy', String(round1(point.y)))
                circle.setAttribute('fill', flash.color)
                circle.setAttribute('opacity', String(round1(1 - life * 0.8)))
              }
            }
          }
          raf = rafSchedule(tick)
        }
        raf = rafSchedule(tick)
        return function () {
          disposed = true
          rafCancel(raf)
        }
      }, [])
      const circles = []
      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i]
        const colors = Array.isArray(edge.dotColors) ? edge.dotColors : []
        for (let d = 0; d < colors.length; d += 1) {
          const key = edge.key + ':' + d
          circles.push(h('circle', {
            key: 'dot:' + key,
            className: 'da-flow-dot',
            r: 2.6,
            fill: colors[d],
            ref: function (element) {
              if (element) circleRefs.current[key] = element
              else delete circleRefs.current[key]
            },
          }))
        }
      }
      const flashes = []
      for (let slot = 0; slot < 10; slot += 1) {
        flashes.push(h('circle', {
          key: 'flash:' + slot,
          className: 'da-flow-flash',
          r: 3.6,
          fill: '#ffffff',
          opacity: 0,
          ref: function (element) {
            if (element) flashRefs.current['f' + slot] = element
            else delete flashRefs.current['f' + slot]
          },
        }))
      }
      return h('g', { className: 'da-flow-dots', 'aria-hidden': true }, circles, flashes)
    }

    const ArchitectureSvg = React.memo(function ArchitectureSvg(props) {
      const t = props.t
      const zh = props.zh
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const nodeById = Object.create(null)
      for (let i = 0; i < nodes.length; i += 1) {
        if (nodes[i] && nodes[i].id) nodeById[nodes[i].id] = nodes[i]
      }
      const heat = props.heat && typeof props.heat === 'object' ? props.heat : {}
      const flows = props.flows && typeof props.flows === 'object' ? props.flows : { pairs: {}, nodes: {} }
      const flowPairs = flows.pairs && typeof flows.pairs === 'object' ? flows.pairs : {}
      const flowNodes = flows.nodes && typeof flows.nodes === 'object' ? flows.nodes : {}
      const selection = props.selection

      const bands = []
      for (let i = 0; i < LAYER_DEFS.length; i += 1) {
        const layer = LAYER_DEFS[i]
        const width = layer.x2 - layer.x1 - 8
        bands.push(h('g', { key: 'band:' + layer.id },
          h('rect', { className: 'da-layer-box', x: layer.x1 + 4, y: 64, width: width, height: 536, rx: 12 }),
          h('text', { className: 'da-layer-label', x: layer.x1 + 4 + width / 2, y: 90, textAnchor: 'middle' }, t(layerLabelKey(layer.id))),
          h('text', { className: 'da-layer-sub', x: layer.x1 + 4 + width / 2, y: 106, textAnchor: 'middle' }, layer.en)
        ))
      }

      // Edges are OBSERVED ONLY: each pair comes from the last 120s of events
      // (organ -> target). There is no static/baseline skeleton to mislead.
      const flowKeys = Object.keys(flowPairs)
      const edgeRows = []
      for (let i = 0; i < flowKeys.length; i += 1) {
        const row = flowPairs[flowKeys[i]]
        if (!row || !nodeById[row.from] || !nodeById[row.to]) continue
        if (!(num(row.count) > 0)) continue
        edgeRows.push(row)
      }
      edgeRows.sort(function (a, b) { return String(a.from + '>' + a.to).localeCompare(String(b.from + '>' + b.to)) })
      const edgeKeys = edgeRows.map(function (row) { return row.from + '>' + row.to })
      const seenKey = Object.create(null)
      for (let i = 0; i < edgeKeys.length; i += 1) seenKey[edgeKeys[i]] = true
      const sideCounts = Object.create(null)
      const defs = []
      for (let i = 0; i < edgeRows.length; i += 1) {
        const row = edgeRows[i]
        const fromNode = nodeById[row.from]
        const toNode = nodeById[row.to]
        const fromSide = sideToward(fromNode, toNode)
        const toSide = sideToward(toNode, fromNode)
        defs.push({ key: row.from + '>' + row.to, row: row, fromNode: fromNode, toNode: toNode, fromSide: fromSide, toSide: toSide })
        const fromBucket = 'f:' + row.from + ':' + fromSide
        const toBucket = 't:' + row.to + ':' + toSide
        sideCounts[fromBucket] = (sideCounts[fromBucket] || 0) + 1
        sideCounts[toBucket] = (sideCounts[toBucket] || 0) + 1
      }
      const sideSpan = function (side) {
        return side === 'top' || side === 'bottom' ? NODE_W * 0.72 : NODE_H * 0.72
      }
      const hoverEdgeKey = props.hoverEdgeKey || ''
      const highlightId = props.hoverId || (selection && selection.type === 'domain' ? selection.id : null)
      const selectedEdgeKey = selection && selection.type === 'edge'
        ? String(selection.from || '') + '>' + String(selection.to || '')
        : ''
      const sideSeen = Object.create(null)
      const drawable = []
      for (let i = 0; i < defs.length; i += 1) {
        const def = defs[i]
        const row = def.row
        const reverseKey = row.to + '>' + row.from
        const bidirectional = !!seenKey[reverseKey]
        // Simple diagrams.net-style single curve: bidirectional ±16, same-direction ±8 stagger.
        const lane = bidirectional ? (def.key < reverseKey ? -16 : 16) : 0
        const fromBucket = 'f:' + row.from + ':' + def.fromSide
        const toBucket = 't:' + row.to + ':' + def.toSide
        const fromIndex = sideSeen[fromBucket] || 0
        const toIndex = sideSeen[toBucket] || 0
        sideSeen[fromBucket] = fromIndex + 1
        sideSeen[toBucket] = toIndex + 1
        const fromOffsets = spreadOffsets(sideCounts[fromBucket], sideSpan(def.fromSide))
        const toOffsets = spreadOffsets(sideCounts[toBucket], sideSpan(def.toSide))
        const spreadScale = bidirectional ? 0.3 : 1
        const fromStagger = (!bidirectional && sideCounts[fromBucket] > 1) ? (((fromIndex % 2) * 2 - 1) * 8) : 0
        const toStagger = (!bidirectional && sideCounts[toBucket] > 1) ? (((toIndex % 2) * 2 - 1) * 8) : 0
        const start = sideAnchor(def.fromNode, def.fromSide, clampSideOffset(def.fromSide, (fromOffsets[fromIndex] || 0) * spreadScale + lane + fromStagger))
        const end = sideAnchor(def.toNode, def.toSide, clampSideOffset(def.toSide, (toOffsets[toIndex] || 0) * spreadScale + lane + toStagger))
        const obstacles = buildObstacles(nodes, 12, [row.from, row.to])
        const route = lightEdgeRoute(start, end, obstacles)
        const count = num(row.count)
        drawable.push({
          def: def, row: row, route: route, count: count,
          width: clamp(1 + Math.min(3.5, count * 0.28), 1, 4.5),
          color: FLOW_COLORS[dominantGroup(row)] || FLOW_COLORS.session,
          dotColors: edgeDotColors(row),
          speed: dotPlanForEdge(count).speed,
          hasError: num(row.errors) > 0,
          adjacent: !highlightId || row.from === highlightId || row.to === highlightId,
          edgeHot: hoverEdgeKey === def.key || selectedEdgeKey === def.key,
        })
      }
      const labelCandidates = []
      for (let i = 0; i < drawable.length; i += 1) {
        const item = drawable[i]
        const showLabel = item.edgeHot || (highlightId ? item.adjacent : item.count >= 5)
        if (!showLabel) continue
        const text = String(item.count) + ' 次/min'
        labelCandidates.push({ key: item.def.key, x: item.route.mid.x, y: item.route.mid.y, label: text, width: text.length * 9 + 14, hasError: item.hasError })
      }
      const labelPositions = placeEdgeLabels(labelCandidates.map(function (item) { return { x: item.x, y: item.y, width: item.width } }))
      const labelByKey = Object.create(null)
      for (let i = 0; i < labelCandidates.length; i += 1) {
        labelByKey[labelCandidates[i].key] = Object.assign({}, labelCandidates[i], labelPositions[i])
      }
      const edges = []
      for (let i = 0; i < drawable.length; i += 1) {
        const item = drawable[i]
        const dimmed = !item.adjacent && !item.edgeHot
        const onSelect = function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          props.onSelectEdge({ from: item.row.from, to: item.row.to, mode: 'domain' })
        }
        const onEnter = function () { if (typeof props.onHoverEdge === 'function') props.onHoverEdge(item.def.key) }
        const onLeave = function () { if (typeof props.onHoverEdge === 'function') props.onHoverEdge(null) }
        edges.push(h('path', {
          key: 'edge:' + item.def.key,
          className: 'da-edge-flow' + (dimmed ? ' da-edge-dim' : '') + (item.edgeHot ? ' da-edge-hot' : ''),
          d: item.route.d,
          style: {
            stroke: withAlpha(item.color, item.hasError ? 0.9 : 0.7),
            strokeWidth: item.edgeHot ? item.width + 0.6 : item.width,
            opacity: dimmed ? 0.08 : (item.edgeHot ? 0.6 : 0.22),
            cursor: 'pointer',
          },
          onClick: onSelect,
          onMouseEnter: onEnter,
          onMouseLeave: onLeave,
        }))
        const label = labelByKey[item.def.key]
        if (!label) continue
        edges.push(h('g', {
          key: 'edgelabel:' + item.def.key,
          className: dimmed ? 'da-edge-dim' : undefined,
          style: { cursor: 'pointer' },
          onClick: onSelect,
          onMouseEnter: onEnter,
          onMouseLeave: onLeave,
        },
          h('rect', { className: 'da-edge-label-bg', x: label.x - label.width / 2, y: label.y - 8.5, width: label.width, height: 17, rx: 3.5 }),
          h('text', {
            className: 'da-edge-label' + (label.hasError ? ' da-edge-label-error' : ''),
            x: label.x, y: label.y + 4, textAnchor: 'middle',
          }, label.label)
        ))
      }

      const cards = []
      const popovers = []
      const hoverDomainId = props.hoverId || ''
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i]
        if (!node || !DOMAIN_BY_ID[node.id]) continue
        const status = node.status || 'idle'
        const activity = nodeActivity(node, heat, flowNodes)
        const rate = num(flowNodes[node.id])
        const componentCount = node.plugins.length + node.services.length + node.tools.length
        const selected = !!(selection && selection.type === 'domain' && selection.id === node.id)
        const hovered = hoverDomainId === node.id
        const focus = selected || hovered
        const dim = !!(highlightId && highlightId !== node.id)
        const examples = Array.isArray(node.examples) ? node.examples : []
        const shortCountText = String(componentCount) + ' ' + t('components') + (rate > 0 ? ' · ' + rate + ' 次/min' : '')
        cards.push(h('g', {
          key: 'node:' + node.id,
          className: 'da-node' + (dim ? ' da-node-dim' : ''),
          transform: 'translate(' + num(node.x) + ' ' + num(node.y) + ')',
          onClick: function () { props.onSelectDomain(node.id) },
          role: 'button', tabIndex: 0, 'aria-label': domainTitle(node, zh),
          onMouseEnter: function () { if (typeof props.onHoverDomain === 'function') props.onHoverDomain(node.id) },
          onMouseLeave: function () { if (typeof props.onHoverDomain === 'function') props.onHoverDomain(null) },
          onKeyDown: function (event) {
            if (event && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              props.onSelectDomain(node.id)
            }
          },
        },
          h('title', null, domainTitle(node, zh) + ' · ' + domainSubtitle(node, zh) + (rate > 0 ? ' · ' + rate + ' 次/min' : '')),
          h('rect', { className: 'da-node-card', x: -NODE_W / 2, y: -NODE_H / 2, width: NODE_W, height: NODE_H, rx: 9 }),
          h('rect', {
            className: 'da-node-accent', x: -NODE_W / 2, y: -NODE_H / 2 + 6, width: 3, height: NODE_H - 12, rx: 1.5,
            style: { fill: statusColorVar(status), opacity: 0.9 },
          }),
          h('circle', { cx: -NODE_W / 2 + 13, cy: -NODE_H / 2 + 14, r: 3.2, style: { fill: statusColorVar(status) } }),
          h('text', { className: 'da-node-title', x: -NODE_W / 2 + 22, y: -NODE_H / 2 + 18 }, domainTitle(node, zh)),
          h('text', { className: 'da-node-counts', x: -NODE_W / 2 + 12, y: -NODE_H / 2 + 34 }, shortCountText),
          h('rect', { className: 'da-node-bar-bg', x: -NODE_W / 2 + 12, y: NODE_H / 2 - 9, width: NODE_W - 24, height: 3, rx: 1.5 }),
          h('rect', {
            className: 'da-node-bar', x: -NODE_W / 2 + 12, y: NODE_H / 2 - 9,
            width: Math.max(2, (NODE_W - 24) * activity), height: 3, rx: 1.5,
            style: { fill: statusColorVar(status) },
          }),
          selected ? h('rect', { className: 'da-node-selected', x: -NODE_W / 2, y: -NODE_H / 2, width: NODE_W, height: NODE_H, rx: 9 }) : null,
        ))
        if (!focus) continue
        const popW = 214
        const popH = 76
        const wantedX = node.x + (node.x > VIEW_W * 0.6 ? -NODE_W / 2 - popW - 10 : NODE_W / 2 + 10)
        const popX = clamp(wantedX, 8, VIEW_W - 8 - popW) - node.x
        const wantedY = node.y - popH / 2
        const popY = clamp(wantedY, 8, VIEW_H - 8 - popH) - node.y
        popovers.push(h('g', {
          key: 'popover:' + node.id,
          className: 'da-node-popover',
          transform: 'translate(' + num(node.x) + ' ' + num(node.y) + ')',
          style: { pointerEvents: 'none' },
        },
          h('rect', { className: 'da-popover-bg', x: popX, y: popY, width: popW, height: popH, rx: 8 }),
          h('text', { className: 'da-popover-title', x: popX + 10, y: popY + 18 }, t(statusLabelKey(status)) + ' · ' + String(componentCount) + ' ' + t('components')),
          h('text', { className: 'da-popover-sub', x: popX + 10, y: popY + 34 }, domainSubtitle(node, zh)),
          h('text', { className: 'da-popover-stat', x: popX + 10, y: popY + 51 }, t('activity') + ': ' + (rate > 0 ? rate + ' 次/min' : Math.round(activity * 100) + '%')),
          h('text', { className: 'da-popover-examples', x: popX + 10, y: popY + 68 }, (examples.slice(0, 3).join(' · ') || domainTitle(node, zh)).slice(0, 42))
        ))
      }

      const kernel = h(KernelBand, {
        t: t,
        snapshot: props.snapshot,
        selection: selection,
        onSelectDomain: props.onSelectDomain,
        nodesCount: nodes.length,
        edgesCount: edgeKeys.length,
      })

      const dotEdges = drawable.map(function (item) {
        return {
          key: item.def.key,
          route: item.route,
          dotColors: item.dotColors,
          speed: item.speed,
          color: item.color,
        }
      })
      return h('svg', {
        className: 'da-stage-svg',
        viewBox: props.viewBox || ('0 0 ' + VIEW_W + ' ' + VIEW_H),
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': t('stageLiveTag'),
      },
        bands,
        edges,
        h(FlowDots, { edges: dotEdges, apiRef: props.apiRef, paused: props.paused }),
        cards,
        popovers,
        kernel
      )
    })

    /** Shared kernel host band (clickable host layer summary). */
    function KernelBand(props) {
      const t = props.t
      const snapshot = props.snapshot
      const selection = props.selection
      const fibers = snapshot && snapshot.topology && Array.isArray(snapshot.topology.fibers) ? snapshot.topology.fibers.length : 0
      const counts = snapshot && snapshot.counts && typeof snapshot.counts === 'object' ? snapshot.counts : {}
      const plugins = snapshot && Array.isArray(snapshot.plugins) ? snapshot.plugins : []
      const services = snapshot && Array.isArray(snapshot.services) ? snapshot.services : []
      const pluginTotal = counts.plugins !== undefined ? num(counts.plugins) : plugins.length
      const pluginActive = counts.pluginsActive !== undefined
        ? num(counts.pluginsActive)
        : plugins.filter(function (plugin) { return plugin && plugin.enabled !== false }).length
      const serviceTotal = counts.services !== undefined ? num(counts.services) : services.length
      const clientBundles = snapshot && Array.isArray(snapshot.clientBundles) ? snapshot.clientBundles.length : 0
      const spineSelected = !!(selection && selection.type === 'domain' && selection.id === 'spine')
      return h('g', {
        key: 'kernel-band',
        onClick: function () { props.onSelectDomain('spine') },
        role: 'button', tabIndex: 0, 'aria-label': t('kernelBandTitle'),
        onKeyDown: function (event) {
          if (event && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            props.onSelectDomain('spine')
          }
        },
      },
        h('rect', {
          className: 'da-kernel-band', x: 40, y: 618, width: 1160, height: 74, rx: 10,
          style: spineSelected ? { stroke: 'var(--dsw-alias-brand-primary, #3ee8ff)' } : undefined,
        }),
        h('text', { className: 'da-kernel-title', x: 62, y: 648 }, t('kernelBandTitle')),
        h('text', { className: 'da-kernel-sub', x: 62, y: 670 },
          t('plugins') + ' ' + fmtNum(pluginActive) + '/' + fmtNum(pluginTotal)
          + ' · ' + t('services') + ' ' + fmtNum(serviceTotal)
          + ' · ' + t('clientBundles') + ' ' + fmtNum(clientBundles)),
        h('text', { className: 'da-kernel-stat', x: 700, y: 648 }, t('kernelFibers') + ' ' + fmtNum(fibers)),
        h('text', { className: 'da-kernel-stat', x: 900, y: 648 }, t('nodesUnit') + ' ' + fmtNum(num(props.nodesCount)) + ' · ' + t('edgesUnit') + ' ' + fmtNum(num(props.edgesCount))),
        h('text', { className: 'da-kernel-stat', x: 900, y: 670 }, t('statusActive') + ' ' + fmtNum(pluginActive) + ' · ' + t('fibers') + ' ' + fmtNum(fibers))
      )
    }

    /**
     * Tool-call view: top-N active tools on the left, the 14 domain targets on
     * the right, orthogonal arrows for the real tool→domain calls of the window.
     */
    const ToolViewSvg = React.memo(function ToolViewSvg(props) {
      const t = props.t
      const zh = props.zh
      const domainNodes = Array.isArray(props.nodes) ? props.nodes : []
      const toolData = Array.isArray(props.toolNodes) ? props.toolNodes : []
      const toolLayout = layoutToolNodes(toolData)
      const targetLayout = layoutToolTargets(domainNodes)
      const targetById = Object.create(null)
      for (let i = 0; i < targetLayout.length; i += 1) targetById[targetLayout[i].id] = targetLayout[i]
      const selection = props.selection
      const hover = props.hover && typeof props.hover === 'object' ? props.hover : null
      const highlightType = hover ? hover.type : (selection ? selection.type : '')
      const highlightId = hover ? hover.id : (selection ? selection.id : '')
      const [showAllEdges, setShowAllEdges] = React.useState(false)
      const topNames = pickTopTools(toolLayout, 8)
      const topSet = Object.create(null)
      for (let i = 0; i < topNames.length; i += 1) topSet[topNames[i]] = true
      const domainCallSum = Object.create(null)

      // Observed tool→domain traffic only — there is no static tool graph.
      const rawEdges = []
      const fromCounts = Object.create(null)
      const toCounts = Object.create(null)
      for (let i = 0; i < toolLayout.length; i += 1) {
        const toolNode = toolLayout[i]
        const edges = toolNode.data && Array.isArray(toolNode.data.edges) ? toolNode.data.edges : []
        for (let e = 0; e < edges.length; e += 1) {
          const countValue = num(edges[e].count)
          if (!(countValue > 0)) continue
          const targetNode = targetById[edges[e].domain]
          if (!targetNode) continue
          domainCallSum[edges[e].domain] = (domainCallSum[edges[e].domain] || 0) + countValue
          if (!showAllEdges && topSet[toolNode.name] !== true) continue
          rawEdges.push({ toolNode: toolNode, targetNode: targetNode, count: countValue, errors: num(edges[e].errors), domain: edges[e].domain, toolName: toolNode.name })
          fromCounts[toolNode.name] = (fromCounts[toolNode.name] || 0) + 1
          toCounts[edges[e].domain] = (toCounts[edges[e].domain] || 0) + 1
        }
      }
      rawEdges.sort(function (a, b) { return String(a.toolName + a.domain).localeCompare(String(b.toolName + b.domain)) })
      const seenFrom = Object.create(null)
      const seenTo = Object.create(null)
      const hoverEdgeKey = props.hoverEdgeKey || ''
      const selectedEdgeKey = selection && selection.type === 'edge' && selection.mode === 'tool'
        ? String(selection.from || '') + '>' + String(selection.to || '')
        : ''
      const edgeDraw = []
      for (let i = 0; i < rawEdges.length; i += 1) {
        const edge = rawEdges[i]
        const key = edge.toolName + '>' + edge.domain
        const fromIdx = seenFrom[edge.toolName] || 0
        const toIdx = seenTo[edge.domain] || 0
        seenFrom[edge.toolName] = fromIdx + 1
        seenTo[edge.domain] = toIdx + 1
        const fromOffsets = spreadOffsets(fromCounts[edge.toolName], edge.toolNode.h * 0.56)
        const toOffsets = spreadOffsets(toCounts[edge.domain], edge.targetNode.h * 0.56)
        const start = { x: edge.toolNode.x + edge.toolNode.w / 2, y: edge.toolNode.y + (fromOffsets[fromIdx] || 0) }
        const end = { x: edge.targetNode.x - edge.targetNode.w / 2, y: edge.targetNode.y + (toOffsets[toIdx] || 0) }
        const obstacles = []
        for (let oi = 0; oi < toolLayout.length; oi += 1) {
          const other = toolLayout[oi]
          if (other.name === edge.toolName) continue
          obstacles.push(rectOfNode(other, 6))
        }
        for (let oi = 0; oi < targetLayout.length; oi += 1) {
          const other = targetLayout[oi]
          if (other.id === edge.domain) continue
          obstacles.push(rectOfNode(other, 6))
        }
        const route = simpleEdgeRoute(start, end)
        const traitGroups = Object.create(null)
        if (edge.kinds && typeof edge.kinds === 'object') {
          const kindKeys = Object.keys(edge.kinds)
          for (let k = 0; k < kindKeys.length; k += 1) {
            const group = kindGroup(kindKeys[k])
            traitGroups[group] = (traitGroups[group] || 0) + num(edge.kinds[kindKeys[k]])
          }
        }
        const dotColors = edgeDotColors({ count: edge.count, groups: traitGroups })
        const adjacent = !highlightId
          || (highlightType === 'tool' && highlightId === edge.toolName)
          || (highlightType === 'domain' && highlightId === edge.domain)
        const edgeHot = hoverEdgeKey === key || selectedEdgeKey === key
        edgeDraw.push({
          edge: edge, key: key, route: route,
          dotColors: dotColors, speed: dotPlanForEdge(edge.count).speed,
          adjacent: adjacent, edgeHot: edgeHot,
        })
      }
      const labelCandidates = []
      for (let i = 0; i < edgeDraw.length; i += 1) {
        const item = edgeDraw[i]
        const showLabel = item.edgeHot || (highlightId ? item.adjacent : item.edge.count >= 2)
        if (!showLabel) continue
        const text = String(item.edge.count) + ' 次/min'
        labelCandidates.push({ key: item.key, x: item.route.mid.x, y: item.route.mid.y, label: text, width: text.length * 9 + 14, hasError: item.edge.errors > 0 })
      }
      const labelPositions = placeEdgeLabels(labelCandidates.map(function (item) { return { x: item.x, y: item.y, width: item.width } }))
      const labelByKey = Object.create(null)
      for (let i = 0; i < labelCandidates.length; i += 1) labelByKey[labelCandidates[i].key] = Object.assign({}, labelCandidates[i], labelPositions[i])
      const edgeElements = []
      for (let i = 0; i < edgeDraw.length; i += 1) {
        const item = edgeDraw[i]
        const edge = item.edge
        const dimmed = !item.adjacent && !item.edgeHot
        const onSelect = function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          props.onSelectEdge({ from: edge.toolName, to: edge.domain, mode: 'tool' })
        }
        const onEnter = function () { if (typeof props.onHoverEdge === 'function') props.onHoverEdge(item.key) }
        const onLeave = function () { if (typeof props.onHoverEdge === 'function') props.onHoverEdge(null) }
        const width = clamp(1 + Math.min(3, edge.count * 0.3), 1, 4)
        const color = edge.errors > 0 ? FLOW_COLORS.error : FLOW_COLORS.tool
        edgeElements.push(h('path', {
          key: 'te:' + item.key,
          className: 'da-edge-flow' + (dimmed ? ' da-edge-dim' : '') + (item.edgeHot ? ' da-edge-hot' : ''),
          d: item.route.d,
          style: {
            stroke: withAlpha(color, 0.7),
            strokeWidth: item.edgeHot ? width + 0.6 : width,
            opacity: dimmed ? 0.08 : (item.edgeHot ? 0.6 : 0.22),
            cursor: 'pointer',
          },
          onClick: onSelect,
          onMouseEnter: onEnter,
          onMouseLeave: onLeave,
        }))
        const label = labelByKey[item.key]
        if (!label) continue
        edgeElements.push(h('g', {
          key: 'tel:' + item.key,
          className: dimmed ? 'da-edge-dim' : undefined,
          style: { cursor: 'pointer' },
          onClick: onSelect,
          onMouseEnter: onEnter,
          onMouseLeave: onLeave,
        },
          h('rect', { className: 'da-edge-label-bg', x: label.x - label.width / 2, y: label.y - 8.5, width: label.width, height: 17, rx: 3.5 }),
          h('text', { className: 'da-edge-label', x: label.x, y: label.y + 4, textAnchor: 'middle' }, label.label)
        ))
      }

      const toolCards = toolLayout.map(function (node) {
        const data = node.data || {}
        const selected = !!(selection && selection.type === 'tool' && selection.id === node.name)
        const dim = !!(highlightId && !(highlightType === 'tool' && highlightId === node.name))
        const count = num(data.count)
        const topDomain = data.topDomain && DOMAIN_BY_ID[data.topDomain.domain]
          ? domainTitle(DOMAIN_BY_ID[data.topDomain.domain], zh)
          : ''
        const titleMax = toolTitleMaxChars(node.w)
        const titleText = node.name.length > titleMax ? node.name.slice(0, titleMax - 1) + '…' : node.name
        return h('g', {
          key: 'tool:' + node.name,
          className: 'da-tool-node' + (dim ? ' da-tool-dim' : ''),
          transform: 'translate(' + node.x + ' ' + node.y + ')',
          onClick: function () { props.onSelectTool(node.name) },
          role: 'button', tabIndex: 0, 'aria-label': node.name,
          onMouseEnter: function () { if (typeof props.onHover === 'function') props.onHover({ type: 'tool', id: node.name }) },
          onMouseLeave: function () { if (typeof props.onHover === 'function') props.onHover(null) },
          onKeyDown: function (event) {
            if (event && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              props.onSelectTool(node.name)
            }
          },
        },
          h('title', null, node.name + (topDomain ? ' → ' + topDomain : '') + (count > 0 ? ' · ' + count + ' 次/min' : '')),
          h('rect', { className: 'da-tool-card' + (selected ? ' da-tool-selected' : ''), x: -node.w / 2, y: -node.h / 2, width: node.w, height: node.h, rx: 8 }),
          h('circle', { cx: -node.w / 2 + 12, cy: -node.h / 2 + 10, r: 3, style: { fill: count > 0 ? FLOW_COLORS.tool : 'rgba(170,210,235,0.55)' } }),
          h('text', { className: 'da-tool-title', x: -node.w / 2 + 22, y: -node.h / 2 + 12 }, titleText),
          h('text', { className: 'da-tool-meta', x: -node.w / 2 + 12, y: node.h / 2 - 4 }, topDomain ? '→ ' + topDomain : t('toolViewTitle')),
          h('text', { className: 'da-tool-count', x: node.w / 2 - 10, y: -node.h / 2 + 12, textAnchor: 'end' }, count > 0 ? count + ' 次/min' : '0 次/min'),
        )
      })

      const targetCards = targetLayout.map(function (node) {
        const data = node.data || {}
        const status = data.status || 'idle'
        const selected = !!(selection && selection.type === 'domain' && selection.id === node.id)
        const dim = !!(highlightId && !(highlightType === 'domain' && highlightId === node.id))
        const calls = num(domainCallSum[node.id])
        const compactCounts = String(data.plugins.length) + 'p · ' + String(data.services.length) + 's · ' + String(data.tools.length) + 't'
        return h('g', {
          key: 'target:' + node.id,
          className: 'da-tool-node' + (dim ? ' da-tool-dim' : ''),
          transform: 'translate(' + node.x + ' ' + node.y + ')',
          onClick: function () { props.onSelectDomain(node.id) },
          role: 'button', tabIndex: 0, 'aria-label': domainTitle(data, zh),
          onMouseEnter: function () { if (typeof props.onHover === 'function') props.onHover({ type: 'domain', id: node.id }) },
          onMouseLeave: function () { if (typeof props.onHover === 'function') props.onHover(null) },
          onKeyDown: function (event) {
            if (event && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              props.onSelectDomain(node.id)
            }
          },
        },
          h('title', null, domainTitle(data, zh) + ' · ' + domainSubtitle(data, zh) + ' · ' + calls + ' 次/min'),
          h('rect', { className: 'da-tool-card' + (selected ? ' da-tool-selected' : ''), x: -node.w / 2, y: -node.h / 2, width: node.w, height: node.h, rx: 7 }),
          h('circle', { cx: -node.w / 2 + 13, cy: 0, r: 3.2, style: { fill: statusColorVar(status) } }),
          h('text', { className: 'da-node-title', x: -node.w / 2 + 23, y: 4, style: { fontSize: '12.5px' } }, domainTitle(data, zh)),
          h('text', { className: 'da-node-counts', x: -node.w / 2 + 196, y: 4, style: { fontSize: '9.5px' } }, compactCounts),
          h('text', { className: 'da-tool-count', x: node.w / 2 - 10, y: 4, textAnchor: 'end', style: { fontSize: '10px' } }, calls > 0 ? calls + ' 次/min' : '0 次/min'),
          selected ? h('rect', { className: 'da-tool-selected', x: -node.w / 2, y: -node.h / 2, width: node.w, height: node.h, rx: 7 }) : null
        )
      })

      return h('svg', {
        className: 'da-stage-svg',
        viewBox: props.viewBox || ('0 0 ' + VIEW_W + ' ' + VIEW_H),
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': t('viewTools'),
      },
        h('rect', { className: 'da-panel', x: 32, y: 110, width: 560, height: 500, rx: 10 }),
        h('rect', { className: 'da-panel', x: 608, y: 110, width: 600, height: 500, rx: 10 }),
        h('text', { className: 'da-panel-title', x: 48, y: 134 }, t('toolViewTitle') + ' · ' + fmtNum(toolLayout.length)),
        h('text', { className: 'da-panel-sub', x: 48, y: 150 }, t('windowTag')),
        h('g', {
          key: 'tool-edge-toggle',
          style: { cursor: 'pointer' },
          onClick: function () { setShowAllEdges(function (previous) { return !previous }) },
        },
          h('rect', { x: 392, y: 116, width: 184, height: 18, rx: 9, style: { fill: 'rgba(8,20,30,0.72)', stroke: 'rgba(120,210,245,0.32)', strokeWidth: 1 } }),
          h('text', { className: 'da-panel-back', x: 484, y: 129, textAnchor: 'middle', style: { fontSize: '10px' } }, showAllEdges ? t('showTop8Edges') : t('showAllEdges'))
        ),
        h('text', {
          className: 'da-panel-back',
          x: 576,
          y: 134,
          textAnchor: 'end',
          style: { cursor: 'pointer' },
          onClick: function () { if (typeof props.onView === 'function') props.onView('domains') },
        }, '← ' + t('viewDomains')),
        h('text', { className: 'da-panel-title', x: 628, y: 134 }, t('toolViewTargets') + ' · ' + fmtNum(targetLayout.length)),
        h('text', { className: 'da-panel-sub', x: 628, y: 150 }, t('callRoute')),
        edgeElements,
        h(FlowDots, {
          edges: edgeDraw.map(function (item) {
            return { key: item.key, route: item.route, dotColors: item.dotColors, speed: item.speed, color: FLOW_COLORS.tool }
          }),
          apiRef: props.apiRef,
          paused: props.paused,
        }),
        toolCards,
        targetCards,
        h(KernelBand, {
          t: t,
          snapshot: props.snapshot,
          selection: selection,
          onSelectDomain: props.onSelectDomain,
          nodesCount: targetLayout.length,
          edgesCount: edgeDraw.length,
        })
      )
    })

    // ---------------------------------------------------------------------
    // Canvas flow-dot engine. Direction is shown ONLY by solid dots travelling
    // from source to target along the edge curve — no arrows, no glow rings,
    // no pulses, no backdrop. One rAF loop reads mutable refs, so React never
    // re-renders per frame.
    // ---------------------------------------------------------------------

    function __removedFlowDotEngine(canvas, options) {
      const opts = options && typeof options === 'object' ? options : {}
      const viewBox = opts.viewBox && typeof opts.viewBox === 'object' ? opts.viewBox : { w: 1000, h: 1000 }
      const vbW = num(viewBox.w) > 0 ? num(viewBox.w) : 1000
      const vbH = num(viewBox.h) > 0 ? num(viewBox.h) : 1000
      let graphic = null
      let rafHandle = 0
      let disposed = false
      let paused = false
      let lastFrame = 0
      let edges = []
      let transient = []
      let eventMap = null
      let edgeIndex = Object.create(null)
      let resizeObserver = null
      let windowResizeAttached = false
      let visibilityAttached = false
      const view = { w: 0, h: 0, scale: 1, ox: 0, oy: 0, dpr: 1 }
      let frame = { x: 0, y: 0, w: vbW, h: vbH }

      function getGraphic() {
        if (graphic) return graphic
        graphic = null
        return graphic
      }

      function measure() {
        let width = 0
        let height = 0
        try {
          const rect = canvas.getBoundingClientRect()
          width = rect && rect.width ? rect.width : 0
          height = rect && rect.height ? rect.height : 0
        } catch (error) {
          width = 0
          height = 0
        }
        if ((!width || !height) && canvas.parentElement) {
          const parentRect = safe(function () { return canvas.parentElement.getBoundingClientRect() }, null)
          if (parentRect) {
            if (!width) width = parentRect.width || 0
            if (!height) height = parentRect.height || 0
          }
        }
        return { width: width, height: height }
      }

      function applySize() {
        if (disposed) return
        const box = measure()
        if (!box.width || !box.height) return
        const dpr = clamp(safe(function () {
          return typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
        }, 1), 1, 2)
        view.w = box.width
        view.h = box.height
        view.dpr = dpr
        view.scale = Math.min(box.width / vbW, box.height / vbH)
        view.ox = (box.width - vbW * view.scale) / 2
        view.oy = (box.height - vbH * view.scale) / 2
        const pixelWidth = Math.max(1, Math.round(box.width * dpr))
        const pixelHeight = Math.max(1, Math.round(box.height * dpr))
        if (canvas.width !== pixelWidth) canvas.width = pixelWidth
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight
        if (canvas.style) {
          canvas.style.width = '100%'
          canvas.style.height = '100%'
        }
      }

      function attachResize() {
        applySize()
        if (typeof ResizeObserver === 'function') {
          try {
            resizeObserver = new ResizeObserver(function () { applySize() })
            resizeObserver.observe(canvas.parentElement || canvas)
            return
          } catch (error) {
            resizeObserver = null
          }
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('resize', applySize)
          windowResizeAttached = true
        }
      }

      function detachResize() {
        if (resizeObserver) {
          try {
            resizeObserver.disconnect()
          } catch (error) {
            // ignore
          }
          resizeObserver = null
        }
        if (windowResizeAttached && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('resize', applySize)
          windowResizeAttached = false
        }
      }

      function projectX(x) {
        if (!frame.w || !frame.h) return 0
        const scale = Math.min(view.w / frame.w, view.h / frame.h)
        return (view.w - frame.w * scale) / 2 + (num(x) - frame.x) * scale
      }

      function projectY(y) {
        if (!frame.w || !frame.h) return 0
        const scale = Math.min(view.w / frame.w, view.h / frame.h)
        return (view.h - frame.h * scale) / 2 + (num(y) - frame.y) * scale
      }

      function setViewport(next) {
        if (!next || typeof next !== 'object') return
        frame = {
          x: num(next.x),
          y: num(next.y),
          w: num(next.w) > 0 ? num(next.w) : vbW,
          h: num(next.h) > 0 ? num(next.h) : vbH,
        }
        if (!paused) draw()
      }

      function pointAt(controls, t) {
        const u = 1 - t
        return {
          x: u * u * u * controls.x1 + 3 * u * u * t * controls.c1x + 3 * u * t * t * controls.c2x + t * t * t * controls.x2,
          y: u * u * u * controls.y1 + 3 * u * u * t * controls.c1y + 3 * u * t * t * controls.c2y + t * t * t * controls.y2,
        }
      }

      function setEdges(list) {
        const source = Array.isArray(list) ? list : []
        const next = []
        const index = Object.create(null)
        for (let i = 0; i < source.length; i += 1) {
          const item = source[i]
          if (!item || !Array.isArray(item.from) || !Array.isArray(item.to)) continue
          const key = String(item.key || ('e' + i))
          const controls = bezierControls(item.from[0], item.from[1], item.to[0], item.to[1], item.bend || 0)
          const plan = dotPlanForEdge(item.count)
          const previous = edgeIndex[key]
          const dots = []
          for (let d = 0; d < plan.dots; d += 1) {
            const reused = previous && previous.dots.length > 0
              ? previous.dots[d % previous.dots.length].t
              : (d + 0.5) / plan.dots
            dots.push({ t: reused })
          }
          next.push({
            key: key,
            controls: controls,
            color: typeof item.color === 'string' && item.color ? item.color : '#3ee8ff',
            speed: plan.speed,
            dots: dots,
            count: num(item.count),
          })
          index[key] = next[next.length - 1]
        }
        edges = next
        edgeIndex = index
        if (!paused) draw()
      }

      function setEventMap(map) {
        eventMap = map && typeof map === 'object' ? map : null
      }

      function push(events) {
        if (disposed || paused || !eventMap) return
        const list = Array.isArray(events) ? events : []
        for (let i = 0; i < list.length; i += 1) {
          const event = list[i]
          if (!event || typeof event !== 'object') continue
          const from = typeof event.organ === 'string' ? event.organ : ''
          const to = typeof event.target === 'string' ? event.target : ''
          if (!from || !to || !eventMap[from] || !eventMap[to]) continue
          const edge = edgeIndex[from + '>' + to]
          if (!edge) continue
          transient.push({ edge: edge, t: 0, life: 0 })
          if (transient.length > 60) transient.shift()
        }
      }

      function update(deltaMs) {
        const factor = clamp(deltaMs, 0, 64) / 16.6667
        for (let i = 0; i < edges.length; i += 1) {
          const edge = edges[i]
          for (let d = 0; d < edge.dots.length; d += 1) {
            const dot = edge.dots[d]
            dot.t += edge.speed * factor
            if (dot.t > 1) dot.t -= 1
          }
        }
        for (let i = transient.length - 1; i >= 0; i -= 1) {
          const item = transient[i]
          item.t += 0.03 * factor
          item.life += deltaMs
          if (item.t > 1 || item.life > 1100) transient.splice(i, 1)
        }
      }

      function draw() {
        if (disposed) return
        const g = getGraphic()
        if (!g || !view.w || !view.h) return
        g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
        g.clearRect(0, 0, view.w, view.h)
        g.globalCompositeOperation = 'source-over'
        for (let i = 0; i < edges.length; i += 1) {
          const edge = edges[i]
          g.fillStyle = edge.color
          for (let d = 0; d < edge.dots.length; d += 1) {
            const point = pointAt(edge.controls, edge.dots[d].t)
            const x = projectX(point.x)
            const y = projectY(point.y)
            g.globalAlpha = 0.9
            g.beginPath()
            g.arc(x, y, 2.2, 0, Math.PI * 2)
            g.fill()
          }
        }
        for (let i = 0; i < transient.length; i += 1) {
          const item = transient[i]
          const point = pointAt(item.edge.controls, item.t)
          const x = projectX(point.x)
          const y = projectY(point.y)
          const fade = clamp(1 - item.life / 1100, 0, 1)
          g.globalAlpha = fade
          g.fillStyle = '#f2ffff'
          g.beginPath()
          g.arc(x, y, 3.4, 0, Math.PI * 2)
          g.fill()
        }
        g.globalAlpha = 1
      }

      function tick(now) {
        rafHandle = 0
        if (disposed || paused) return
        const stamp = typeof now === 'number' ? now : Date.now()
        const delta = lastFrame > 0 ? Math.min(80, stamp - lastFrame) : 16.6667
        lastFrame = stamp
        update(delta)
        draw()
        rafHandle = rafSchedule(tick)
      }

      function startLoop() {
        if (disposed || paused || rafHandle) return
        lastFrame = 0
        rafHandle = rafSchedule(tick)
      }

      function stopLoop() {
        if (!rafHandle) return
        rafCancel(rafHandle)
        rafHandle = 0
      }

      function onVisibility() {
        const hidden = safe(function () { return typeof document !== 'undefined' && document.hidden === true }, false)
        if (hidden) stopLoop()
        else if (!paused) startLoop()
      }

      function setPaused(next) {
        paused = next === true
        if (paused) stopLoop()
        else startLoop()
      }

      attachResize()
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibility)
        visibilityAttached = true
      }
      startLoop()

      return {
        setEdges: setEdges,
        setEventMap: setEventMap,
        setViewport: setViewport,
        push: push,
        setPaused: setPaused,
        refreshTheme: function refreshTheme() {
          // Dots are coloured per edge; nothing theme-derived to refresh.
        },
        resize: function resize() {
          applySize()
          if (!paused) draw()
        },
        dispose: function dispose() {
          if (disposed) return
          disposed = true
          stopLoop()
          detachResize()
          if (visibilityAttached && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
            visibilityAttached = false
          }
          edges = []
          transient = []
          edgeIndex = Object.create(null)
          graphic = null
        },
      }
    }

    function ParticleLayer(props) {
      // v6: the dot layer is SVG-only (FlowDots); this canvas layer is retired.
      return null
    }

    /** Header view toggle: domain map ↔ tool-call graph. */
    function ViewSwitch(props) {
      const t = props.t
      return h('div', { className: 'da-viewswitch', role: 'group', 'aria-label': t('viewSwitch') },
        h('button', {
          type: 'button',
          className: 'da-viewswitch-btn' + (props.view === 'domains' ? ' da-on' : ''),
          onClick: function () { props.onView('domains') },
          'aria-pressed': props.view === 'domains',
        }, t('viewDomains')),
        h('button', {
          type: 'button',
          className: 'da-viewswitch-btn' + (props.view === 'tools' ? ' da-on' : ''),
          onClick: function () { props.onView('tools') },
          'aria-pressed': props.view === 'tools',
        }, t('viewTools'))
      )
    }

    /** Canvas legend: a single collapsed toggle by default (less clutter). */
    function DiagramLegend(props) {
      const t = props.t
      const [open, setOpen] = React.useState(false)
      if (!open) {
        return h('button', {
          type: 'button', className: 'da-legend-toggle', 'aria-expanded': false,
          onClick: function () { setOpen(true) },
          onWheel: function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
        }, t('legendTitle') + ' ⓘ')
      }
      const rows = [
        ['da-legend-swatch', t('legendDomain')],
        ['da-legend-line', t('legendEdge')],
        ['da-legend-line', t('legendEdgeLabel')],
        ['da-legend-dot', t('legendDot')],
        ['da-legend-band', t('legendKernel')],
      ]
      const colorRows = [
        [FLOW_COLORS.llm, t('colorLlm')],
        [FLOW_COLORS.tool, t('colorTool')],
        [FLOW_COLORS.session, t('colorSession')],
        [FLOW_COLORS.fs, t('colorFs')],
        [FLOW_COLORS.approval, t('colorApproval')],
        [FLOW_COLORS.error, t('colorError')],
        [FLOW_COLORS.plugin, t('colorPlugin')],
      ]
      return h('div', {
        className: 'da-legend',
        onWheel: function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
      },
        h('div', { className: 'da-legend-head' },
          h('span', { className: 'da-legend-title' }, t('legendTitle')),
          h('button', {
            type: 'button', className: 'da-legend-close',
            onClick: function () { setOpen(false) },
            title: t('legendHide'), 'aria-label': t('legendHide'),
          }, '×')
        ),
        rows.map(function (row, index) {
          return h('div', { key: 'legend:' + index, className: 'da-legend-row' },
            h('span', { className: row[0] }),
            h('span', null, row[1])
          )
        }),
        h('div', { className: 'da-legend-sep' }),
        colorRows.map(function (row, index) {
          return h('div', { key: 'legend-color:' + index, className: 'da-legend-row' },
            h('span', { className: 'da-legend-dot', style: { background: row[0], boxShadow: 'none' } }),
            h('span', null, row[1])
          )
        })
      )
    }

    /** Canvas corner panel: last-120s call breakdown, hover/selection only. */
    function CallDetailPanel(props) {
      const t = props.t
      if (!props.visible) return null
      const rows = Array.isArray(props.rows) ? props.rows : []
      return h('div', {
        className: 'da-calldetail',
        onWheel: function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
      },
        h('div', { className: 'da-calldetail-title' },
          h('span', null, props.title || t('callDetailTitle')),
          h('span', null, fmtNum(props.total || 0) + ' ' + t('callsUnit'))
        ),
        rows.length === 0
          ? h('div', { className: 'da-calldetail-empty' }, t('callDetailEmpty'))
          : rows.map(function (row, index) {
            return h('div', { key: 'cd:' + index, className: 'da-calldetail-row' },
              h('span', { className: 'da-calldetail-name', title: row.label }, String(row.label)),
              h('span', { className: 'da-calltarget' }, row.kind ? kindGroup(row.kind) : ''),
              h('span', { className: 'da-calldetail-count' }, String(row.count))
            )
          })
      )
    }

    /** Interaction help dialog (opened by the header ? button, Esc closes). */
    function HelpOverlay(props) {
      const t = props.t
      if (!props.open) return null
      const items = [
        [t('viewSwitch'), t('helpView')],
        [t('detail'), t('helpClick')],
        [t('activity'), t('helpHover')],
        [t('pause'), t('helpPause')],
      ]
      return h('div', {
        className: 'da-help-backdrop',
        onWheel: function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
        onClick: function (event) {
          if (event && event.target === event.currentTarget && typeof props.onClose === 'function') props.onClose()
        },
      },
        h('div', { className: 'da-help', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('helpTitle') },
          h('div', { className: 'da-help-head' },
            h('span', { className: 'da-help-title' }, t('helpTitle')),
            h('button', { type: 'button', className: 'da-btn', onClick: props.onClose }, t('helpClose'))
          ),
          h('div', { className: 'da-help-list' }, items.map(function (item, index) {
            return h('div', { key: 'help:' + index, className: 'da-help-item' },
              h('b', null, item[0]),
              h('span', null, item[1])
            )
          }))
        )
      )
    }

    function Stage(props) {
      const t = props.t
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const toolNodes = Array.isArray(props.toolNodes) ? props.toolNodes : []
      const flows = props.flows && typeof props.flows === 'object' ? props.flows : { pairs: {}, nodes: {} }
      const view = props.view === 'tools' ? 'tools' : 'domains'
      const activeLinks = view === 'tools'
        ? toolNodes.reduce(function (sum, tool) {
          const edges = tool && Array.isArray(tool.edges) ? tool.edges : []
          let visible = 0
          for (let i = 0; i < edges.length; i += 1) if (num(edges[i].count) > 0) visible += 1
          return sum + visible
        }, 0)
        : Object.keys(flows.pairs || {}).length
      const callRows = Array.isArray(props.callRows) ? props.callRows : []
      const hoverEdgeKey = props.hoverEdge && props.hoverEdge.key ? props.hoverEdge.key : ''
      const [zoom, setZoom] = React.useState(1)
      const [center, setCenter] = React.useState({ x: VIEW_W / 2, y: VIEW_H / 2 })
      const viewBox = zoomViewBox(zoom, center.x, center.y)
      const setZoomLevel = function (next) {
        setZoom(clamp(num(next) || 1, MIN_ZOOM, MAX_ZOOM))
      }
      const zoomBy = function (factor, anchor) {
        const next = zoomAtAnchor(zoom, center, anchor || center, factor)
        setZoom(next.zoom)
        setCenter(next.center)
      }
      const resetView = function () {
        setZoom(1)
        setCenter({ x: VIEW_W / 2, y: VIEW_H / 2 })
      }
      const focusSelected = function () {
        const point = focusPoint(props.selection, view, nodes, toolNodes)
        if (!point) {
          resetView()
          return
        }
        setCenter(clampViewCenter(2, point.x, point.y))
        setZoom(2)
      }
      const onWheel = function (event) {
        if (!event || typeof event.preventDefault !== 'function') return
        if (shouldIgnoreStageWheel(event.target, stageRef.current)) return
        event.preventDefault()
        const stage = stageRef.current
        if (!stage || typeof stage.getBoundingClientRect !== 'function') {
          zoomBy(event.deltaY > 0 ? 1 / 1.12 : 1.12)
          return
        }
        const rect = stage.getBoundingClientRect()
        const frame = zoomFrame(zoom, center.x, center.y)
        const point = screenToViewPoint(rect, frame, event.clientX, event.clientY)
        zoomBy(event.deltaY > 0 ? 1 / 1.12 : 1.12, point)
      }
      const onKeyDown = function (event) {
        if (!event || !event.key) return
        const target = event.target
        const tag = target && target.tagName ? String(target.tagName).toUpperCase() : ''
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return
        if (event.key === '+' || event.key === '=') {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          zoomBy(1.12)
        } else if (event.key === '-' || event.key === '_') {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          zoomBy(1 / 1.12)
        } else if (event.key === '0') {
          if (typeof event.preventDefault === 'function') event.preventDefault()
          resetView()
        }
      }
      let svg = null
      if (view === 'tools') {
        svg = h(ToolViewSvg, {
          t: t, zh: props.zh, nodes: nodes, toolNodes: toolNodes, snapshot: props.snapshot,
          heat: props.heat, selection: props.selection, hover: props.hover, viewBox: viewBox,
          hoverEdgeKey: hoverEdgeKey, apiRef: props.apiRef, paused: props.paused,
          onSelectTool: props.onSelectTool, onSelectDomain: props.onSelectDomain, onHover: props.onHover,
          onView: props.onView, onSelectEdge: props.onSelectEdge, onHoverEdge: props.onHoverEdge,
        })
      } else {
        svg = h(ArchitectureSvg, {
          t: t, zh: props.zh, nodes: nodes, heat: props.heat, flows: flows,
          selection: props.selection, snapshot: props.snapshot, viewBox: viewBox,
          hoverId: props.hover && props.hover.type === 'domain' ? props.hover.id : null,
          hoverEdgeKey: hoverEdgeKey, apiRef: props.apiRef, paused: props.paused,
          onSelectDomain: props.onSelectDomain, onHoverDomain: props.onHoverDomain,
          onSelectEdge: props.onSelectEdge, onHoverEdge: props.onHoverEdge,
        })
      }
      const emptyTraffic = !!props.snapshot && activeLinks === 0
      const [nowTick, setNowTick] = React.useState(function () { return Date.now() })
      React.useEffect(function statusClock() {
        const timer = setInterval(function () { setNowTick(Date.now()) }, 1000)
        return function () { clearInterval(timer) }
      }, [])
      const status = deriveRuntimeStatus({
        snapshot: props.snapshot,
        paused: props.paused,
        conn: props.conn,
        lastEventAt: props.lastEventAt,
        now: nowTick,
      })
      const lastEventLabel = formatLastEventLabel(props.lastEventAt, nowTick, t)
      React.useEffect(function stageReadySignal() {
        if (typeof props.onStageReady === 'function') props.onStageReady()
      }, [])
      const stageRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const movedRef = React.useRef(false)
      const [dragging, setDragging] = React.useState(false)
      const onPointerDown = function (event) {
        if (!event || (event.button !== undefined && event.button !== 0)) return
        const target = event.target
        if (target && typeof target.closest === 'function' && target.closest('button, .da-zoomctl, .da-legend, .da-calldetail, .da-empty-traffic')) return
        if (!stageRef.current) return
        if (typeof stageRef.current.focus === 'function') {
          try { stageRef.current.focus({ preventScroll: true }) } catch (error) { /* ignore */ }
        }
        const frame = zoomFrame(zoom, center.x, center.y)
        dragRef.current = {
          id: event.pointerId,
          startX: num(event.clientX),
          startY: num(event.clientY),
          frameX: frame.x,
          frameY: frame.y,
          frameW: frame.w,
          frameH: frame.h,
          moved: false,
        }
        movedRef.current = false
      }
      const onPointerMove = function (event) {
        const drag = dragRef.current
        if (!drag || !stageRef.current) return
        const dx = num(event.clientX) - drag.startX
        const dy = num(event.clientY) - drag.startY
        if (!drag.moved) {
          if (Math.sqrt(dx * dx + dy * dy) < 4) return
          drag.moved = true
          setDragging(true)
          if (typeof stageRef.current.setPointerCapture === 'function' && drag.id !== undefined) {
            try { stageRef.current.setPointerCapture(drag.id) } catch (error) { /* ignore */ }
          }
        }
        const rect = typeof stageRef.current.getBoundingClientRect === 'function'
          ? stageRef.current.getBoundingClientRect()
          : null
        const scaleX = rect && drag.frameW ? rect.width / drag.frameW : 1
        const scaleY = rect && drag.frameH ? rect.height / drag.frameH : 1
        const scale = Math.min(scaleX, scaleY) || 1
        const nextX = clamp(drag.frameX - dx / scale, 0, VIEW_W - drag.frameW)
        const nextY = clamp(drag.frameY - dy / scale, 0, VIEW_H - drag.frameH)
        const clamped = clampViewCenter(zoom, nextX + drag.frameW / 2, nextY + drag.frameH / 2)
        setCenter(clamped)
      }
      const endPointer = function (event) {
        const drag = dragRef.current
        dragRef.current = null
        if (drag && drag.moved) {
          movedRef.current = true
          setTimeout(function () { movedRef.current = false }, 0)
        }
        setDragging(false)
        if (drag && drag.id !== undefined && stageRef.current && typeof stageRef.current.releasePointerCapture === 'function') {
          try { stageRef.current.releasePointerCapture(drag.id) } catch (error) { /* ignore */ }
        }
        if (event && event.type === 'pointerleave' && drag && drag.moved) {
          // keep final position; nothing else to do
        }
      }
      const onClickCapture = function (event) {
        if (!movedRef.current) return
        movedRef.current = false
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      }
      /**
       * Clicking empty stage space clears the selection (the drawer returns to
       * the overview). Clicks on nodes, edges, zoom/legend controls and the
       * call-detail overlay keep their own behaviour; a drag is never a clear.
       */
      const onStageClick = function (event) {
        if (!event || movedRef.current) return
        const target = event.target
        if (target && typeof target.closest === 'function'
          && target.closest('.da-node, .da-tool-node, .da-edge-flow, .da-edge-label, .da-edge-label-bg, .da-zoomctl, .da-legend, .da-calldetail, .da-empty-traffic, .da-stage-hud, .da-paused-tag, .da-empty-overlay')) return
        if (typeof props.onClearSelection === 'function') props.onClearSelection()
      }
      return h('div', { className: 'da-stage-wrap' },
        h('div', {
          className: 'da-stage' + (props.paused ? ' da-paused' : '') + (dragging ? ' da-dragging' : ''),
          ref: stageRef,
          tabIndex: 0,
          onWheel: onWheel,
          onClick: onStageClick,
          onKeyDown: onKeyDown,
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: endPointer,
          onPointerCancel: endPointer,
          onPointerLeave: endPointer,
        },
          h('div', { className: 'da-stage-grid' }),
          h('div', { className: 'da-stage-svgwrap', onClickCapture: onClickCapture }, svg),
          h('div', { className: 'da-stage-hud da-hud-tl' },
            h('div', { className: 'da-hud-strong' }, t('stageLiveTag')),
            h('div', null, view === 'tools'
              ? t('viewTools') + ' · ' + String(toolNodes.length) + ' ' + t('tools')
              : String(LAYER_ORDER.length) + ' ' + t('layersUnit') + ' · ' + String(nodes.length) + ' ' + t('nodesUnit'))
          ),
          h('div', { className: 'da-stage-hud da-hud-tr' },
            h('div', { className: 'da-status-pill da-status-' + status.key },
              h('span', { className: 'da-status-dot' }),
              h('span', null, t(status.labelKey))
            ),
            h('div', { className: 'da-hud-line' },
              fmtNum(props.eventCount || 0) + ' ' + t('hudRecent') + ' · ' + fmtNum(activeLinks) + ' ' + t('hudLinks')),
            h('div', { className: 'da-hud-line' },
              t('statusLastEvent') + '：' + lastEventLabel),
            (() => {
              const measured = formatPaintTimings(props.firstFrameMs, props.detailMs, t)
              const text = measured && num(props.detailMs) <= 0
                ? measured + ' · ' + t('detailPaintPending')
                : (measured || t('firstPaintPending'))
              return h('div', { className: 'da-hud-timing' }, text)
            })(),
            props.snapshotLite
              ? h('div', { className: 'da-hud-hint' }, t('statusLoadingDetails'))
              : (emptyTraffic
                ? h('div', { className: 'da-hud-hint' }, t('emptyTraffic'))
                : h('div', { className: 'da-hud-hint' }, t('liveFlowTag')))
          ),
          h('div', { className: 'da-zoomctl', role: 'group', 'aria-label': t('zoomLabel') },
            h('div', { className: 'da-zoom-pct', title: t('zoomLabel') }, Math.round(zoom * 100) + '%'),
            h('button', { type: 'button', className: 'da-zoom-btn', onClick: function () { zoomBy(1 / 1.12) }, title: t('zoomOut'), 'aria-label': t('zoomOut') }, '−'),
            h('button', { type: 'button', className: 'da-zoom-btn', onClick: resetView, title: t('zoomReset'), 'aria-label': t('zoomReset') }, '1:1'),
            h('button', { type: 'button', className: 'da-zoom-btn', onClick: function () { zoomBy(1.12) }, title: t('zoomIn'), 'aria-label': t('zoomIn') }, '＋'),
            h('button', {
              type: 'button', className: 'da-zoom-btn da-zoom-fit', onClick: focusSelected,
              title: t('zoomFocus'), 'aria-label': t('zoomFocus'),
            }, t('zoomFocusShort'))
          ),
          h(DiagramLegend, { t: t }),
          h(CallDetailPanel, { t: t, visible: !!props.callActive, rows: callRows, title: props.callTitle, total: props.callTotal }),
          props.paused ? h('div', { className: 'da-paused-tag' }, t('paused')) : null,
          !props.snapshot ? h('div', { className: 'da-empty-overlay' },
            h('span', { className: 'da-spin' }),
            h('span', null, t('connectingDataStream'))
          ) : null
        )
      )
    }
    // ---------------------------------------------------------------------
    // Right drawer: runtime overview + domain/component/event details.
    // ---------------------------------------------------------------------

    const PHASE_STATUS = { active: 'active', inactive: 'idle', pending: 'warn', unloading: 'warn', failed: 'error' }

    function phaseStatus(phase) {
      if (typeof phase !== 'string') return 'idle'
      return PHASE_STATUS[phase] || 'idle'
    }

    function findPlugin(snapshot, key) {
      const list = snapshot && Array.isArray(snapshot.plugins) ? snapshot.plugins : []
      for (let i = 0; i < list.length; i += 1) {
        const plugin = list[i]
        if (plugin && (plugin.entryId === key || plugin.name === key || plugin.title === key)) return plugin
      }
      return null
    }

    function findService(snapshot, key) {
      const list = snapshot && Array.isArray(snapshot.services) ? snapshot.services : []
      for (let i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].name === key) return list[i]
      }
      return null
    }

    function findTool(snapshot, key) {
      const list = snapshot && Array.isArray(snapshot.tools) ? snapshot.tools : []
      for (let i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].name === key) return list[i]
      }
      return null
    }

    function findClientBundle(snapshot, key) {
      const list = snapshot && Array.isArray(snapshot.clientBundles) ? snapshot.clientBundles : []
      for (let i = 0; i < list.length; i += 1) {
        if (list[i] && (list[i].id === key || list[i].title === key)) return list[i]
      }
      return null
    }

    function findModel(snapshot, key) {
      const models = snapshot && snapshot.models && typeof snapshot.models === 'object' ? snapshot.models : null
      const list = models && Array.isArray(models.models) ? models.models : []
      for (let i = 0; i < list.length; i += 1) {
        const model = list[i]
        if (model && String(model.provider) + '/' + String(model.id) === key) return model
      }
      return null
    }

    function findEvent(events, id) {
      const list = Array.isArray(events) ? events : []
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i] && String(list[i].id) === String(id)) return list[i]
      }
      return null
    }

    function collectEvents(events, predicate, limit) {
      const out = []
      const list = Array.isArray(events) ? events : []
      const cap = clamp(limit || 12, 1, 60)
      for (let i = list.length - 1; i >= 0 && out.length < cap; i -= 1) {
        try {
          if (predicate(list[i])) out.push(list[i])
        } catch (error) {
          // ignore a malformed event
        }
      }
      return out
    }

    /** Weighted average tool latency from the live per-tool metrics map. */
    function averageLatency(toolMetrics) {
      const map = toolMetrics && typeof toolMetrics === 'object' ? toolMetrics : {}
      let totalCalls = 0
      let totalMs = 0
      const keys = Object.keys(map)
      for (let i = 0; i < keys.length; i += 1) {
        const row = map[keys[i]]
        if (!row) continue
        const calls = num(row.calls)
        totalCalls += calls
        totalMs += num(row.avgMs) * calls
      }
      return totalCalls > 0 ? totalMs / totalCalls : 0
    }

    function RecentEvents(props) {
      const t = props.t
      const rows = Array.isArray(props.events) ? props.events : []
      if (rows.length === 0) return h(Empty, { text: props.emptyText || t('recentEventsNone') })
      return h('div', { className: 'da-recent' }, rows.map(function (event) {
        if (!event || typeof event !== 'object') return null
        const ok = event.ok !== false && event.level !== 'error'
        return h('button', {
          key: 'ev' + String(event.id) + ':' + String(event.t),
          type: 'button', className: 'da-recent-row',
          onClick: function () { props.onSelectEvent(event.id) },
          title: fmtClock(event.t) + ' · ' + String(event.kind || '') + ' · ' + String(event.label || ''),
        },
          h('span', { className: 'da-recent-time' }, fmtRel(event.t, t)),
          h(KindChip, { kind: event.kind }),
          h('span', { className: 'da-recent-label' }, String(event.label || event.kind || '')),
          h('span', {
            className: 'da-dot-sm',
            style: { color: ok ? 'var(--dsw-alias-state-success-primary, #3ddc97)' : 'var(--dsw-alias-state-error-primary, #ff5f6d)' },
          })
        )
      }))
    }

    function DiagRow(props) {
      const value = props.value === undefined || props.value === null || props.value === '' ? '—' : String(props.value)
      return h('div', { className: 'da-diag-row' },
        h('span', { className: 'da-diag-key' }, props.label),
        h('span', {
          className: 'da-diag-val',
          style: props.isError && props.value ? { color: 'var(--dsw-alias-state-error-primary, #ff5f6d)' } : undefined,
          title: value,
        }, value)
      )
    }

    function RuntimeOverview(props) {
      const t = props.t
      const zh = props.zh
      const live = props.live && typeof props.live === 'object' ? props.live : {}
      const snapshot = props.snapshot
      const runtime = snapshot && snapshot.runtime && typeof snapshot.runtime === 'object' ? snapshot.runtime : null
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const flows = props.flows && typeof props.flows === 'object' ? props.flows : { pairs: {}, nodes: {} }
      const flowNodes = flows.nodes && typeof flows.nodes === 'object' ? flows.nodes : {}
      const heat = props.heat && typeof props.heat === 'object' ? props.heat : {}
      const diag = props.diag && typeof props.diag === 'object' ? props.diag : null
      const latency = averageLatency(props.toolMetrics)
      const topDomains = nodes.slice().sort(function (a, b) {
        const aRate = num(flowNodes[a.id])
        const bRate = num(flowNodes[b.id])
        if (bRate !== aRate) return bRate - aRate
        return nodeActivity(b, heat, flowNodes) - nodeActivity(a, heat, flowNodes)
      }).slice(0, 5)
      const maxActivity = topDomains.reduce(function (max, node) {
        return Math.max(max, nodeActivity(node, heat, flowNodes))
      }, 0) || 1
      return h('div', { className: 'da-overview' },
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('overview') }),
          h('div', { className: 'da-stat-grid' },
            h(Stat, { value: fmtNum(live.eventsPerSec), label: t('eventsPerSec') }),
            h(Stat, { value: fmtNum(live.toolCallsPerMin), label: t('toolCallsPerMin'), accent: 'var(--da-cyan)' }),
            h(Stat, { value: fmtNum(live.llmCallsPerMin), label: t('llmCallsPerMin'), accent: '#ff8b93' }),
            h(Stat, { value: fmtNum(num(live.tokensPerMin) / 60), label: t('tokensPerMin'), accent: 'var(--da-violet)' }),
            h(Stat, { value: fmtNum(live.errorsPerMin), label: t('errorsPerMin'), accent: num(live.errorsPerMin) > 0 ? 'var(--dsw-alias-state-error-primary, #ff5f6d)' : undefined }),
            h(Stat, { value: fmtMs(latency), label: t('avgMs') })
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('topDomains') }),
          h('div', { className: 'da-list' }, topDomains.map(function (node) {
            const activity = nodeActivity(node, heat, flowNodes)
            const rate = num(flowNodes[node.id])
            return h('button', {
              key: 'top:' + node.id, type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelect({ type: 'domain', id: node.id }) },
            },
              h(StatusDot, { status: node.status || 'idle', size: 6 }),
              h('span', { className: 'da-name' }, domainTitle(node, zh)),
              h('span', { className: 'da-rank-track' }, h(ActivityBar, { value: activity / maxActivity, color: statusColorVar(node.status || 'idle') })),
              h('span', { className: 'da-mono', style: { flex: 'none', fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } },
                rate > 0 ? rate + ' 次/min' : fmtNum(node.metrics ? node.metrics.eventsPerMin : 0))
            )
          }))
        ),
        runtime ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('runtime') }),
          h(Field, { label: t('version'), value: runtime.dshVersion || 'unknown' }),
          h(Field, { label: t('node'), value: runtime.node }),
          h(Field, { label: t('platform'), value: runtime.platform }),
          h(Field, { label: t('profile'), value: runtime.profile || t('none') }),
          h(Field, { label: t('pid'), value: runtime.pid }),
          h(Field, { label: t('uptime'), value: fmtUptime(runtime.uptimeSec) }),
          h(Field, { label: t('origin'), value: runtime.origin || t('none') }),
          h(Field, { label: t('startedAt'), value: fmtClock(runtime.startedAt) })
        ) : null,
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('diagTitle') }),
          h(DiagRow, { label: t('diagBase'), value: diag && diag.base }),
          h(DiagRow, { label: t('diagTransport'), value: diag && diag.transport }),
          h(DiagRow, { label: t('diagFrames'), value: diag ? String(fmtNum(diag.frames)) + ' · ' + t('diagPolls') + ' ' + String(fmtNum(diag.polls)) : null }),
          h(DiagRow, { label: t('diagState'), value: diag && diag.state }),
          h(DiagRow, { label: t('diagTheme'), value: props.isDark === true ? 'dark' : (props.isDark === false ? 'light' : null) }),
          diag ? h(DiagRow, { label: t('diagError'), value: diag.lastError, isError: true }) : null
        )
      )
    }

    function DomainDetail(props) {
      const t = props.t
      const zh = props.zh
      const node = props.node
      if (!node) return h(Empty, { text: t('noData') })
      const metrics = props.liveMetrics && typeof props.liveMetrics === 'object'
        ? props.liveMetrics
        : (node.metrics && typeof node.metrics === 'object' ? node.metrics : {})
      const plugins = Array.isArray(node.plugins) ? node.plugins : []
      const services = Array.isArray(node.services) ? node.services : []
      const tools = Array.isArray(node.tools) ? node.tools : []
      const recent = collectEvents(props.events, function (event) {
        return event && (event.organ === node.id || event.target === node.id)
      }, 12)
      const neighbors = computeDomainNeighbors(props.flows, node.id)
      const topSources = computeDomainCallDetail(props.events, node.id, FLOW_WINDOW_MS, 5)
      const selection = props.selection
      const pluginRows = plugins.map(function (entryId) {
        const plugin = findPlugin(props.snapshot, entryId)
        const phase = plugin && plugin.fiberPhase ? plugin.fiberPhase : null
        const selected = !!(selection && selection.type === 'plugin' && selection.id === entryId)
        return h('button', {
          key: 'p:' + entryId, type: 'button', className: 'da-list-row' + (selected ? ' da-selected' : ''),
          onClick: function () { props.onSelect({ type: 'plugin', id: entryId }) }, title: entryId,
        },
          h(StatusDot, { status: phaseStatus(phase), size: 6 }),
          h('span', { className: 'da-name' }, String(plugin ? plugin.title || plugin.name || entryId : entryId)),
          phase ? h('span', { className: 'da-chip', style: { color: 'var(--dsw-alias-label-secondary)' }, title: String(phase) }, localizedPhase(phase, t)) : null
        )
      })
      const serviceRows = services.map(function (name) {
        const service = findService(props.snapshot, name)
        const selected = !!(selection && selection.type === 'service' && selection.id === name)
        return h('button', {
          key: 's:' + name, type: 'button', className: 'da-list-row' + (selected ? ' da-selected' : ''),
          onClick: function () { props.onSelect({ type: 'service', id: name }) },
          title: service && service.provider ? name + ' · ' + service.provider : name,
        },
          h(StatusDot, { status: service && service.active === false ? 'idle' : 'active', size: 6 }),
          h('span', { className: 'da-name' }, name)
        )
      })
      const toolRows = tools.map(function (name) {
        const tool = findTool(props.snapshot, name)
        const selected = !!(selection && selection.type === 'tool' && selection.id === name)
        return h('button', {
          key: 't:' + name, type: 'button', className: 'da-list-row' + (selected ? ' da-selected' : ''),
          onClick: function () { props.onSelect({ type: 'tool', id: name }) }, title: name,
        },
          h('span', { className: 'da-name' }, name),
          h('span', { className: 'da-mono', style: { flex: 'none', fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } },
            fmtNum(tool ? tool.calls : 0) + ' / ' + fmtMs(tool ? tool.avgMs : 0))
        )
      })
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h('span', { style: { color: statusColorVar(node.status || 'idle') } }, h(DomainGlyph, { layer: node.layer, size: 20 })),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title' }, domainTitle(node, zh)),
            h('div', { className: 'da-domain-en' }, node.en + ' · ' + node.layer)
          ),
          h('span', { className: 'da-spacer' }),
          h(Chip, { label: t(statusLabelKey(node.status || 'idle')), color: statusColorVar(node.status || 'idle') })
        ),
        h('div', { className: 'da-desc' }, domainDesc(node, zh)),
        node.agents > 0 ? h('div', { className: 'da-desc', style: { marginTop: '4px' } }, t('agents') + ' · ' + String(node.agents)) : null,
        h('div', { className: 'da-section', style: { marginTop: '12px' } },
          h(SectionTitle, { title: t('metrics') }),
          h('div', { className: 'da-stat-grid' },
            h(Stat, { value: fmtNum(metrics.eventsPerMin), label: t('eventsPerMin') }),
            h(Stat, { value: fmtNum(metrics.errorsPerMin), label: t('errorsPerMin'), accent: num(metrics.errorsPerMin) > 0 ? 'var(--dsw-alias-state-error-primary, #ff5f6d)' : undefined }),
            h(Stat, { value: fmtNum(metrics.callsPerMin), label: t('callsPerMin'), accent: 'var(--da-violet)' }),
            h(Stat, { value: fmtMs(metrics.avgMs), label: t('avgMs') })
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('composition'), extra: plugins.length + services.length + tools.length }),
          plugins.length > 0 ? h('div', { className: 'da-section-title', style: { marginTop: '4px' } }, h('span', null, t('plugins') + ' · ' + plugins.length)) : null,
          h('div', { className: 'da-list' }, pluginRows),
          services.length > 0 ? h('div', { className: 'da-section-title', style: { marginTop: '8px' } }, h('span', null, t('services') + ' · ' + services.length)) : null,
          h('div', { className: 'da-list' }, serviceRows),
          tools.length > 0 ? h('div', { className: 'da-section-title', style: { marginTop: '8px' } }, h('span', null, t('tools') + ' · ' + tools.length)) : null,
          h('div', { className: 'da-list' }, toolRows)
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('upstreamDownstream') }),
          h('div', { className: 'da-neighbor-title' }, t('downstream') + ' · ' + neighbors.downstream.length),
          neighbors.downstream.length === 0
            ? h('div', { className: 'da-desc', style: { margin: '0 0 6px' } }, t('noDownstream'))
            : h('div', { className: 'da-list' }, neighbors.downstream.slice(0, 8).map(function (row) {
              const def = DOMAIN_BY_ID[row.id]
              return h('button', {
                key: 'down:' + row.id, type: 'button', className: 'da-list-row',
                onClick: function () { props.onSelect({ type: 'domain', id: row.id }) },
                title: row.id,
              },
                h('span', { className: 'da-dot-sm', style: { color: 'var(--da-cyan)' } }),
                h('span', { className: 'da-name' }, def ? domainTitle(def, zh) : String(row.id)),
                h('span', { className: 'da-mono', style: { flex: 'none', fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } }, String(row.count) + '/120s')
              )
            })),
          h('div', { className: 'da-neighbor-title' }, t('upstream') + ' · ' + neighbors.upstream.length),
          neighbors.upstream.length === 0
            ? h('div', { className: 'da-desc', style: { margin: '0' } }, t('noUpstream'))
            : h('div', { className: 'da-list' }, neighbors.upstream.slice(0, 8).map(function (row) {
              const def = DOMAIN_BY_ID[row.id]
              return h('button', {
                key: 'up:' + row.id, type: 'button', className: 'da-list-row',
                onClick: function () { props.onSelect({ type: 'domain', id: row.id }) },
                title: row.id,
              },
                h('span', { className: 'da-dot-sm', style: { color: 'var(--da-violet)' } }),
                h('span', { className: 'da-name' }, def ? domainTitle(def, zh) : String(row.id)),
                h('span', { className: 'da-mono', style: { flex: 'none', fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } }, String(row.count) + '/120s')
              )
            }))
        ),
        topSources.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('topSources'), extra: topSources.length }),
          h('div', { className: 'da-list' }, topSources.map(function (row, index) {
            return h('div', { key: 'src:' + index, className: 'da-kv' },
              h('span', { className: 'da-kv-k', title: row.label }, String(row.label)),
              h('span', { className: 'da-kv-v' }, String(row.count))
            )
          }))
        ) : null,
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedEvents'), extra: recent.length }),
          h(RecentEvents, { t: t, events: recent, onSelectEvent: props.onSelectEvent })
        )
      )
    }

    function PluginDetail(props) {
      const t = props.t
      const zh = props.zh
      const plugin = props.plugin
      if (!plugin) return h(Empty, { text: t('noData') })
      const domainLabel = plugin.organ
        ? (DOMAIN_BY_ID[plugin.organ] ? domainTitle(DOMAIN_BY_ID[plugin.organ], zh) : String(plugin.organ))
        : t('none')
      const related = collectEvents(props.events, function (event) {
        if (!event) return false
        const label = String(event.label || '')
        const detail = String(event.detail || '')
        return label === plugin.name || label === plugin.entryId || detail.indexOf(plugin.name) >= 0
      }, 12)
      const ownedServices = servicesForPlugin(props.snapshot, plugin)
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h(StatusDot, { status: phaseStatus(plugin.fiberPhase), size: 9, pulse: true }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title', style: { fontSize: '14px', fontFamily: 'var(--da-mono)' } }, String(plugin.title || plugin.name || plugin.entryId)),
            h('div', { className: 'da-domain-en' }, String(plugin.entryId || '') + (plugin.organ ? ' · ' + domainLabel : ''))
          ),
          plugin.organ ? h('span', { className: 'da-chip', style: { color: 'var(--dsw-alias-label-secondary)' } }, domainLabel) : null
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('pluginDetail') }),
          h(Field, { label: t('entryId'), value: plugin.entryId }),
          h(Field, { label: t('kind'), value: localizedPluginKind(plugin.kind, t), title: String(plugin.kind || '') }),
          h(Field, { label: t('version'), value: plugin.version || t('none') }),
          h(Field, { label: t('bundle'), value: plugin.bundle || t('none') }),
          h(Field, { label: t('enabled'), value: plugin.enabled === false ? t('disabled') : t('enabled') }),
          h(Field, { label: t('pluginPhase'), value: localizedPhase(plugin.fiberPhase, t), title: String(plugin.fiberPhase || '') }),
          h(Field, { label: t('domains'), value: domainLabel })
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('pluginDetail') + ' · ' + t('description') }),
          h('div', { className: 'da-tool-summary' },
            t('pluginSummaryPrefix') + ' ' + domainLabel + ' · ' + t('kind') + ' ' + localizedPluginKind(plugin.kind, t)
            + ' · ' + t('bundle') + ' ' + String(plugin.bundle || t('none'))
            + ' · ' + t('pluginPhase') + ' ' + localizedPhase(plugin.fiberPhase, t))
        ),
        plugin.description ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: isMostlyEnglish(plugin.description) ? t('originalText') : t('description') }),
          isMostlyEnglish(plugin.description)
            ? h(FoldText, { t: t, text: String(plugin.description) })
            : h('div', { className: 'da-desc', style: { margin: 0 } }, String(plugin.description))
        ) : null,
        ownedServices.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('providedServices'), extra: ownedServices.length }),
          h('div', { className: 'da-list' }, ownedServices.map(function (service) {
            return h('button', {
              key: 'svc:' + service.name, type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelect({ type: 'service', id: service.name }) },
              title: service.name,
            },
              h('span', { className: 'da-dot-sm', style: { color: service.active === false ? 'var(--dsw-alias-state-idle-primary, #7c8b9e)' : 'var(--dsw-alias-state-success-primary, #3ddc97)' } }),
              h('span', { className: 'da-name' }, String(service.name)),
              h('span', { className: 'da-chip', style: { color: 'var(--dsw-alias-label-secondary)' } }, String(service.organ || ''))
            )
          }))
        ) : null,
        h('div', { className: 'da-section' },
          h('div', { className: 'da-detail-actions' },
            h('button', {
              type: 'button', className: 'da-btn',
              onClick: function () { props.onSelect({ type: 'domain', id: plugin.organ }) },
            }, t('viewDomain')),
            typeof props.onTab === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onTab('timeline') } }, t('viewTimeline')) : null,
            typeof props.onFilterLog === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onFilterLog(plugin.name || plugin.entryId) } }, t('viewCallLog')) : null
          ),
          plugin.organ ? h('div', { className: 'da-subtle', style: { marginTop: '6px', fontSize: '10.5px' } }, domainLabel) : null
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedEvents'), extra: related.length }),
          h(RecentEvents, { t: t, events: related, onSelectEvent: props.onSelectEvent })
        )
      )
    }

    function ServiceDetail(props) {
      const t = props.t
      const zh = props.zh
      const service = props.service
      if (!service) return h(Empty, { text: t('noData') })
      const domainLabel = service.organ
        ? (DOMAIN_BY_ID[service.organ] ? domainTitle(DOMAIN_BY_ID[service.organ], zh) : String(service.organ))
        : t('none')
      const methods = Array.isArray(service.methods) ? service.methods : []
      const providerPlugin = pluginForService(props.snapshot, service)
      const related = collectEvents(props.events, function (event) {
        if (!event) return false
        const label = String(event.label || '')
        const detail = String(event.detail || '')
        return label === service.name || detail.indexOf(service.name) >= 0
      }, 12)
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h(StatusDot, { status: service.active === false ? 'idle' : 'active', size: 9, pulse: true }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title', style: { fontFamily: 'var(--da-mono)', fontSize: '14px' } }, String(service.name)),
            h('div', { className: 'da-domain-en' }, String(service.provider || '') + ' · ' + domainLabel)
          ),
          h('span', { className: 'da-chip', style: { color: 'var(--dsw-alias-label-secondary)' } }, domainLabel)
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('serviceDetail') }),
          h('div', { className: 'da-tool-summary' },
            t('serviceSummaryPrefix') + ' ' + String(providerPlugin ? (providerPlugin.title || providerPlugin.name) : service.provider)
            + ' ' + t('serviceSummaryMid') + ' ' + domainLabel + ' '
            + t('serviceSummaryEnd') + ' ' + String(methods.length) + ' ' + t('serviceSummarySuffix')),
          h(Field, { label: t('provider'), value: service.provider }),
          providerPlugin ? h('button', {
            type: 'button', className: 'da-list-row',
            style: { marginTop: '3px' },
            onClick: function () { props.onSelect({ type: 'plugin', id: providerPlugin.entryId || providerPlugin.name }) },
            title: providerPlugin.entryId || providerPlugin.name,
          },
            h('span', { className: 'da-dot-sm', style: { color: 'var(--da-cyan)' } }),
            h('span', { className: 'da-name' }, t('providerPlugin') + ': ' + String(providerPlugin.title || providerPlugin.name)),
            h('span', { className: 'da-chip', style: { color: 'var(--dsw-alias-label-secondary)' }, title: String(providerPlugin.fiberPhase || '') }, localizedPhase(providerPlugin.fiberPhase, t))
          ) : null,
          h('button', {
            type: 'button', className: 'da-btn', style: { marginTop: '6px' },
            onClick: function () { props.onSelect({ type: 'domain', id: service.organ }) },
          }, t('goDomain')),
          h(Field, { label: t('enabled'), value: service.active === false ? t('disabled') : t('enabled') }),
          h(Field, { label: t('domains'), value: domainLabel }),
          h(Field, { label: t('methods'), value: methods.length })
        ),
        methods.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('methodsTitle') + ' · ' + methods.length }),
          h('div', { className: 'da-list' }, methods.slice(0, 40).map(function (method, index) {
            return h('div', { key: 'm' + index, className: 'da-kv' },
              h('span', { className: 'da-kv-k' }, String(method)),
              h('span', { className: 'da-kv-v' }, '')
            )
          }))
        ) : null,
        h('div', { className: 'da-section' },
          h('div', { className: 'da-detail-actions' },
            h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onSelect({ type: 'domain', id: service.organ }) } }, t('viewDomain')),
            typeof props.onTab === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onTab('timeline') } }, t('viewTimeline')) : null,
            typeof props.onFilterLog === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onFilterLog(service.name) } }, t('viewCallLog')) : null
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedEvents'), extra: related.length }),
          h(RecentEvents, { t: t, events: related, onSelectEvent: props.onSelectEvent })
        )
      )
    }

    function ToolDetail(props) {
      const t = props.t
      const zh = props.zh
      const tool = props.tool
      if (!tool) return h(Empty, { text: t('noData') })
      const domainLabel = tool.organ
        ? (DOMAIN_BY_ID[tool.organ] ? domainTitle(DOMAIN_BY_ID[tool.organ], zh) : String(tool.organ))
        : t('none')
      const related = collectEvents(props.events, function (event) {
        if (!event) return false
        const label = String(event.label || '')
        const data = event.data && typeof event.data === 'object' ? event.data : null
        return label === tool.name || (data && data.tool === tool.name)
      }, 12)
      const anchorEvent = related.length > 0 ? related[0] : null
      const chain = buildCausalChain(props.events, anchorEvent, FLOW_WINDOW_MS)
      const relatedEntities = relatedEntitiesForEdge(props.snapshot, tool.organ, '')
      const latency = buildLatencyStats(props.events, tool.name, FLOW_WINDOW_MS)
      const llmCalls = relatedLlmCalls(props.events, anchorEvent, 5)
      const argsPreview = tool.argsPreview || tool.args || ''
      const resultPreview = tool.resultPreview || tool.result || ''
      const sourceKey = toolSourceKey(tool.name)
      const sourceLabel = sourceKey ? t(sourceKey) : t('sourceUnknown')
      const kindLabel = localizedKind(tool.kind, t)
      const lastEvent = related.length > 0 ? related[0] : null
      const lastMs = lastEvent ? num(lastEvent.ms) : 0
      const englishDescription = isMostlyEnglish(tool.description)
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h(StatusDot, { status: num(tool.errors) > 0 ? 'warn' : 'active', size: 9 }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title', style: { fontFamily: 'var(--da-mono)', fontSize: '15px' } }, String(tool.name)),
            h('div', { className: 'da-domain-en' }, kindLabel + ' · ' + domainLabel)
          )
        ),
        h(StatRow, {
          items: [
            { label: t('statCalls'), value: fmtNum(tool.calls) },
            { label: t('statErrors'), value: fmtNum(tool.errors), accent: num(tool.errors) > 0 ? 'var(--dsw-alias-state-error-primary, #ff5f6d)' : 'var(--dsw-alias-state-success-primary, #3ddc97)' },
            { label: t('statAvgMs'), value: fmtMs(tool.avgMs) },
            { label: t('statLastMs'), value: lastMs > 0 ? fmtMs(lastMs) : '—' },
          ],
        }),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('toolSource') + ' / ' + t('kind') }),
          h(Field, { label: t('toolSource'), value: sourceLabel }),
          h(Field, { label: t('kind'), value: kindLabel }),
          h(Field, { label: t('domains'), value: domainLabel }),
          h('div', { className: 'da-tool-summary', style: { marginTop: '6px' } }, t('toolFromDomain') + ' ' + domainLabel)
        ),
        tool.description ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('toolZhTitle') }),
          h('div', { className: 'da-desc da-tool-zh', style: { margin: 0 } }, toolChineseDescription(tool.name, t))
        ) : null,
        tool.description ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('originalText') }),
          englishDescription
            ? h(FoldText, { t: t, text: String(tool.description) })
            : h('div', { className: 'da-desc', style: { margin: 0 } }, String(tool.description))
        ) : null,
        (argsPreview || resultPreview) ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('argsResult') }),
          argsPreview ? h('div', null,
            h('div', { className: 'da-subtle', style: { marginBottom: '4px', fontSize: '10px' } }, t('argsPreview')),
            h(PreBlock, { text: argsPreview })
          ) : null,
          resultPreview ? h('div', { style: { marginTop: argsPreview ? '8px' : 0 } },
            h('div', { className: 'da-subtle', style: { marginBottom: '4px', fontSize: '10px' } }, t('resultPreview')),
            h(PreBlock, { text: resultPreview })
          ) : null
        ) : null,
        latency.count > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('latencyDist'), extra: latency.count }),
          h(StatRow, {
            items: [
              { label: t('latencyMin'), value: fmtMs(latency.min) },
              { label: t('latencyAvg'), value: fmtMs(latency.avg) },
              { label: t('latencyP50'), value: fmtMs(latency.p50) },
              { label: t('latencyMax'), value: fmtMs(latency.max) },
            ],
          }),
          h(LatencySparkline, { t: t, values: latency.values })
        ) : null,
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('causalChain'), extra: chain.steps.length }),
          h(CausalChain, { t: t, chain: chain, onSelectEvent: props.onSelectEvent })
        ),
        llmCalls.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedLlmCalls'), extra: llmCalls.length }),
          h('div', { className: 'da-list' }, llmCalls.map(function (call) {
            return h('button', {
              key: 'llm:' + call.id, type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelectEvent({ type: 'event', id: call.id }) },
              title: call.label,
            },
              h('span', { className: 'da-recent-time' }, fmtClock(call.t)),
              h(KindChip, { kind: 'llm.start' }),
              h('span', { className: 'da-name' }, call.label),
              h('span', { className: 'da-chip' }, fmtMs(call.ms))
            )
          }))
        ) : null,
        (relatedEntities.services.length > 0 || relatedEntities.plugins.length > 0) ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedPlugins') + ' / ' + t('relatedServices') }),
          h('div', { className: 'da-list' },
            relatedEntities.services.map(function (service) {
              return h('button', {
                key: 'ts:' + service.name, type: 'button', className: 'da-list-row',
                onClick: function () { props.onSelect({ type: 'service', id: service.name }) },
              },
                h('span', { className: 'da-dot-sm', style: { color: 'var(--da-cyan)' } }),
                h('span', { className: 'da-name' }, String(service.name)),
                h('span', { className: 'da-chip' }, String(service.provider || ''))
              )
            }),
            relatedEntities.plugins.map(function (plugin) {
              return h('button', {
                key: 'tp:' + (plugin.entryId || plugin.name), type: 'button', className: 'da-list-row',
                onClick: function () { props.onSelect({ type: 'plugin', id: plugin.entryId || plugin.name }) },
              },
                h('span', { className: 'da-dot-sm', style: { color: 'var(--da-violet)' } }),
                h('span', { className: 'da-name' }, String(plugin.title || plugin.name)),
                h('span', { className: 'da-chip', title: String(plugin.fiberPhase || '') }, localizedPhase(plugin.fiberPhase, t))
              )
            })
          )
        ) : null,
        h('div', { className: 'da-section' },
          h('div', { className: 'da-detail-actions' },
            h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onSelect({ type: 'domain', id: tool.organ }) } }, t('viewDomain')),
            typeof props.onTab === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onTab('timeline') } }, t('viewTimeline')) : null,
            typeof props.onFilterLog === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onFilterLog(tool.name) } }, t('viewCallLog')) : null
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedEvents'), extra: related.length }),
          h(RecentEvents, { t: t, events: related, onSelectEvent: props.onSelectEvent })
        )
      )
    }

    function EventDetail(props) {
      const t = props.t
      const zh = props.zh
      const event = props.event
      if (!event) return h(Empty, { text: t('noData') })
      const source = event.organ ? DOMAIN_BY_ID[event.organ] : null
      const target = event.target ? DOMAIN_BY_ID[event.target] : null
      const dataText = event.data ? safeJson(event.data, 480) : ''
      const chain = buildCausalChain(props.events, event, FLOW_WINDOW_MS)
      const relatedEntities = relatedEntitiesForEdge(props.snapshot, event.organ, event.target)
      const dataObj = event.data && typeof event.data === 'object' ? event.data : {}
      const argsPreview = dataObj.argsPreview || dataObj.args || ''
      const resultPreview = dataObj.resultPreview || dataObj.result || ''
      const toolName = dataObj.tool || (kindGroup(event.kind) === 'tool' ? String(event.label || '') : '')
      const latency = toolName ? buildLatencyStats(props.events, toolName, FLOW_WINDOW_MS) : { count: 0, min: 0, avg: 0, p50: 0, max: 0, values: [] }
      const llmCalls = relatedLlmCalls(props.events, event, 5)
      const usage = dataObj.usage && typeof dataObj.usage === 'object' ? dataObj.usage : null
      const statusText = event.ok === false || event.level === 'error' ? t('statusFail') : t('statusOk')
      const dataRows = eventDataRows(dataObj, t)
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h(KindChip, { kind: event.kind }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title', style: { fontFamily: 'var(--da-mono)', fontSize: '13px' } }, String(event.label || event.kind || '')),
            h('div', { className: 'da-domain-en' }, fmtClock(event.t) + ' · ' + fmtRel(event.t, t))
          )
        ),
        h(StatRow, {
          items: [
            { label: t('ms'), value: fmtMs(event.ms) },
            { label: t('statusDot'), value: statusText, accent: event.ok === false || event.level === 'error' ? 'var(--dsw-alias-state-error-primary, #ff5f6d)' : 'var(--dsw-alias-state-success-primary, #3ddc97)' },
            { label: t('session'), value: event.sessionId ? String(event.sessionId).slice(0, 12) : t('none') },
          ],
        }),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('eventDetail') }),
          h(Field, { label: t('label'), value: event.label }),
          h(Field, { label: t('kind'), value: localizedKind(event.kind, t) }),
          h(Field, { label: t('timestamp'), value: fmtClock(event.t) }),
          h(Field, { label: t('session'), value: event.sessionId || t('none'), title: event.sessionId || t('none') }),
          h(Field, { label: t('agent'), value: event.agentId || t('none') })
        ),
        usage ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('usageTokens') }),
          h(StatRow, {
            items: [
              { label: t('tokensIn'), value: fmtNum(usage.input !== undefined ? usage.input : usage.promptTokens) },
              { label: t('tokensOut'), value: fmtNum(usage.output !== undefined ? usage.output : usage.completionTokens) },
            ],
          })
        ) : null,
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('domains') }),
          h('div', { className: 'da-list' },
            source ? h('button', {
              type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelect({ type: 'domain', id: source.id }) },
            }, h(StatusDot, { status: source.status || 'idle', size: 6 }), h('span', { className: 'da-name' }, domainTitle(source, zh))) : h(Empty, { text: event.organ || t('none') }),
            target ? h('button', {
              type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelect({ type: 'domain', id: target.id }) },
            }, h(StatusDot, { status: target.status || 'idle', size: 6 }), h('span', { className: 'da-name' }, '→ ' + domainTitle(target, zh))) : null
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('causalChain'), extra: chain.steps.length }),
          h(CausalChain, { t: t, chain: chain, onSelectEvent: props.onSelectEvent })
        ),
        (argsPreview || resultPreview) ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('argsResult') }),
          argsPreview ? h('div', null,
            h('div', { className: 'da-subtle', style: { marginBottom: '4px', fontSize: '10px' } }, t('argsPreview')),
            h(PreBlock, { text: argsPreview })
          ) : null,
          resultPreview ? h('div', { style: { marginTop: argsPreview ? '8px' : 0 } },
            h('div', { className: 'da-subtle', style: { marginBottom: '4px', fontSize: '10px' } }, t('resultPreview')),
            h(PreBlock, { text: resultPreview })
          ) : null
        ) : null,
        latency.count > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('latencyDist'), extra: latency.count }),
          h(StatRow, {
            items: [
              { label: t('latencyMin'), value: fmtMs(latency.min) },
              { label: t('latencyAvg'), value: fmtMs(latency.avg) },
              { label: t('latencyP50'), value: fmtMs(latency.p50) },
              { label: t('latencyMax'), value: fmtMs(latency.max) },
            ],
          }),
          h(LatencySparkline, { t: t, values: latency.values })
        ) : null,
        llmCalls.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedLlmCalls'), extra: llmCalls.length }),
          h('div', { className: 'da-list' }, llmCalls.map(function (call) {
            return h('button', {
              key: 'llm:' + call.id, type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelectEvent({ type: 'event', id: call.id }) },
              title: call.label,
            },
              h('span', { className: 'da-recent-time' }, fmtClock(call.t)),
              h(KindChip, { kind: 'llm.start' }),
              h('span', { className: 'da-name' }, call.label),
              h('span', { className: 'da-chip' }, fmtMs(call.ms))
            )
          }))
        ) : null,
        (relatedEntities.services.length > 0 || relatedEntities.plugins.length > 0) ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedPlugins') + ' / ' + t('relatedServices') }),
          h('div', { className: 'da-list' },
            relatedEntities.services.map(function (service) {
              return h('button', {
                key: 'es:' + service.name, type: 'button', className: 'da-list-row',
                onClick: function () { props.onSelect({ type: 'service', id: service.name }) },
              },
                h('span', { className: 'da-dot-sm', style: { color: 'var(--da-cyan)' } }),
                h('span', { className: 'da-name' }, String(service.name)),
                h('span', { className: 'da-chip' }, String(service.provider || ''))
              )
            }),
            relatedEntities.plugins.map(function (plugin) {
              return h('button', {
                key: 'ep:' + (plugin.entryId || plugin.name), type: 'button', className: 'da-list-row',
                onClick: function () { props.onSelect({ type: 'plugin', id: plugin.entryId || plugin.name }) },
              },
                h('span', { className: 'da-dot-sm', style: { color: 'var(--da-violet)' } }),
                h('span', { className: 'da-name' }, String(plugin.title || plugin.name)),
                h('span', { className: 'da-chip', title: String(plugin.fiberPhase || '') }, localizedPhase(plugin.fiberPhase, t))
              )
            })
          )
        ) : null,
        h('div', { className: 'da-section' },
          h('div', { className: 'da-detail-actions' },
            typeof props.onTab === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onTab('timeline') } }, t('viewTimeline')) : null,
            typeof props.onFilterLog === 'function' ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onFilterLog(event.label || event.kind) } }, t('viewCallLog')) : null,
            source ? h('button', { type: 'button', className: 'da-btn', onClick: function () { props.onSelect({ type: 'domain', id: source.id }) } }, t('viewDomain')) : null
          )
        ),
        event.detail ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: isMostlyEnglish(event.detail) ? t('originalText') : t('description') }),
          isMostlyEnglish(event.detail)
            ? h(FoldText, { t: t, text: String(event.detail) })
            : h('div', { className: 'da-desc', style: { margin: 0, wordBreak: 'break-word' } }, String(event.detail))
        ) : null,
        dataRows.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('data'), extra: dataRows.length }),
          h('div', { className: 'da-list' }, dataRows.map(function (row, index) {
            return h('div', { key: 'data:' + index, className: 'da-kv', title: row.key },
              h('span', { className: 'da-kv-k' }, row.label),
              h('span', { className: 'da-kv-v', style: { fontFamily: 'var(--da-mono)' } }, row.value)
            )
          }))
        ) : null
      )
    }

    function ClientBundleDetail(props) {
      const t = props.t
      const bundle = props.bundle
      if (!bundle) return h(Empty, { text: t('noData') })
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h(StatusDot, { status: 'active', size: 9 }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title', style: { fontFamily: 'var(--da-mono)', fontSize: '14px' } }, String(bundle.title || bundle.id)),
            h('div', { className: 'da-domain-en' }, String(bundle.id || ''))
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('clientBundleDetail') }),
          h('div', { className: 'da-tool-summary' }, t('clientBundleSummary') + ' · ' + String(bundle.title || bundle.id)),
          h(Field, { label: t('clientBundleId'), value: bundle.id }),
          h(Field, { label: t('clientBundleRev'), value: bundle.rev || t('none') }),
          h(Field, { label: t('kind'), value: t('kindClient') })
        )
      )
    }

    function ModelDetail(props) {
      const t = props.t
      const model = props.model
      if (!model) return h(Empty, { text: t('noData') })
      const models = props.snapshot && props.snapshot.models && typeof props.snapshot.models === 'object' ? props.snapshot.models : null
      const fallback = models && models.default && typeof models.default === 'object' ? models.default : null
      const isDefault = !!(fallback && fallback.provider === model.provider && fallback.model === model.id)
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h(StatusDot, { status: 'active', size: 9 }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title', style: { fontFamily: 'var(--da-mono)', fontSize: '14px' } }, String(model.name || model.id)),
            h('div', { className: 'da-domain-en' }, String(model.provider || ''))
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('modelDetail') }),
          h('div', { className: 'da-tool-summary' }, t('modelSummary') + ' · ' + String(model.name || model.id) + ' · ' + String(model.provider || '')),
          h(Field, { label: t('modelProvider'), value: model.provider }),
          h(Field, { label: t('modelId'), value: model.id }),
          h(Field, { label: t('contextWindow'), value: model.contextWindow !== undefined ? fmtNum(model.contextWindow) : t('none') }),
          h(Field, { label: t('modelDefault'), value: isDefault ? t('statusActive') : t('none') })
        )
      )
    }

    /** Right-drawer detail for one observed call edge (from → to). */
    function EdgeDetail(props) {
      const t = props.t
      const zh = props.zh
      const detail = props.detail
      if (!detail) return h(Empty, { text: t('noData') })
      const mode = detail.mode
      const fromLabel = mode === 'tool'
        ? detail.from
        : (DOMAIN_BY_ID[detail.from] ? domainTitle(DOMAIN_BY_ID[detail.from], zh) : String(detail.from))
      const toLabel = DOMAIN_BY_ID[detail.to] ? domainTitle(DOMAIN_BY_ID[detail.to], zh) : String(detail.to)
      const errorColor = detail.errors > 0 ? 'var(--dsw-alias-state-error-primary, #ff5f6d)' : 'var(--dsw-alias-state-success-primary, #3ddc97)'
      const filterName = detail.labels.length > 0 ? detail.labels[0].label : (mode === 'tool' ? detail.from : toLabel)
      const related = mode === 'domain' ? relatedEntitiesForEdge(props.snapshot, detail.from, detail.to) : { services: [], plugins: [] }
      return h('div', null,
        h('div', { className: 'da-domain-head' },
          h('span', { className: 'da-dot-sm', style: { color: errorColor } }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'da-domain-title', style: { fontSize: '13px', fontFamily: 'var(--da-mono)' } }, detail.from + ' → ' + detail.to),
            h('div', { className: 'da-domain-en' }, fromLabel + ' → ' + toLabel)
          )
        ),
        h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('edgeDetail') }),
          h(Field, { label: t('edgeFrom'), value: fromLabel }),
          h(Field, { label: t('edgeTo'), value: toLabel }),
          h(Field, { label: t('edgeCount'), value: String(detail.count) + ' / 120s' }),
          h(Field, { label: t('edgeErrors'), value: fmtNum(detail.errors) }),
          h(Field, { label: t('edgeAvgMs'), value: fmtMs(detail.avgMs) })
        ),
        h('div', { className: 'da-section' },
          h('div', { className: 'da-list' },
            mode === 'domain' ? h('button', {
              type: 'button', className: 'da-btn',
              onClick: function () { props.onSelect({ type: 'domain', id: detail.from }) },
            }, t('goFrom')) : null,
            h('button', {
              type: 'button', className: 'da-btn', style: { marginLeft: '8px' },
              onClick: function () { props.onSelect({ type: 'domain', id: detail.to }) },
            }, t('goTo'))
          )
        ),
        detail.labels.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('edgeSources'), extra: detail.labels.length }),
          h('div', { className: 'da-list' }, detail.labels.map(function (row, index) {
            return h('div', { key: 'el:' + index, className: 'da-kv' },
              h('span', { className: 'da-kv-k', title: row.label }, String(row.label)),
              h('span', { className: 'da-kv-v' }, '×' + String(row.count))
            )
          }))
        ) : null,
        detail.kinds.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('edgeKinds'), extra: detail.kinds.length }),
          h('div', { className: 'da-list' }, detail.kinds.map(function (row, index) {
            return h('div', { key: 'ek:' + index, className: 'da-kv' },
              h('span', { className: 'da-kv-k' }, h(KindChip, { kind: row.label })),
              h('span', { className: 'da-kv-v' }, String(row.count))
            )
          }))
        ) : null,
        detail.samples.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('edgeSamples'), extra: detail.samples.length }),          h('div', { className: 'da-list' }, detail.samples.map(function (sample, index) {
            return h('div', { key: 'es:' + index, className: 'da-recent-row' },
              h('span', { className: 'da-recent-time' }, fmtClock(sample.t)),
              h(KindChip, { kind: sample.kind }),
              h('span', { className: 'da-recent-label' }, String(sample.label || '')),
              h('span', { className: 'da-mono', style: { flex: 'none', fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } }, fmtMs(sample.ms))
            )
          }))
        ) : null,
        related.services.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedServices'), extra: related.services.length }),
          h('div', { className: 'da-list' }, related.services.map(function (service) {
            return h('button', {
              key: 'rs:' + service.name, type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelect({ type: 'service', id: service.name }) },
              title: service.name + (service.provider ? ' · ' + service.provider : ''),
            },
              h('span', { className: 'da-dot-sm', style: { color: service.active === false ? 'var(--dsw-alias-state-idle-primary, #7c8b9e)' : 'var(--dsw-alias-state-success-primary, #3ddc97)' } }),
              h('span', { className: 'da-name' }, String(service.name)),
              h('span', { className: 'da-chip', style: { color: 'var(--dsw-alias-label-secondary)' } }, String(service.organ || ''))
            )
          }))
        ) : null,
        related.plugins.length > 0 ? h('div', { className: 'da-section' },
          h(SectionTitle, { title: t('relatedPlugins'), extra: related.plugins.length }),
          h('div', { className: 'da-list' }, related.plugins.map(function (plugin) {
            return h('button', {
              key: 'rp:' + (plugin.entryId || plugin.name), type: 'button', className: 'da-list-row',
              onClick: function () { props.onSelect({ type: 'plugin', id: plugin.entryId || plugin.name }) },
              title: plugin.entryId || plugin.name,
            },
              h('span', { className: 'da-dot-sm', style: { color: phaseStatus(plugin.fiberPhase) === 'error' ? 'var(--dsw-alias-state-error-primary, #ff5f6d)' : 'var(--dsw-alias-state-success-primary, #3ddc97)' } }),
              h('span', { className: 'da-name' }, String(plugin.title || plugin.name)),
              h('span', { className: 'da-chip', style: { color: 'var(--dsw-alias-label-secondary)' }, title: String(plugin.fiberPhase || '') }, localizedPhase(plugin.fiberPhase, t))
            )
          }))
        ) : null,
        h('div', { className: 'da-section' },
          h('button', {
            type: 'button', className: 'da-btn',
            onClick: function () { props.onFilterLog(filterName) },
          }, t('filterInLog'))
        )
      )
    }

    function DetailDrawer(props) {
      const t = props.t
      const selection = props.selection
      const zh = props.zh
      const snapshot = props.snapshot
      const events = props.events
      const flows = props.flows && typeof props.flows === 'object' ? props.flows : { pairs: {}, nodes: {} }
      let titleText = t('overview')
      let body = null
      if (!selection) {
        body = h(RuntimeOverview, props)
      } else if (selection.type === 'domain') {
        const node = (props.nodes || []).filter(function (item) { return item.id === selection.id })[0]
        const liveDomainMetrics = props.orgMetrics && props.orgMetrics[selection.id] ? props.orgMetrics[selection.id] : null
        titleText = t('domainDetail')
        body = h(DomainDetail, {
          t: t, zh: zh, node: node, liveMetrics: liveDomainMetrics, snapshot: snapshot, events: events,
          flows: flows, toolFlows: props.toolFlows,
          selection: selection, onSelect: props.onSelect, onSelectEvent: props.onSelectEvent,
        })
      } else if (selection.type === 'plugin') {
        titleText = t('pluginDetail')
        body = h(PluginDetail, { t: t, zh: zh, plugin: findPlugin(snapshot, selection.id), snapshot: snapshot, events: events, onSelect: props.onSelect, onSelectEvent: props.onSelectEvent, onTab: props.onTab, onFilterLog: props.onFilterLog })
      } else if (selection.type === 'service') {
        titleText = t('serviceDetail')
        body = h(ServiceDetail, { t: t, zh: zh, service: findService(snapshot, selection.id), snapshot: snapshot, events: events, onSelect: props.onSelect, onSelectEvent: props.onSelectEvent, onTab: props.onTab, onFilterLog: props.onFilterLog })
      } else if (selection.type === 'tool') {
        titleText = t('toolDetail')
        body = h(ToolDetail, { t: t, zh: zh, tool: findTool(snapshot, selection.id), snapshot: snapshot, events: events, onSelect: props.onSelect, onSelectEvent: props.onSelectEvent, onTab: props.onTab, onFilterLog: props.onFilterLog })
      } else if (selection.type === 'event') {
        titleText = t('eventDetail')
        body = h(EventDetail, { t: t, zh: zh, event: findEvent(events, selection.id), snapshot: snapshot, events: events, onSelect: props.onSelect, onSelectEvent: props.onSelectEvent, onTab: props.onTab, onFilterLog: props.onFilterLog })
      } else if (selection.type === 'edge') {
        titleText = t('edgeDetail')
        body = h(EdgeDetail, {
          t: t, zh: zh,
          detail: buildEdgeDetail(selection, flows, props.toolFlows, events, FLOW_WINDOW_MS),
          snapshot: snapshot,
          onSelect: props.onSelect,
          onFilterLog: props.onFilterLog,
        })
      } else if (selection.type === 'clientBundle') {
        titleText = t('clientBundleDetail')
        body = h(ClientBundleDetail, { t: t, bundle: findClientBundle(snapshot, selection.id) })
      } else if (selection.type === 'model') {
        titleText = t('modelDetail')
        body = h(ModelDetail, { t: t, model: findModel(snapshot, selection.id), snapshot: snapshot })
      }
      const [drawerWidth, setDrawerWidth] = React.useState(function () {
        const viewport = safe(function () {
          return typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1440
        }, 1440)
        return Math.round(clamp(num(viewport) * 0.24, 300, 360))
      })
      const [resizing, setResizing] = React.useState(false)
      const resizeRef = React.useRef(null)
      const onResizeDown = function (event) {
        if (!event || (event.button !== undefined && event.button !== 0)) return
        resizeRef.current = {
          id: event.pointerId,
          startX: num(event.clientX),
          startWidth: drawerWidth,
        }
        setResizing(true)
        if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function' && event.pointerId !== undefined) {
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch (error) { /* ignore */ }
        }
        if (typeof event.preventDefault === 'function') event.preventDefault()
      }
      const onResizeMove = function (event) {
        const drag = resizeRef.current
        if (!drag) return
        const delta = num(event.clientX) - drag.startX
        setDrawerWidth(Math.round(clamp(drag.startWidth - delta, 272, 420)))
      }
      const onResizeUp = function (event) {
        const drag = resizeRef.current
        resizeRef.current = null
        setResizing(false)
        if (drag && drag.id !== undefined && event && event.currentTarget && typeof event.currentTarget.releasePointerCapture === 'function') {
          try { event.currentTarget.releasePointerCapture(drag.id) } catch (error) { /* ignore */ }
        }
      }
      return h('div', {
        className: 'da-drawer' + (props.collapsed ? ' da-collapsed' : '') + (resizing ? ' da-resizing' : ''),
        style: { '--da-drawer-w': drawerWidth + 'px' },
        onWheel: function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
      },
        h('div', {
          className: 'da-drawer-resize',
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-label': t('resizeDrawer'),
          title: t('resizeDrawer'),
          onPointerDown: onResizeDown,
          onPointerMove: onResizeMove,
          onPointerUp: onResizeUp,
          onPointerCancel: onResizeUp,
        }),
        h('div', { className: 'da-drawer-head' },
          selection ? h('button', {
            type: 'button', className: 'da-btn da-btn-icon da-drawer-back', onClick: props.onBack,
            title: props.backLabel || t('back'), 'aria-label': props.backLabel || t('back'),
          }, '←') : null,
          h('div', { className: 'da-drawer-headtext' },
            h('span', { className: 'da-drawer-breadcrumb', title: props.breadcrumb || '' }, props.breadcrumb || ''),
            h('span', { className: 'da-drawer-title', title: titleText }, titleText)
          ),
          selection ? h('button', {
            type: 'button', className: 'da-btn da-btn-icon', onClick: props.onClear,
            title: t('close'), 'aria-label': t('close'),
          }, '×') : null
        ),
        h('div', { className: 'da-drawer-body da-scroll da-drawer-cards' },
          body,
          h('div', { className: 'da-desc', style: { marginTop: '14px', fontSize: '10px', opacity: 0.66 } }, t('footerNote'))
        )
      )
    }
    // ---------------------------------------------------------------------
    // Bottom console: runtime metrics, component inventory, call log.
    // ---------------------------------------------------------------------

    function ThroughputSparkline(props) {
      const t = props.t
      const samples = Array.isArray(props.samples) ? props.samples : []
      const slots = SPARK_SAMPLES
      const height = 64
      const points = []
      let latest = 0
      for (let i = 0; i < slots; i += 1) {
        const offset = samples.length - slots + i
        const sample = offset >= 0 ? clamp01(samples[offset]) : 0
        if (offset >= 0 && offset === samples.length - 1) latest = sample
        const x = (i / (slots - 1)) * slots
        const y = 4 + (1 - sample) * (height - 8)
        points.push(x.toFixed(2) + ',' + y.toFixed(2))
      }
      const areaPath = 'M 0 ' + height + ' L ' + points.join(' L ') + ' L ' + slots + ' ' + height + ' Z'
      return h('div', { className: 'da-spark-box' },
        h('div', { className: 'da-spark-head' },
          h('span', null, t('throughputTitle')),
          h('span', null, fmtNum(latest * 100) + '%')
        ),
        h('div', { className: 'da-spark-canvas' },
          h('svg', { className: 'da-spark-svg', viewBox: '0 0 120 ' + height, preserveAspectRatio: 'none', 'aria-hidden': true },
            h('path', { d: 'M0 16H120M0 32H120M0 48H120', stroke: 'rgba(62,232,255,0.08)', strokeWidth: 0.4, fill: 'none' }),
            h('path', { d: areaPath, fill: 'rgba(62,232,255,0.10)', stroke: 'none' }),
            h('polyline', { points: points.join(' '), fill: 'none', stroke: '#3ee8ff', strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' })
          ),
          h('div', { className: 'da-spark-cursor' })
        )
      )
    }

    const MetricsTab = React.memo(function MetricsTab(props) {
      const t = props.t
      const live = props.live && typeof props.live === 'object' ? props.live : {}
      const toolMetrics = props.toolMetrics && typeof props.toolMetrics === 'object' ? props.toolMetrics : {}
      const tools = props.snapshot && Array.isArray(props.snapshot.tools) ? props.snapshot.tools : []
      const merged = tools.map(function (tool) {
        const metric = tool && toolMetrics[tool.name] ? toolMetrics[tool.name] : null
        return {
          name: tool.name,
          calls: metric && metric.calls !== undefined ? num(metric.calls) : num(tool.calls),
        }
      }).sort(function (a, b) { return b.calls - a.calls }).slice(0, 5)
      const maxCalls = merged.reduce(function (max, tool) { return Math.max(max, tool.calls) }, 0) || 1
      return h('div', { className: 'da-metrics' },
        h('div', { className: 'da-cards' },
          h(MetricCard, { label: t('eventsPerSec'), value: fmtNum(live.eventsPerSec) }),
          h(MetricCard, { label: t('toolCallsPerMin'), value: fmtNum(live.toolCallsPerMin), accent: 'var(--da-cyan)' }),
          h(MetricCard, { label: t('llmCallsPerMin'), value: fmtNum(live.llmCallsPerMin), accent: '#ff8b93' }),
          h(MetricCard, { label: t('tokensPerMin'), value: fmtNum(num(live.tokensPerMin) / 60), accent: 'var(--da-violet)' }),
          h(MetricCard, { label: t('errorsPerMin'), value: fmtNum(live.errorsPerMin), accent: num(live.errorsPerMin) > 0 ? 'var(--dsw-alias-state-error-primary, #ff5f6d)' : undefined }),
          h(MetricCard, { label: t('avgMs'), value: fmtMs(averageLatency(toolMetrics)), accent: 'var(--da-blue)' })
        ),
        h(ThroughputSparkline, { t: t, samples: props.spark }),
        h('div', { className: 'da-rank' },
          h('div', { className: 'da-section-title', style: { marginBottom: '2px' } }, h('span', null, t('topTools'))),
          merged.length === 0 ? h(Empty, { text: t('rankEmpty') }) : merged.map(function (tool) {
            return h('div', { key: 'rk:' + tool.name, className: 'da-rank-row', title: tool.name + ' · ' + t('calls') + ' ' + tool.calls },
              h('span', { className: 'da-rank-name' }, tool.name),
              h('span', { className: 'da-rank-bar' }, h('i', { style: { width: Math.max(4, Math.round((tool.calls / maxCalls) * 100)) + '%' } })),
              h('span', { className: 'da-rank-val' }, fmtNum(tool.calls))
            )
          })
        )
      )
    })

    function componentRowMatches(row, needle) {
      if (!needle) return true
      return String(row.label || '').toLowerCase().indexOf(needle) >= 0
        || String(row.id || '').toLowerCase().indexOf(needle) >= 0
        || String(row.extra || '').toLowerCase().indexOf(needle) >= 0
    }

    function buildComponentSections(snapshot, query, t) {
      const tr = typeof t === 'function' ? t : fallbackT
      const needle = String(query || '').trim().toLowerCase()
      const plugins = snapshot && Array.isArray(snapshot.plugins) ? snapshot.plugins : []
      const services = snapshot && Array.isArray(snapshot.services) ? snapshot.services : []
      const tools = snapshot && Array.isArray(snapshot.tools) ? snapshot.tools : []
      const clientBundles = snapshot && Array.isArray(snapshot.clientBundles) ? snapshot.clientBundles : []
      const models = snapshot && snapshot.models && typeof snapshot.models === 'object' ? snapshot.models : null
      const sections = []

      // Plugins grouped by bundle (bundle-less plugins fall into one group).
      const bundleMap = Object.create(null)
      const bundleOrder = []
      for (let i = 0; i < plugins.length; i += 1) {
        const plugin = plugins[i]
        if (!plugin) continue
        const bundle = plugin.bundle && String(plugin.bundle) !== '' ? String(plugin.bundle) : '—'
        if (!bundleMap[bundle]) {
          bundleMap[bundle] = []
          bundleOrder.push(bundle)
        }
        bundleMap[bundle].push({
          type: 'plugin',
          id: plugin.entryId || plugin.name,
          label: String(plugin.title || plugin.name || plugin.entryId || ''),
          extra: plugin.fiberPhase ? String(plugin.fiberPhase) : '',
          status: phaseStatus(plugin.fiberPhase),
          color: FLOW_COLORS.session,
        })
      }
      bundleOrder.sort(function (a, b) { return bundleMap[b].length - bundleMap[a].length })
      for (let i = 0; i < bundleOrder.length; i += 1) {
        const rows = bundleMap[bundleOrder[i]].slice().sort(function (a, b) {
          const rank = { error: 0, warn: 1, active: 2, idle: 3, offline: 4 }
          const diff = (rank[a.status] || 9) - (rank[b.status] || 9)
          return diff !== 0 ? diff : a.label.localeCompare(b.label)
        }).filter(function (row) { return componentRowMatches(row, needle) })
        if (rows.length === 0) continue
        sections.push({ key: 'bundle:' + bundleOrder[i], title: bundleOrder[i] + ' · ' + tr('plugins'), total: bundleMap[bundleOrder[i]].length, rows: rows })
      }

      const serviceRows = services.map(function (service) {
        return {
          type: 'service',
          id: service && service.name,
          label: String(service && service.name || ''),
          extra: service && service.provider ? String(service.provider) : '',
          status: service && service.active === false ? 'idle' : 'active',
          color: FLOW_COLORS.plugin,
        }
      }).filter(function (row) { return componentRowMatches(row, needle) })
      if (serviceRows.length > 0) sections.push({ key: 'services', title: tr('services'), total: services.length, rows: serviceRows })

      const toolRows = tools.map(function (tool) {
        return {
          type: 'tool',
          id: tool && tool.name,
          label: String(tool && tool.name || ''),
          extra: fmtNum(tool && tool.calls) + ' · ' + fmtMs(tool && tool.avgMs),
          status: num(tool && tool.errors) > 0 ? 'warn' : 'active',
          color: FLOW_COLORS.tool,
        }
      }).filter(function (row) { return componentRowMatches(row, needle) })
      if (toolRows.length > 0) sections.push({ key: 'tools', title: tr('tools'), total: tools.length, rows: toolRows })

      const bundleRows = clientBundles.map(function (bundle) {
        return {
          type: 'clientBundle',
          id: bundle && (bundle.id || bundle.title),
          label: String(bundle && (bundle.title || bundle.id) || ''),
          extra: bundle && bundle.rev ? String(bundle.rev) : '',
          status: 'active',
          color: FLOW_COLORS.other,
        }
      }).filter(function (row) { return componentRowMatches(row, needle) })
      if (bundleRows.length > 0) sections.push({ key: 'clientBundles', title: tr('clientBundles'), total: clientBundles.length, rows: bundleRows })

      const modelRows = models && Array.isArray(models.models) ? models.models.map(function (model) {
        return {
          type: 'model',
          id: String(model.provider) + '/' + String(model.id),
          label: String(model.name || model.id),
          extra: String(model.provider),
          status: 'active',
          color: FLOW_COLORS.other,
        }
      }).filter(function (row) { return componentRowMatches(row, needle) }) : []
      if (modelRows.length > 0) sections.push({ key: 'models', title: tr('models'), total: modelRows.length, rows: modelRows })

      // MCP-related entries pulled from the services/tools/plugins lists.
      const mcpRows = []
      const isMcp = function (value) { return String(value || '').toLowerCase().indexOf('mcp') >= 0 }
      for (let i = 0; i < services.length; i += 1) {
        const service = services[i]
        if (!service || !isMcp(service.name) || !componentRowMatches({ label: service.name, id: service.name }, needle)) continue
        mcpRows.push({ type: 'service', id: service.name, label: service.name, extra: tr('services'), status: service.active === false ? 'idle' : 'active', color: FLOW_COLORS.plugin })
      }
      for (let i = 0; i < tools.length; i += 1) {
        const tool = tools[i]
        if (!tool || !isMcp(tool.name) || !componentRowMatches({ label: tool.name, id: tool.name }, needle)) continue
        mcpRows.push({ type: 'tool', id: tool.name, label: tool.name, extra: tr('tools'), status: num(tool.errors) > 0 ? 'warn' : 'active', color: FLOW_COLORS.tool })
      }
      for (let i = 0; i < plugins.length; i += 1) {
        const plugin = plugins[i]
        if (!plugin || !isMcp(plugin.name) || !componentRowMatches({ label: plugin.name, id: plugin.name }, needle)) continue
        mcpRows.push({ type: 'plugin', id: plugin.entryId || plugin.name, label: String(plugin.title || plugin.name), extra: tr('plugins'), status: phaseStatus(plugin.fiberPhase), color: FLOW_COLORS.session })
      }
      if (mcpRows.length > 0) sections.push({ key: 'mcp', title: tr('mcp'), total: mcpRows.length, rows: mcpRows })

      return sections
    }

    const ComponentsTab = React.memo(function ComponentsTab(props) {
      const t = props.t
      const sections = React.useMemo(function () {
        return buildComponentSections(props.snapshot, props.query, t)
      }, [props.snapshot, props.query, t])
      const selection = props.selection
      const groups = []
      for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i]
        groups.push(h('div', { key: 'sec:' + section.key, className: 'da-comp-group' },
          h('div', { className: 'da-comp-head' },
            h('b', null, section.title),
            h('span', null, props.query ? String(section.rows.length) + '/' + String(section.total) : String(section.total))
          ),
          h('div', null, section.rows.map(function (row) {
            const selected = !!(selection && selection.type === row.type && String(selection.id) === String(row.id))
            return h('button', {
              key: row.type + ':' + String(row.id), type: 'button',
              className: 'da-comp-row' + (selected ? ' da-selected' : ''),
              onClick: function () { props.onSelect({ type: row.type, id: row.id }) },
              title: row.label + (row.extra ? ' · ' + row.extra : ''),
            },
              h('span', { className: 'da-dot-sm', style: { color: row.color } }),
              h('span', { className: 'da-comp-name' }, row.label),
              row.extra ? h('span', { className: 'da-comp-extra' }, row.extra) : null
            )
          }))
        ))
      }
      const totalRows = sections.reduce(function (sum, section) { return sum + section.rows.length }, 0)
      return h('div', { className: 'da-comp' },
        h('div', { className: 'da-comp-filter' },
          h('label', { className: 'da-comp-input' },
            h('span', { className: 'da-mono' }, '⌕'),
            h('input', {
              value: props.query, placeholder: t('searchPlaceholder'), 'aria-label': t('search'),
              spellCheck: false, onChange: function (event) { props.onQuery(event.target.value) },
            })
          ),
          h('span', { className: 'da-mono', style: { flex: 'none', fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } },
            fmtNum(totalRows) + ' ' + t('components'))
        ),
        h('div', { className: 'da-comp-groups da-scroll' },
          groups.length === 0 ? h(Empty, { text: props.query ? t('searchEmpty') : t('emptyComponents') }) : groups
        )
      )
    })

    function callMatches(event, groupFilter, needle, zh) {
      if (!event || typeof event !== 'object') return false
      if (groupFilter && kindGroup(event.kind) !== groupFilter) return false
      if (!needle) return true
      const label = String(event.label || '').toLowerCase()
      const detail = String(event.detail || '').toLowerCase()
      const kind = String(event.kind || '').toLowerCase()
      const from = event.organ ? domainTitle(DOMAIN_BY_ID[event.organ], zh).toLowerCase() : ''
      const to = event.target ? domainTitle(DOMAIN_BY_ID[event.target], zh).toLowerCase() : ''
      return label.indexOf(needle) >= 0 || detail.indexOf(needle) >= 0 || kind.indexOf(needle) >= 0
        || from.indexOf(needle) >= 0 || to.indexOf(needle) >= 0
    }

    const CallsTab = React.memo(function CallsTab(props) {
      const t = props.t
      const zh = props.zh
      const [groupFilter, setGroupFilter] = React.useState('')
      const [query, setQuery] = React.useState('')
      React.useEffect(function applyExternalFilter() {
        if (typeof props.filterNonce !== 'number' || !props.filterNonce) return
        if (typeof props.filterGroup === 'string') setGroupFilter(props.filterGroup)
        setQuery(typeof props.filterQuery === 'string' ? props.filterQuery : '')
      }, [props.filterNonce])
      const bodyRef = React.useRef(null)
      const events = Array.isArray(props.events) ? props.events : []
      const needle = query.trim().toLowerCase()
      const filtered = []
      let scanned = 0
      for (let i = events.length - 1; i >= 0 && filtered.length < CALL_ROWS; i -= 1) {
        scanned += 1
        if (scanned > CALL_ROWS * 6) break
        if (!callMatches(events[i], groupFilter, needle, zh)) continue
        filtered.push(events[i])
      }
      React.useEffect(function () {
        if (props.autoScroll && bodyRef.current) bodyRef.current.scrollTop = 0
      }, [props.autoScroll, events.length])
      const groupOptions = ['', 'tool', 'llm', 'session', 'fs', 'approval', 'plugin', 'error', 'other']
      const optionLabel = function (group) {
        if (!group) return t('statusAll')
        if (group === 'tool') return t('kindTool')
        if (group === 'llm') return t('kindLlm')
        if (group === 'session') return t('kindSession')
        if (group === 'fs') return t('kindFs')
        if (group === 'approval') return t('kindApproval')
        if (group === 'plugin') return t('kindPlugin')
        if (group === 'error') return t('kindError')
        return t('kindOther')
      }
      return h('div', { className: 'da-calls' },
        h('div', { className: 'da-calls-filter' },
          h('select', {
            className: 'da-select', value: groupFilter, 'aria-label': t('callKind'),
            onChange: function (event) { setGroupFilter(event.target.value) },
          }, groupOptions.map(function (group) {
            return h('option', { key: 'opt:' + (group || 'all'), value: group }, optionLabel(group))
          })),
          h('label', { className: 'da-calls-input' },
            h('span', { className: 'da-mono' }, '⌕'),
            h('input', {
              value: query, placeholder: t('filterPlaceholder'), 'aria-label': t('filterPlaceholder'),
              spellCheck: false, onChange: function (event) { setQuery(event.target.value) },
            })
          ),
          h('label', { className: 'da-auto' },
            h('input', {
              type: 'checkbox', checked: props.autoScroll === true,
              onChange: function () { props.onToggleAutoScroll(!props.autoScroll) },
            }),
            h('span', null, t('autoScroll'))
          )
        ),
        h('div', { className: 'da-calls-head' },
          h('span', { className: 'da-c-time' }, t('callTime')),
          h('span', { className: 'da-c-kind' }, t('callKind')),
          h('span', { className: 'da-c-route' }, t('callRoute')),
          h('span', { className: 'da-c-label' }, t('callLabel')),
          h('span', { className: 'da-c-ms' }, t('callMs')),
          h('span', { className: 'da-c-status' }, t('callStatus'))
        ),
        h('div', { className: 'da-calls-body da-scroll', ref: bodyRef },
          filtered.length === 0 ? h(Empty, { text: t('noData') }) : filtered.map(function (event, index) {
            const source = event.organ ? DOMAIN_BY_ID[event.organ] : null
            const target = event.target ? DOMAIN_BY_ID[event.target] : null
            const ok = event.ok !== false && event.level !== 'error'
            const selected = !!(props.selection && props.selection.type === 'event' && String(props.selection.id) === String(event.id))
            return h('button', {
              key: 'call:' + String(event.id) + ':' + String(index),
              type: 'button', className: 'da-call-row' + (selected ? ' da-selected' : ''),
              onClick: function () { props.onSelect({ type: 'event', id: event.id }) },
              title: String(event.label || '') + (event.detail ? ' — ' + String(event.detail) : ''),
            },
              h('span', { className: 'da-c-time' }, fmtClock(event.t)),
              h('span', { className: 'da-c-kind' }, h(KindChip, { kind: event.kind })),
              h('span', { className: 'da-c-route' }, (source ? domainTitle(source, zh) : String(event.organ || '?')) + (target ? ' → ' + domainTitle(target, zh) : '')),
              h('span', { className: 'da-c-label' }, String(event.label || event.kind || '')),
              h('span', { className: 'da-c-ms' }, fmtMs(event.ms)),
              h('span', { className: 'da-c-status ' + (ok ? 'da-ok' : 'da-fail') }, ok ? t('statusOk') : t('statusFail'))
            )
          })
        )
      )
    })

    /** Call timeline: one swimlane per session, LLM/tool segments as bars. */
    function TimelineTab(props) {
      const t = props.t
      const [windowMs, setWindowMs] = React.useState(60000)
      const [hovered, setHovered] = React.useState(null)
      const timeline = buildTimeline(props.events, windowMs)
      const lanes = timeline.lanes
      const segments = timeline.segments
      const ticks = [0, 0.25, 0.5, 0.75, 1]
      return h('div', { className: 'da-timeline' },
        h('div', { className: 'da-timeline-controls' },
          h('div', { className: 'da-timeline-windows' },
            h('button', {
              type: 'button', className: 'da-timeline-window' + (windowMs === 60000 ? ' da-on' : ''),
              onClick: function () { setWindowMs(60000) },
            }, t('window60')),
            h('button', {
              type: 'button', className: 'da-timeline-window' + (windowMs === 120000 ? ' da-on' : ''),
              onClick: function () { setWindowMs(120000) },
            }, t('window120'))
          ),
          h('span', { className: 'da-mono', style: { fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } },
            t('timelineSessions') + ' ' + fmtNum(lanes.length) + ' · ' + t('timelineSegments') + ' ' + fmtNum(segments.length))
        ),
        lanes.length === 0
          ? h(Empty, { text: t('timelineEmpty') })
          : h('div', { className: 'da-timeline-body da-scroll' },
            h('div', { className: 'da-timeline-ruler' },
              h('span', { className: 'da-timeline-lane-label' }, ''),
              h('div', { className: 'da-timeline-track' }, ticks.map(function (tick, index) {
                const at = timeline.cutoff + (timeline.now - timeline.cutoff) * tick
                return h('span', { key: 'tick:' + index, className: 'da-timeline-tick', style: { left: (tick * 100) + '%' } }, fmtClock(at))
              }))
            ),
            lanes.map(function (lane) {
              return h('div', { key: 'lane:' + lane.sessionId, className: 'da-timeline-lane' },
                h('span', { className: 'da-timeline-lane-label', title: lane.sessionId }, lane.sessionId),
                h('div', { className: 'da-timeline-track' },
                  lane.segments.map(function (segment, index) {
                    const left = timelinePct(segment.start, timeline.cutoff, timeline.now) * 100
                    const right = timelinePct(segment.end, timeline.cutoff, timeline.now) * 100
                    const width = Math.max(0.6, right - left)
                    const isLlm = segment.kind === 'llm'
                    const hoverKey = lane.sessionId + ':' + index
                    const isHovered = !!(hovered && hovered.key === hoverKey)
                    return h('button', {
                      key: 'seg:' + index, type: 'button',
                      className: 'da-timeline-bar ' + (isLlm ? 'da-timeline-llm' : 'da-timeline-tool')
                        + (segment.ok ? '' : ' da-timeline-error') + (isHovered ? ' da-hovered' : ''),
                      style: { left: left + '%', width: width + '%' },
                      title: (isLlm ? t('timelineLlm') : t('timelineTool')) + ' · ' + segment.label + ' · ' + fmtMs(segment.ms),
                      onMouseEnter: function () { setHovered({ key: hoverKey, segment: segment }) },
                      onMouseLeave: function () { setHovered(null) },
                      onClick: function () { props.onSelect({ type: 'event', id: segment.eventId }) },
                    })
                  })
                )
              )
            })
          ),
        hovered ? h('div', { className: 'da-timeline-tip' },
          h('span', { className: 'da-timeline-tip-kind' }, hovered.segment.kind === 'llm' ? t('timelineLlm') : t('timelineTool')),
          h('span', { className: 'da-timeline-tip-label' }, hovered.segment.label),
          h('span', { className: 'da-mono' }, fmtMs(hovered.segment.ms)),
          h('span', { className: 'da-mono' }, fmtClock(hovered.segment.start) + ' → ' + fmtClock(hovered.segment.end)),
          hovered.segment.ongoing ? h('span', { className: 'da-timeline-tip-kind' }, t('timelineOngoing')) : null
        ) : null
      )
    }

    function BottomConsole(props) {
      const t = props.t
      const tabs = [
        { id: 'metrics', label: t('tabMetrics'), count: null },
        {
          id: 'components',
          label: t('tabComponents'),
          count: props.snapshot && props.snapshot.counts
            ? num(props.snapshot.counts.plugins) + num(props.snapshot.counts.services) + num(props.snapshot.counts.tools)
            : null,
        },
        { id: 'calls', label: t('tabCalls'), count: props.events ? props.events.length : null },
        { id: 'timeline', label: t('tabTimeline'), count: null },
      ]
      let body = null
      if (props.tab === 'timeline') {
        body = h(TimelineTab, { t: t, events: props.events, onSelect: props.onSelect })
      } else if (props.tab === 'components') {
        body = h(ComponentsTab, {
          t: t, snapshot: props.snapshot, query: props.componentQuery,
          onQuery: props.onComponentQuery, selection: props.selection, onSelect: props.onSelect,
        })
      } else if (props.tab === 'calls') {
        body = h(CallsTab, {
          t: t, zh: props.zh, events: props.events, selection: props.selection,
          onSelect: props.onSelect, autoScroll: props.autoScroll, onToggleAutoScroll: props.onToggleAutoScroll,
          filterQuery: props.filterQuery, filterGroup: props.filterGroup, filterNonce: props.filterNonce,
        })
      } else {
        body = h(MetricsTab, { t: t, snapshot: props.snapshot, live: props.live, toolMetrics: props.toolMetrics, spark: props.spark })
      }
      return h('div', {
        className: 'da-console',
        onWheel: function (event) { if (event && typeof event.stopPropagation === 'function') event.stopPropagation() },
      },
        h('div', { className: 'da-tabs', role: 'tablist' },
          tabs.map(function (tab) {
            return h('button', {
              key: tab.id, type: 'button', role: 'tab', 'aria-selected': props.tab === tab.id,
              className: 'da-tab' + (props.tab === tab.id ? ' da-tab-on' : ''),
              onClick: function () { props.onTab(tab.id) },
            },
              tab.label,
              tab.count !== null ? h('span', { className: 'da-tab-count' }, fmtNum(tab.count)) : null
            )
          }),
          h('div', { className: 'da-tab-aux' },
            h('span', { className: 'da-mono', style: { fontSize: '9.5px', color: 'var(--dsw-alias-label-secondary)' } },
              t('totalEvents') + ' ' + fmtNum(props.eventTotal || 0)),
            h('span', { className: 'da-dot-sm', style: { color: props.conn === 'live' ? 'var(--dsw-alias-state-success-primary, #3ddc97)' : 'var(--dsw-alias-state-warn-primary, #ffc04d)' } })
          )
        ),
        h('div', { className: 'da-tab-body' }, body)
      )
    }
    // ---------------------------------------------------------------------
    // Search index, page orchestration (Hud), error boundary and slot apply.
    // ---------------------------------------------------------------------

    /** Search across domains, plugins, services, tools, client bundles and models. */
    function buildSearchResults(snapshot, query, t, zh) {
      const needle = String(query || '').trim().toLowerCase()
      if (!needle || !snapshot || typeof snapshot !== 'object') return []
      const match = function (value) {
        return String(value === undefined || value === null ? '' : value).toLowerCase().indexOf(needle) >= 0
      }
      const out = []
      const views = nodeViews(snapshot.organs)
      for (let i = 0; i < views.length && out.length < 30; i += 1) {
        const node = views[i]
        if (!match(node.id) && !match(node.zh) && !match(node.en)) continue
        out.push({
          type: 'domain', id: node.id, label: domainTitle(node, zh), sub: node.layer,
          typeLabel: t('selectedDomain'), color: statusColorHex(node.status || 'idle', null),
        })
      }
      const plugins = Array.isArray(snapshot.plugins) ? snapshot.plugins : []
      for (let i = 0; i < plugins.length && out.length < 30; i += 1) {
        const plugin = plugins[i]
        if (!plugin) continue
        if (!match(plugin.name) && !match(plugin.title) && !match(plugin.entryId)) continue
        out.push({
          type: 'plugin', id: plugin.entryId || plugin.name,
          label: String(plugin.title || plugin.name || plugin.entryId),
          sub: String(plugin.bundle || plugin.kind || ''), typeLabel: t('selectedPlugin'), color: FLOW_COLORS.session,
        })
      }
      const services = Array.isArray(snapshot.services) ? snapshot.services : []
      for (let i = 0; i < services.length && out.length < 30; i += 1) {
        const service = services[i]
        if (!service || !match(service.name)) continue
        out.push({
          type: 'service', id: service.name, label: String(service.name),
          sub: String(service.provider || service.organ || ''), typeLabel: t('selectedService'), color: FLOW_COLORS.plugin,
        })
      }
      const tools = Array.isArray(snapshot.tools) ? snapshot.tools : []
      for (let i = 0; i < tools.length && out.length < 30; i += 1) {
        const tool = tools[i]
        if (!tool || !match(tool.name)) continue
        out.push({
          type: 'tool', id: tool.name, label: String(tool.name), sub: String(tool.organ || ''),
          typeLabel: t('selectedTool'), color: FLOW_COLORS.tool,
        })
      }
      const bundles = Array.isArray(snapshot.clientBundles) ? snapshot.clientBundles : []
      for (let i = 0; i < bundles.length && out.length < 30; i += 1) {
        const bundle = bundles[i]
        if (!bundle || (!match(bundle.id) && !match(bundle.title))) continue
        out.push({
          type: 'clientBundle', id: bundle.id || bundle.title, label: String(bundle.title || bundle.id),
          sub: 'client bundle', typeLabel: t('selectedClientBundle'), color: FLOW_COLORS.other,
        })
      }
      const models = snapshot.models && typeof snapshot.models === 'object' && Array.isArray(snapshot.models.models) ? snapshot.models.models : []
      for (let i = 0; i < models.length && out.length < 30; i += 1) {
        const model = models[i]
        if (!model) continue
        const key = String(model.provider) + '/' + String(model.id)
        if (!match(key) && !match(model.name) && !match(model.id) && !match(model.provider)) continue
        out.push({
          type: 'model', id: key, label: String(model.name || model.id), sub: String(model.provider || ''),
          typeLabel: t('selectedModel'), color: FLOW_COLORS.other,
        })
      }
      return out
    }

    /** Canvas node table for the particle engine (diagram position + orbit size). */
    function toEngineNodes(nodes) {
      const list = Array.isArray(nodes) ? nodes : []
      const out = []
      for (let i = 0; i < list.length; i += 1) {
        const node = list[i]
        if (!node || !node.id) continue
        out.push({ id: node.id, x: node.x, y: node.y, size: NODE_ENGINE_SIZE })
      }
      return out
    }

    function Hud(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const [conn, setConn] = React.useState('connecting')
      const [paused, setPaused] = React.useState(false)
      const [snapshot, setSnapshot] = React.useState(null)
      const [events, setEvents] = React.useState([])
      const [live, setLive] = React.useState(null)
      const [orgMetrics, setOrgMetrics] = React.useState({})
      const [toolMetrics, setToolMetrics] = React.useState({})
      const [diag, setDiag] = React.useState(null)
      const [heat, setHeat] = React.useState({})
      const [spark, setSpark] = React.useState([])
      const [selection, setSelection] = React.useState(null)
      const [historyDepth, setHistoryDepth] = React.useState(0)
      const [tab, setTab] = React.useState('metrics')
      const [railCollapsed, setRailCollapsed] = React.useState(false)
      const [drawerCollapsed, setDrawerCollapsed] = React.useState(false)
      const [pageWidth, setPageWidth] = React.useState(0)
      const [search, setSearch] = React.useState('')
      const [componentQuery, setComponentQuery] = React.useState('')
      const [autoScroll, setAutoScroll] = React.useState(true)
      const [eventTotal, setEventTotal] = React.useState(0)
      const [flowTick, setFlowTick] = React.useState(0)
      const [view, setView] = React.useState('domains')
      const [hover, setHover] = React.useState(null)
      const [helpOpen, setHelpOpen] = React.useState(false)
      const [hoveredEdge, setHoveredEdge] = React.useState(null)
      const [logFilter, setLogFilter] = React.useState({ query: '', group: '', nonce: 0 })
      const [isDark, setIsDark] = React.useState(function () { return resolveThemeDark(props.anatomyTheme) })
      const [snapshotLite, setSnapshotLite] = React.useState(false)
      const [lastEventAt, setLastEventAt] = React.useState(0)
      const [sessionFilter, setSessionFilter] = React.useState('')
      const [firstFrameMs, setFirstFrameMs] = React.useState(0)
      const [detailMs, setDetailMs] = React.useState(0)
      const [stageReady, setStageReady] = React.useState(false)
      const [panelsReady, setPanelsReady] = React.useState(function () {
        return typeof requestAnimationFrame !== 'function'
      })

      const rootRef = React.useRef(null)
      const selectionRef = React.useRef(null)
      const historyRef = React.useRef([])
      const eventsRef = React.useRef([])
      const pausedRef = React.useRef(false)
      const heatRef = React.useRef(Object.create(null))
      const apiRef = React.useRef(null)
      const bufferRef = React.useRef({ eventsDirty: false, metrics: null, orgMetrics: null, toolMetrics: null, snapshot: null })
      const flushTimerRef = React.useRef(0)
      const lastEventIdRef = React.useRef(-1)
      const mountedRef = React.useRef(true)
      const eventTotalRef = React.useRef(0)
      const prevWidthRef = React.useRef(0)
      const snapshotStateRef = React.useRef({ snapshot: null, fullSnapshot: false, lite: false })
      const lastEventAtRef = React.useRef(0)
      const mountAtRef = React.useRef(Date.now())

      const flushNow = React.useCallback(function flushNow() {
        if (!mountedRef.current) return
        const buffer = bufferRef.current
        if (buffer.snapshot) {
          const snap = buffer.snapshot
          buffer.snapshot = null
          const applied = applySnapshotState(snapshotStateRef.current, snap)
          snapshotStateRef.current = applied.state
          if (applied.changed) {
            setSnapshot(applied.state.snapshot)
            setSnapshotLite(applied.state.lite === true && applied.state.fullSnapshot !== true)
          }
          const effective = applied.state.snapshot || snap
          if (effective.live && typeof effective.live === 'object') buffer.metrics = buffer.metrics || effective.live
          if (effective.orgMetrics && typeof effective.orgMetrics === 'object') buffer.orgMetrics = buffer.orgMetrics || effective.orgMetrics
          if (effective.toolMetrics && typeof effective.toolMetrics === 'object') buffer.toolMetrics = buffer.toolMetrics || effective.toolMetrics
          if (effective.counts && typeof effective.counts.eventsTotal === 'number') {
            eventTotalRef.current = Math.max(eventTotalRef.current, num(effective.counts.eventsTotal))
            setEventTotal(eventTotalRef.current)
          }
        }
        if (buffer.eventsDirty) {
          buffer.eventsDirty = false
          setEvents(eventsRef.current.slice())
          setEventTotal(eventTotalRef.current)
          setLastEventAt(lastEventAtRef.current)
        }
        if (buffer.metrics) {
          const metrics = buffer.metrics
          buffer.metrics = null
          setLive(metrics)
          const sample = clamp01(
            (num(metrics.llmCallsPerMin) / 14) * 0.62
            + (num(metrics.eventsPerSec) / 7) * 0.3
            + (num(metrics.errorsPerMin) / 9) * 0.08
          )
          setSpark(function (previous) {
            const next = previous.length >= SPARK_SAMPLES ? previous.slice(previous.length - (SPARK_SAMPLES - 1)) : previous.slice()
            next.push(sample)
            return next
          })
        }
        if (buffer.orgMetrics) {
          setOrgMetrics(buffer.orgMetrics)
          buffer.orgMetrics = null
        }
        if (buffer.toolMetrics) {
          setToolMetrics(buffer.toolMetrics)
          buffer.toolMetrics = null
        }
        // Decay the transient node heat that event bursts injected.
        const previousHeat = heatRef.current
        const heatKeys = Object.keys(previousHeat)
        if (heatKeys.length > 0) {
          const nextHeat = {}
          for (let i = 0; i < heatKeys.length; i += 1) {
            const value = previousHeat[heatKeys[i]] * 0.82
            if (value > 0.02) nextHeat[heatKeys[i]] = value
          }
          heatRef.current = nextHeat
          setHeat(nextHeat)
        }
      }, [])

      const scheduleFlush = React.useCallback(function scheduleFlush() {
        if (flushTimerRef.current) return
        flushTimerRef.current = setTimeout(function () {
          flushTimerRef.current = 0
          flushNow()
        }, FLUSH_MS)
      }, [flushNow])

      React.useEffect(function mountController() {
        mountedRef.current = true
        const buffer = bufferRef.current
        const controller = createController({
          onConn: function (next) {
            if (mountedRef.current) setConn(next)
          },
          onDiag: function (next) {
            if (mountedRef.current) setDiag(next)
          },
          onSnapshot: function (snap) {
            if (!mountedRef.current || !snap || typeof snap !== 'object') return
            // Host/plugin restart: sequence regression means the old id window
            // is meaningless, otherwise the dedupe filter would drop everything.
            const snapshotSeq = typeof snap.seq === 'number' && Number.isFinite(snap.seq) ? snap.seq : null
            if (snapshotSeq !== null && snapshotSeq < lastEventIdRef.current) {
              eventsRef.current = []
              lastEventIdRef.current = snapshotSeq
              eventTotalRef.current = num(snap.counts && snap.counts.eventsTotal)
              buffer.eventsDirty = true
            }
            buffer.snapshot = snap
            scheduleFlush()
          },
          onReset: function () {
            if (!mountedRef.current) return
            eventsRef.current = []
            lastEventIdRef.current = -1
            eventTotalRef.current = 0
            buffer.eventsDirty = true
            scheduleFlush()
          },
          onEvents: function (frame) {
            if (!mountedRef.current || !frame || typeof frame !== 'object') return
            const incoming = Array.isArray(frame.events) ? frame.events : []
            const accepted = []
            for (let i = 0; i < incoming.length; i += 1) {
              const event = incoming[i]
              if (!event || typeof event !== 'object') continue
              const id = Number(event.id)
              if (Number.isFinite(id)) {
                if (id <= lastEventIdRef.current) continue
                lastEventIdRef.current = id
              }
              accepted.push(event)
            }
            if (accepted.length > 0) lastEventAtRef.current = Date.now()
            if (accepted.length > 0) {
              const list = eventsRef.current
              for (let i = 0; i < accepted.length; i += 1) list.push(accepted[i])
              if (list.length > MAX_EVENTS + 100) list.splice(0, list.length - MAX_EVENTS)
              buffer.eventsDirty = true
              eventTotalRef.current += accepted.length
              if (!pausedRef.current) {
                const api = apiRef.current
                if (api) api.push(accepted)
              }
              for (let i = 0; i < accepted.length; i += 1) {
                const event = accepted[i]
                if (event.organ) heatRef.current[event.organ] = Math.min(1, num(heatRef.current[event.organ]) + 0.3)
                if (event.target) heatRef.current[event.target] = Math.min(1, num(heatRef.current[event.target]) + 0.2)
              }
            }
            if (frame.metrics && typeof frame.metrics === 'object') buffer.metrics = frame.metrics
            if (frame.orgMetrics && typeof frame.orgMetrics === 'object') buffer.orgMetrics = frame.orgMetrics
            if (frame.toolMetrics && typeof frame.toolMetrics === 'object') buffer.toolMetrics = frame.toolMetrics
            scheduleFlush()
          },
        })
        controller.start()
        return function unmountController() {
          mountedRef.current = false
          controller.dispose()
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current)
            flushTimerRef.current = 0
          }
          if (bufferRef.current) {
            bufferRef.current.eventsDirty = false
            bufferRef.current.metrics = null
            bufferRef.current.snapshot = null
          }
        }
      }, [scheduleFlush])

      React.useEffect(function syncPaused() {
        pausedRef.current = paused
        const api = apiRef.current
        if (api) api.setPaused(paused)
      }, [paused])

      React.useEffect(function subscribeTheme() {
        const themeApi = props.anatomyTheme
        if (!themeApi || typeof themeApi.subscribe !== 'function') return undefined
        let off = null
        try {
          off = themeApi.subscribe(function () {
            setIsDark(resolveThemeDark(themeApi))
            const api = apiRef.current
            if (api) api.refreshTheme()
          })
        } catch (error) {
          off = null
        }
        return function () {
          if (typeof off === 'function') {
            try {
              off()
            } catch (error) {
              // ignore
            }
          }
        }
      }, [props.anatomyTheme])

      // Theme mode (light surfaces for the drawer + console cards). Falls back
      // to observing the host document attributes when no theme API exists.
      React.useEffect(function themeModeWatch() {
        setIsDark(resolveThemeDark(props.anatomyTheme))
        if (typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.documentElement) return undefined
        const observer = new MutationObserver(function () {
          setIsDark(resolveThemeDark(props.anatomyTheme))
        })
        try {
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-ds-dark-theme', 'data-dark-theme', 'data-theme', 'data-color-scheme', 'class', 'style'],
          })
        } catch (error) {
          return undefined
        }
        return function () {
          try { observer.disconnect() } catch (error) { /* ignore */ }
        }
      }, [props.anatomyTheme])

      // The 60s flow window must drain even when no new frames arrive.
      React.useEffect(function flowClock() {
        const timer = setInterval(function () {
          if (mountedRef.current) setFlowTick(function (previous) { return previous + 1 })
        }, 5000)
        return function () { clearInterval(timer) }
      }, [])

      React.useEffect(function observeWidth() {
        const node = rootRef.current
        if (!node) return undefined
        const applyWidth = function (nextWidth) {
          if (!mountedRef.current) return
          const width = Math.round(num(nextWidth))
          if (width <= 0) return
          setPageWidth(width)
          const previous = prevWidthRef.current
          if (previous === 0) {
            if (width < 1100) setDrawerCollapsed(true)
            if (width < 900) setRailCollapsed(true)
          } else {
            if (previous >= 1100 && width < 1100) setDrawerCollapsed(true)
            if (previous < 1100 && width >= 1100) setDrawerCollapsed(false)
            if (previous >= 900 && width < 900) setRailCollapsed(true)
            if (previous < 900 && width >= 900) setRailCollapsed(false)
          }
          prevWidthRef.current = width
        }
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(function (entries) {
            if (entries && entries.length > 0 && entries[0] && entries[0].contentRect) applyWidth(entries[0].contentRect.width)
            else {
              const rect = safe(function () { return node.getBoundingClientRect() }, null)
              if (rect) applyWidth(rect.width)
            }
          })
          observer.observe(node)
          return function () {
            try {
              observer.disconnect()
            } catch (error) {
              // ignore
            }
          }
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          const onResize = function () {
            const rect = safe(function () { return node.getBoundingClientRect() }, null)
            if (rect) applyWidth(rect.width)
          }
          window.addEventListener('resize', onResize)
          onResize()
          return function () {
            window.removeEventListener('resize', onResize)
          }
        }
        return undefined
      }, [])

      const zh = isZhLocale(t)
      const sessionList = React.useMemo(function () {
        return deriveSessions(snapshot, events)
      }, [snapshot, events])
      React.useEffect(function fallbackSessionFilter() {
        if (!sessionFilter) return
        let found = false
        for (let i = 0; i < sessionList.length; i += 1) if (sessionList[i].id === sessionFilter) { found = true; break }
        if (!found) setSessionFilter('')
      }, [sessionFilter, sessionList])
      const filteredEvents = React.useMemo(function () {
        return filterEventsBySession(events, sessionFilter)
      }, [events, sessionFilter, flowTick])
      const sessionLive = React.useMemo(function () {
        return deriveSessionMetrics(filteredEvents, FLOW_WINDOW_MS)
      }, [filteredEvents, flowTick])
      const effectiveLive = sessionFilter ? sessionLive : live
      const recentEventCount = React.useMemo(function () {
        const cutoff = Date.now() - FLOW_WINDOW_MS
        let total = 0
        for (let i = 0; i < filteredEvents.length; i += 1) {
          const at = num(filteredEvents[i] && filteredEvents[i].t)
          if (!(at > 0) || at >= cutoff) total += 1
        }
        return total
      }, [filteredEvents, flowTick])
      const nodes = React.useMemo(function () {
        const views = nodeViews(snapshot && snapshot.organs ? snapshot.organs : null)
        const examples = buildNodeExamples(snapshot)
        for (let i = 0; i < views.length; i += 1) views[i].examples = examples[views[i].id] || []
        return views
      }, [snapshot])
      const runtime = snapshot && snapshot.runtime && typeof snapshot.runtime === 'object' ? snapshot.runtime : null
      const flows = React.useMemo(function () {
        return computeFlows(filteredEvents, FLOW_WINDOW_MS)
      }, [filteredEvents, flowTick])
      const toolFlows = React.useMemo(function () {
        return computeToolFlows(filteredEvents, snapshot && Array.isArray(snapshot.tools) ? snapshot.tools : [], FLOW_WINDOW_MS)
      }, [filteredEvents, flowTick, snapshot])
      const toolNodes = React.useMemo(function () {
        return buildToolView(snapshot, toolFlows)
      }, [snapshot, toolFlows])
      const activeNode = hover || (selection ? { type: selection.type, id: selection.id } : null)
      const activeKey = activeNode ? String(activeNode.type) + ':' + String(activeNode.id) : ''
      const callDetailRows = React.useMemo(function () {
        if (!activeNode) return []
        if (activeNode.type === 'domain') return computeDomainCallDetail(filteredEvents, activeNode.id, FLOW_WINDOW_MS, 8)
        if (activeNode.type === 'tool') return computeToolCallDetail(toolFlows, activeNode.id, zh, 6)
        return []
      }, [activeKey, filteredEvents, flowTick, toolFlows, zh])
      const callDetailTitle = React.useMemo(function () {
        if (!activeNode) return ''
        const prefix = t('callDetailTitle')
        if (activeNode.type === 'domain') {
          const def = DOMAIN_BY_ID[activeNode.id]
          return (def ? domainTitle(def, zh) : String(activeNode.id)) + ' · ' + prefix
        }
        return String(activeNode.id) + ' · ' + prefix
      }, [activeKey, t, zh])
      const callDetailTotal = callDetailRows.reduce(function (sum, row) { return sum + num(row.count) }, 0)
      const callActive = !!(activeNode && (activeNode.type === 'domain' || activeNode.type === 'tool'))
      const searchResults = React.useMemo(function () {
        return buildSearchResults(snapshot, search, t, zh)
      }, [snapshot, search, t, zh])

      const openDrawer = React.useCallback(function () {
        setDrawerCollapsed(false)
      }, [])

      // Detail navigation history: every selection change pushes the previous
      // one so the drawer can go back one level. The view mode is untouched.
      const navigateSelection = React.useCallback(function (next) {
        if (!next || typeof next !== 'object') return
        const previous = selectionRef.current
        if (previous && previous.type === next.type && previous.id === next.id) {
          openDrawer()
          return
        }
        if (previous) {
          historyRef.current = historyRef.current.concat([previous]).slice(-20)
          setHistoryDepth(historyRef.current.length)
        }
        selectionRef.current = next
        setSelection(next)
        openDrawer()
      }, [openDrawer])

      const goBackSelection = React.useCallback(function () {
        const stack = historyRef.current.slice()
        if (stack.length === 0) {
          selectionRef.current = null
          setSelection(null)
          return
        }
        const previous = stack.pop()
        historyRef.current = stack
        setHistoryDepth(stack.length)
        selectionRef.current = previous
        setSelection(previous)
      }, [])

      const selectDomain = React.useCallback(function (domainId) {
        if (!domainId) return
        navigateSelection({ type: 'domain', id: domainId })
      }, [navigateSelection])

      const selectAny = React.useCallback(function (next) {
        if (!next || typeof next !== 'object' || !next.type) return
        if (next.type !== 'event' && (next.id === undefined || next.id === null || next.id === '')) return
        navigateSelection({ type: next.type, id: next.id })
      }, [navigateSelection])

      const selectResult = React.useCallback(function (result) {
        if (!result || !result.type) return
        navigateSelection({ type: result.type, id: result.id })
      }, [navigateSelection])

      const selectEvent = React.useCallback(function (eventId) {
        navigateSelection({ type: 'event', id: eventId })
      }, [navigateSelection])

      const selectTool = React.useCallback(function (toolName) {
        if (!toolName) return
        navigateSelection({ type: 'tool', id: toolName })
      }, [navigateSelection])

      const setHoveredEdgeSafe = React.useCallback(function (key) {
        setHoveredEdge(key ? { key: String(key) } : null)
      }, [])

      const selectEdge = React.useCallback(function (next) {
        if (!next || !next.from || !next.to) return
        const mode = next.mode === 'tool' ? 'tool' : 'domain'
        navigateSelection({ type: 'edge', from: String(next.from), to: String(next.to), mode: mode, id: String(next.from) + '>' + String(next.to) })
      }, [navigateSelection])

      const filterLog = React.useCallback(function (query) {
        setLogFilter({ query: String(query || ''), group: '', nonce: Date.now() })
        setTab('calls')
      }, [])

      const setViewMode = React.useCallback(function (next) {
        setView(next === 'tools' ? 'tools' : 'domains')
        setHover(null)
      }, [])

      const setHovered = React.useCallback(function (next) {
        if (!next || !next.type || next.id === undefined || next.id === null || next.id === '') {
          setHover(null)
          return
        }
        setHover({ type: next.type, id: next.id })
      }, [])

      const hoverDomain = React.useCallback(function (domainId) {
        setHover(domainId ? { type: 'domain', id: domainId } : null)
      }, [])

      const toggleHelp = React.useCallback(function () {
        setHelpOpen(function (previous) { return !previous })
      }, [])

      // Esc closes the interaction-help dialog and clears the current selection.
      React.useEffect(function globalEscape() {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onKeyDown = function (event) {
          if (!event || (event.key !== 'Escape' && event.key !== 'Esc')) return
          setHelpOpen(false)
          historyRef.current = []
          setHistoryDepth(0)
          selectionRef.current = null
          setSelection(null)
        }
        document.addEventListener('keydown', onKeyDown)
        return function () {
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [])

      const clearSelection = React.useCallback(function () {
        historyRef.current = []
        setHistoryDepth(0)
        selectionRef.current = null
        setSelection(null)
      }, [])

      const togglePause = React.useCallback(function () {
        setPaused(function (previous) { return !previous })
      }, [])

      // First-paint timing: panel mount → stage first frame, and → full snapshot.
      const onStageReady = React.useCallback(function () {
        setFirstFrameMs(function (previous) {
          return previous > 0 ? previous : Math.max(1, Date.now() - mountAtRef.current)
        })
        setStageReady(true)
      }, [])

      React.useEffect(function detailTiming() {
        if (!snapshot || snapshotLite) return
        setDetailMs(function (previous) {
          return previous > 0 ? previous : Math.max(1, Date.now() - mountAtRef.current)
        })
      }, [snapshot, snapshotLite])

      React.useEffect(function deferredPanels() {
        if (!stageReady || snapshotLite) {
          setPanelsReady(false)
          return undefined
        }
        let handle = 0
        if (typeof requestAnimationFrame === 'function') {
          handle = requestAnimationFrame(function () { setPanelsReady(true) })
          return function () { cancelAnimationFrame(handle) }
        }
        handle = setTimeout(function () { setPanelsReady(true) }, 16)
        return function () { clearTimeout(handle) }
      }, [stageReady, snapshotLite])

      const narrow = pageWidth > 0 && pageWidth < 1100
      const veryNarrow = pageWidth > 0 && pageWidth < 900

      return h('div', {
        ref: rootRef,
        className: 'da-root' + (paused ? ' da-paused' : '') + (narrow ? ' da-narrow' : '') + (veryNarrow ? ' da-very-narrow' : '') + (isDark ? '' : ' da-light'),
      },
        h('style', null, CSS_TEXT),
        h(Header, {
          t: t, conn: conn, paused: paused, runtime: runtime, eventCount: filteredEvents.length,
          paintLabel: formatPaintTimings(firstFrameMs, detailMs, t) || t('firstPaintPending'),
          railCollapsed: railCollapsed, drawerCollapsed: drawerCollapsed,
          view: view, onView: setViewMode, helpOpen: helpOpen, onHelp: toggleHelp,
          onTogglePause: togglePause,
          sessions: sessionList, sessionFilter: sessionFilter,
          onSessionFilter: function (next) { setSessionFilter(String(next || '')) },
          onToggleRail: function () { setRailCollapsed(function (previous) { return !previous }) },
          onToggleDrawer: function () { setDrawerCollapsed(function (previous) { return !previous }) },
        }),
        h('div', { className: 'da-main' },
          h(DomainRail, {
            t: t, zh: zh, nodes: nodes, heat: heat, flowNodes: flows.nodes,
            selection: selection, search: search, results: searchResults, collapsed: railCollapsed,
            onSearch: function (value) { setSearch(String(value || '')) },
            onSelectDomain: selectDomain, onSelectResult: selectResult,
          }),
          h(Stage, {
            t: t, zh: zh, nodes: nodes, heat: heat, flows: flows, selection: selection,
            snapshot: snapshot, theme: props.anatomyTheme, apiRef: apiRef, paused: paused,
            eventCount: recentEventCount, view: view, toolNodes: toolNodes, toolFlows: toolFlows, conn: conn,
            snapshotLite: snapshotLite, lastEventAt: lastEventAt,
            firstFrameMs: firstFrameMs, detailMs: detailMs,
            hover: hover, callRows: callDetailRows, callTitle: callDetailTitle, callTotal: callDetailTotal,
            callActive: callActive, hoverEdge: hoveredEdge,
            onSelectDomain: selectDomain, onSelectTool: selectTool,
            onHover: setHovered, onHoverDomain: hoverDomain,
            onSelectEdge: selectEdge, onHoverEdge: setHoveredEdgeSafe,
            onView: setViewMode,
            onClearSelection: clearSelection,
            onStageReady: onStageReady,
          }),
          panelsReady ? h(DetailDrawer, {
            t: t, zh: zh, snapshot: snapshot, events: filteredEvents, live: effectiveLive, orgMetrics: orgMetrics,
            toolMetrics: toolMetrics, diag: diag, nodes: nodes, heat: heat, flows: flows, toolFlows: toolFlows,
            selection: selection, collapsed: drawerCollapsed, isDark: isDark,
            onSelect: selectAny, onSelectEvent: selectEvent, onClear: clearSelection,
            onFilterLog: filterLog,
            onTab: function (next) { setTab(next) },
            onBack: goBackSelection,
            historyDepth: historyDepth,
            breadcrumb: selectionBreadcrumb(selection, view, t),
            backLabel: selectionBackLabel(selection, view, historyDepth, t),
          }) : null
        ),
        panelsReady ? h(BottomConsole, {
          t: t, zh: zh, tab: tab, snapshot: snapshot, events: filteredEvents, live: effectiveLive, spark: spark,
          toolMetrics: toolMetrics, selection: selection, componentQuery: componentQuery,
          autoScroll: autoScroll, eventTotal: filteredEvents.length, conn: conn,
          filterQuery: logFilter.query, filterGroup: logFilter.group, filterNonce: logFilter.nonce,
          onTab: function (next) { setTab(next) },
          onComponentQuery: function (value) { setComponentQuery(String(value || '')) },
          onToggleAutoScroll: function (next) { setAutoScroll(next === true) },
          onSelect: selectAny,
        }) : null,
        h(HelpOverlay, { t: t, open: helpOpen, onClose: function () { setHelpOpen(false) } })
      )
    }

    // ---------------------------------------------------------------------
    // Error boundary + slot entry.
    // ---------------------------------------------------------------------

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
        this.handleRetry = this.handleRetry.bind(this)
      }

      static getDerivedStateFromError(error) {
        return { error: error || new Error('unknown view error') }
      }

      componentDidCatch(error) {
        try {
          if (typeof console !== 'undefined' && console.error) console.error('[dsh-anatomy] view render failed:', error)
        } catch (ignored) {
          // never throw from the boundary
        }
      }

      handleRetry() {
        this.setState({ error: null })
      }

      render() {
        const t = this.props && typeof this.props.t === 'function' ? this.props.t : fallbackT
        const error = this.state ? this.state.error : null
        if (!error) return this.props ? this.props.children : null
        const message = error && error.message ? String(error.message) : String(error)
        return h('div', { className: 'da-root' },
          h('style', null, CSS_TEXT),
          h('div', { className: 'da-error' },
            h('div', { className: 'da-error-icon' }, '⚠'),
            h('div', { className: 'da-error-title' }, t('crashTitle')),
            h('div', { className: 'da-error-msg' }, message),
            h('div', { className: 'da-error-hint' }, t('crashHint')),
            h('button', { type: 'button', className: 'da-btn', onClick: this.handleRetry },
              h(PlayPauseIcon, { paused: true, size: 10 }), ' ' + t('retry'))
          )
        )
      }
    }

    const ANATOMY_TAB_ID = 'dsh-anatomy:architecture'
    const ANATOMY_TAB_KIND = 'anatomy'
    const RIGHT_RECENT_LIMIT = 5

    /** Small inline architecture glyph (header button + tab title). */
    function ArchitectureGlyph(props) {
      const size = props && props.size ? num(props.size) : 15
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
        h('rect', { x: 1.5, y: 2, width: 4.2, height: 4, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
        h('rect', { x: 10.3, y: 2, width: 4.2, height: 4, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
        h('rect', { x: 5.9, y: 10, width: 4.2, height: 4, rx: 1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 }),
        h('path', { d: 'M5.7 4h4.6M3.6 6v3.2h4.4M12.4 6v3.2H8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' })
      )
    }

    /** Session-header corner button: open/refocus the architecture tab. */
    function OpenButton(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackT
      const right = props && props.sidebarRight ? props.sidebarRight : null
      return h('button', {
        type: 'button',
        className: 'da-open-btn',
        title: t('openPanel'),
        'aria-label': t('openPanel'),
        onClick: function () { ensureAnatomyTab(right, ANATOMY_TAB_KIND) },
      }, h(ArchitectureGlyph, { size: 15 }))
    }

    /** Chip title for the right-sidebar tab (icon + label). */
    function AnatomyTabTitle(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackT
      return h('span', { className: 'da-tab-title' }, h(ArchitectureGlyph, { size: 13 }), t('panel'))
    }

    /** Presentational compact right-sidebar panel (harness-renderable). */
    function CompactPanelView(props) {
      const t = props.t || fallbackT
      const zh = props.zh !== false
      const compact = props.compact !== false
      const events = Array.isArray(props.events) ? props.events : []
      const nodes = Array.isArray(props.nodes) ? props.nodes : []
      const flows = props.flows && typeof props.flows === 'object' ? props.flows : { pairs: {}, nodes: {} }
      const sessions = Array.isArray(props.sessions) ? props.sessions : []
      const metrics = props.metrics && typeof props.metrics === 'object' ? props.metrics : {}
      const status = props.status && typeof props.status === 'object' ? props.status : { key: 'waiting', labelKey: 'statusWaiting' }
      const selected = props.selectedDomain ? nodes.find(function (node) { return node.id === props.selectedDomain }) : null
      const recent = events.slice(-RIGHT_RECENT_LIMIT).reverse()
      const sessionTitleOf = function (id) {
        for (let i = 0; i < sessions.length; i += 1) if (sessions[i].id === id) return sessions[i].title || String(id).slice(0, 8)
        return String(id || '').slice(0, 8)
      }
      const stage = props.snapshot
        ? h('div', { className: 'da-rp-stage' },
            h(ArchitectureSvg, {
              t: t, zh: zh, nodes: nodes, heat: {}, flows: flows, selection: selected ? { type: 'domain', id: selected.id } : null,
              snapshot: props.snapshot, viewBox: '0 0 ' + VIEW_W + ' ' + VIEW_H,
              hoverId: null, hoverEdgeKey: null, apiRef: null, paused: false,
              onSelectDomain: function (id) { if (typeof props.onSelectDomain === 'function') props.onSelectDomain(id) },
              onHoverDomain: function () {},
              onSelectEdge: function () {},
              onHoverEdge: function () {},
              onView: function () {},
            }),
            props.snapshotLite ? h('div', { className: 'da-rp-tip' }, t('statusLoadingDetails')) : null
          )
        : h('div', { className: 'da-rp-wait' }, h('span', { className: 'da-spin' }), t('connectingDataStream'))
      return h('div', { className: 'da-rp-root' + (compact ? ' da-rp-compact' : '') },
        h('style', null, CSS_TEXT),
        h('div', { className: 'da-rp-top' },
          h('span', { className: 'da-rp-title' }, t('panel')),
          sessions.length > 0 ? h('select', {
            className: 'da-rp-session',
            value: props.sessionId || '',
            title: t('sessionFilter'),
            'aria-label': t('sessionFilter'),
            onChange: function (event) {
              if (typeof props.onSession === 'function') props.onSession(event && event.target ? event.target.value : '')
            },
          },
            h('option', { value: '' }, t('allSessions')),
            sessions.map(function (session) {
              return h('option', { key: 'rp:' + session.id, value: session.id }, session.title || String(session.id).slice(0, 8))
            })
          ) : null,
          h('span', { className: 'da-rp-pill da-status-' + status.key },
            h('span', { className: 'da-status-dot' }),
            t(status.labelKey || 'statusWaiting')
          ),
          h('span', { className: 'da-rp-spacer' }),
          typeof props.onFullscreen === 'function' ? h('button', {
            type: 'button', className: 'da-rp-btn', onClick: props.onFullscreen, title: t('fullscreen'),
          }, t('fullscreen')) : null
        ),
        stage,
        selected ? h('div', { className: 'da-rp-detail' },
          h('div', { className: 'da-rp-detail-head' },
            h('span', null, domainTitle(selected, zh)),
            h('span', { className: 'da-rp-recent-kind' }, String(selected.plugins.length) + 'p · ' + String(selected.services.length) + 's · ' + String(selected.tools.length) + 't'),
            h('span', { className: 'da-rp-spacer' }),
            h('button', { type: 'button', className: 'da-rp-btn', onClick: function () { if (typeof props.onSelectDomain === 'function') props.onSelectDomain('') } }, '×')
          ),
          h('div', { className: 'da-rp-detail-desc' }, domainDesc(selected, zh))
        ) : null,
        h('div', { className: 'da-rp-metrics' },
          h('div', { className: 'da-rp-metric' },
            h('div', { className: 'da-rp-metric-label' }, t('eventsPerSec')),
            h('div', { className: 'da-rp-metric-value' }, fmtNum(metrics.eventsPerSec) + '/s')),
          h('div', { className: 'da-rp-metric' },
            h('div', { className: 'da-rp-metric-label' }, t('toolCallsPerMin')),
            h('div', { className: 'da-rp-metric-value' }, fmtNum(metrics.toolCallsPerMin) + '/min')),
          h('div', { className: 'da-rp-metric' },
            h('div', { className: 'da-rp-metric-label' }, t('tokensPerMin')),
            h('div', { className: 'da-rp-metric-value' }, fmtNum((metrics.tokensPerMin || 0) / 60) + '/s')),
          h('div', { className: 'da-rp-metric' },
            h('div', { className: 'da-rp-metric-label' }, t('avgMs')),
            h('div', { className: 'da-rp-metric-value' }, fmtMs(metrics.avgMs)))
        ),
        h('div', { className: 'da-rp-recent' },
          h('div', { className: 'da-rp-recent-title' }, t('recentCalls') + ' · ' + (props.sessionId ? sessionTitleOf(props.sessionId) : t('allSessions'))),
          recent.length === 0
            ? h('div', { className: 'da-rp-recent-row', style: { opacity: 0.65 } }, t('emptyTraffic'))
            : recent.map(function (event, index) {
                const label = event.label || (event.data && event.data.tool) || event.target || event.organ || ''
                return h('div', { className: 'da-rp-recent-row', key: 'rp-ev:' + (event.id !== undefined ? event.id : index) },
                  h('span', { className: 'da-rp-recent-kind' }, localizedKind(event.kind, t)),
                  h('span', { className: 'da-rp-recent-text', title: String(label) }, String(label)),
                  h('span', { className: 'da-rp-recent-time' }, fmtClock(event.t))
                )
              })
        )
      )
    }

    /**
     * Data wrapper for the right-sidebar tab: one independent stream, the
     * session follow/default filter and the derived compact view.
     */
    function RightPanel(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackT
      const right = props && props.sidebarRight ? props.sidebarRight : null
      const [snapshot, setSnapshot] = React.useState(null)
      const [events, setEvents] = React.useState([])
      const [conn, setConn] = React.useState('connecting')
      const [lastEventAt, setLastEventAt] = React.useState(0)
      const [snapshotLite, setSnapshotLite] = React.useState(false)
      const [sessionId, setSessionId] = React.useState(function () { return rightMountedSessionId(right) })
      const [selectedDomain, setSelectedDomain] = React.useState('')
      const [nowTick, setNowTick] = React.useState(function () { return Date.now() })
      const mountedRef = React.useRef(true)
      const eventsRef = React.useRef([])
      const lastEventIdRef = React.useRef(-1)
      const snapshotStateRef = React.useRef({ snapshot: null, fullSnapshot: false, lite: false })
      const flushTimerRef = React.useRef(0)
      const manualSessionRef = React.useRef(false)

      React.useEffect(function mountRightController() {
        mountedRef.current = true
        const controller = createController({
          onConn: function (next) { if (mountedRef.current) setConn(next) },
          onSnapshot: function (snap) {
            if (!mountedRef.current || !snap || typeof snap !== 'object') return
            const applied = applySnapshotState(snapshotStateRef.current, snap)
            snapshotStateRef.current = applied.state
            if (!applied.changed) return
            setSnapshot(applied.state.snapshot)
            setSnapshotLite(applied.state.lite === true && applied.state.fullSnapshot !== true)
          },
          onEvents: function (frame) {
            if (!mountedRef.current || !frame || typeof frame !== 'object') return
            const incoming = Array.isArray(frame.events) ? frame.events : []
            const list = eventsRef.current
            let added = 0
            for (let i = 0; i < incoming.length; i += 1) {
              const event = incoming[i]
              if (!event || typeof event !== 'object') continue
              const id = Number(event.id)
              if (Number.isFinite(id)) {
                if (id <= lastEventIdRef.current) continue
                lastEventIdRef.current = id
              }
              list.push(event)
              added += 1
            }
            if (added === 0) return
            if (list.length > MAX_EVENTS + 100) list.splice(0, list.length - MAX_EVENTS)
            setLastEventAt(Date.now())
            if (flushTimerRef.current) return
            flushTimerRef.current = setTimeout(function () {
              flushTimerRef.current = 0
              if (mountedRef.current) setEvents(eventsRef.current.slice())
            }, 120)
          },
        })
        controller.start()
        return function unmountRightController() {
          mountedRef.current = false
          try { controller.dispose() } catch (error) { /* ignore */ }
          if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
          flushTimerRef.current = 0
        }
      }, [])

      React.useEffect(function followMountedSession() {
        if (!right || !right.mounted || typeof right.mounted.subscribe !== 'function') return undefined
        let off = null
        try {
          off = right.mounted.subscribe(function () {
            if (!mountedRef.current || manualSessionRef.current) return
            setSessionId(rightMountedSessionId(right))
          })
        } catch (error) {
          off = null
        }
        return function () { if (typeof off === 'function') { try { off() } catch (error) { /* ignore */ } } }
      }, [right])

      React.useEffect(function rightClock() {
        const timer = setInterval(function () { if (mountedRef.current) setNowTick(Date.now()) }, 1000)
        return function () { clearInterval(timer) }
      }, [])

      const sessions = React.useMemo(function () {
        return deriveSessions(snapshot, events)
      }, [snapshot, events])
      const filteredEvents = React.useMemo(function () {
        return filterEventsBySession(events, sessionId)
      }, [events, sessionId])
      React.useEffect(function fallbackRightSession() {
        if (!sessionId) return
        if (sessions.length === 0) return
        let found = false
        for (let i = 0; i < sessions.length; i += 1) if (sessions[i].id === sessionId) { found = true; break }
        if (!found) {
          manualSessionRef.current = false
          setSessionId(rightMountedSessionId(right) || '')
        }
      }, [sessionId, sessions, right])
      const nodes = React.useMemo(function () {
        const views = nodeViews(snapshot && snapshot.organs ? snapshot.organs : null)
        const examples = buildNodeExamples(snapshot)
        for (let i = 0; i < views.length; i += 1) views[i].examples = examples[views[i].id] || []
        return views
      }, [snapshot])
      const flows = React.useMemo(function () {
        return computeFlows(filteredEvents, FLOW_WINDOW_MS)
      }, [filteredEvents])
      const metrics = React.useMemo(function () {
        return deriveSessionMetrics(filteredEvents, FLOW_WINDOW_MS)
      }, [filteredEvents])
      const status = deriveRuntimeStatus({
        snapshot: snapshot, paused: false, conn: conn, lastEventAt: lastEventAt, now: nowTick,
      })
      return h(CompactPanelView, {
        t: t, zh: true, snapshot: snapshot, snapshotLite: snapshotLite, events: filteredEvents,
        nodes: nodes, flows: flows, sessions: sessions, sessionId: sessionId, selectedDomain: selectedDomain,
        status: status, metrics: metrics,
        onSession: function (next) {
          manualSessionRef.current = true
          setSessionId(String(next || ''))
        },
        onSelectDomain: function (id) {
          setSelectedDomain(function (previous) { return previous === id ? '' : String(id || '') })
        },
        onFullscreen: right && typeof right.toggleFullscreen === 'function'
          ? function () { try { right.toggleFullscreen() } catch (error) { /* not focused yet */ } }
          : null,
      })
    }

    /** Slot component rendered by the layout's keyed `main` seat. */
    function AnatomyPage(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackT
      const anatomyTheme = props && props.anatomyTheme ? props.anatomyTheme : null
      return h(ErrorBoundary, { t: t }, h(Hud, { t: t, anatomyTheme: anatomyTheme }))
    }

    function apply(ctx) {
      // Locale dictionaries first: every visible string below comes from t().
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-anatomy: dictionaries')
      const t = ctx.locale.bind(NS)

      // Colors the canvas must resolve to concrete values (tokens otherwise).
      const anatomyTheme = {
        read: readThemeColors,
        subscribe(callback) {
          return safe(() => {
            const off = ctx.on('theme/change', callback)
            return typeof off === 'function' ? off : () => {}
          }, () => {})
        },
      }

      // 1) Sidebar entry glyph. The sidebar shell renders the row and selects
      //    the main panel with the same id; the component only draws an icon.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'anatomy',
        order: 20,
        label: () => t('panel'),
        locale: NS,
        inject: () => ({ t }),
      }, PanelGlyph))

      // 2) Full-page architecture view; the key must match the entry id.
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'anatomy',
        locale: NS,
        inject: () => ({ t, anatomyTheme }),
      }, AnatomyPage))

      // 3) Optional conversation right-sidebar tab. The services can mount after
      //    this plugin, so retry in one ctx.effect until they are ready.
      ctx.effect(function lazyRightSidebarSeat() {
        const state = {
          registered: false,
          disposers: [],
          disposed: false,
          timer: 0,
          startedAt: Date.now(),
          warned: false,
        }
        const stopTimer = function () {
          if (state.timer) {
            clearInterval(state.timer)
            state.timer = 0
          }
        }
        const attempt = function () {
          if (state.disposed || state.registered) return
          const ok = safe(function () {
            return registerRightSidebarSeat(ctx, t, anatomyTheme, state)
          }, false)
          if (ok) {
            stopTimer()
            return
          }
          if (!state.warned && Date.now() - state.startedAt >= RIGHT_TIMEOUT_MS) {
            state.warned = true
            stopTimer()
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[dsh-anatomy] right-sidebar services unavailable after ' + RIGHT_TIMEOUT_MS + 'ms')
            }
          }
        }
        attempt()
        if (!state.registered && !state.disposed) {
          state.timer = setInterval(attempt, RIGHT_RETRY_MS)
          // Never keep a Node test process alive because of the retry timer.
          if (state.timer && typeof state.timer.unref === 'function') state.timer.unref()
        }
        return function () {
          state.disposed = true
          stopTimer()
          for (let i = state.disposers.length - 1; i >= 0; i -= 1) {
            try { state.disposers[i]() } catch (error) { /* ignore */ }
          }
          state.disposers.length = 0
        }
      }, 'dsh-anatomy: right sidebar seat (lazy)')
    }





    return {
      name: NS,
      inject: ['slots', 'locale', 'theme'],
      apply,
      // Harmless pure helpers exposed for the scratch harness only (no state,
      // no host surface; mirrors the Host half's `__internals` test hook).
      __internals: {
        computeFlows: computeFlows,
        nodeViews: nodeViews,
        buildSearchResults: buildSearchResults,
        buildComponentSections: buildComponentSections,
        computeToolFlows: computeToolFlows,
        buildToolView: buildToolView,
        computeDomainCallDetail: computeDomainCallDetail,
        computeToolCallDetail: computeToolCallDetail,
        bezierRoute: bezierRoute,
        bezierPath: bezierPath,
        pointOnEdge: pointOnEdge,
        edgeDotColors: edgeDotColors,
        buildCausalChain: buildCausalChain,
        causalStepKind: causalStepKind,
        resolveThemeDark: resolveThemeDark,
        colorToLuminance: colorToLuminance,
        shouldIgnoreStageWheel: shouldIgnoreStageWheel,
        fmtMs: fmtMs,
        deriveRuntimeStatus: deriveRuntimeStatus,
        formatLastEventLabel: formatLastEventLabel,
        applySnapshotState: applySnapshotState,
        RUNNING_WINDOW_MS: RUNNING_WINDOW_MS,
        rightMountedSessionId: rightMountedSessionId,
        hasOpenAnatomyTab: hasOpenAnatomyTab,
        ensureAnatomyTab: ensureAnatomyTab,
        rightSidebarServices: rightSidebarServices,
        registerRightSidebarSeat: registerRightSidebarSeat,
        RIGHT_RETRY_MS: RIGHT_RETRY_MS,
        RIGHT_TIMEOUT_MS: RIGHT_TIMEOUT_MS,
        CompactPanelView: CompactPanelView,
        RightPanel: RightPanel,
        OpenButton: OpenButton,
        ANATOMY_TAB_ID: ANATOMY_TAB_ID,
        ANATOMY_TAB_KIND: ANATOMY_TAB_KIND,
        localizedKind: localizedKind,
        localizedPhase: localizedPhase,
        localizedPluginKind: localizedPluginKind,
        eventDataRows: eventDataRows,
        toolViewGeometry: toolViewGeometry,
        toolTitleMaxChars: toolTitleMaxChars,
        toolSourceKey: toolSourceKey,
        toolChineseDescription: toolChineseDescription,
        TOOL_ZH: TOOL_ZH,
        isMostlyEnglish: isMostlyEnglish,
        FoldText: FoldText,
        splineRouteFromPoints: splineRouteFromPoints,
        routeSamples: routeSamples,
        rotatePlaceholder: undefined,
        selectionBreadcrumb: selectionBreadcrumb,
        selectionBackLabel: selectionBackLabel,
        columnIndexOf: columnIndexOf,
        layerGutters: layerGutters,
        gutterLaneOffset: gutterLaneOffset,
        laneRouteAdjacent: laneRouteAdjacent,
        laneRouteSameColumn: laneRouteSameColumn,
        roundedRoute: roundedRoute,
        gutterRoute: gutterRoute,
        gutterBetween: gutterBetween,
        pickTopTools: pickTopTools,
        simpleEdgeRoute: simpleEdgeRoute,
        sidedEdgeRoute: sidedEdgeRoute,
        edgeObstacleStats: edgeObstacleStats,
        edgeAvoidanceCandidates: edgeAvoidanceCandidates,
        lightEdgeRoute: lightEdgeRoute,
        filterEventsBySession: filterEventsBySession,
        deriveSessions: deriveSessions,
        deriveSessionMetrics: deriveSessionMetrics,
        formatPaintTimings: formatPaintTimings,
        chooseEdgeRoute: chooseEdgeRoute,
        cubicRouteForSides: cubicRouteForSides,
        routeFromControls: routeFromControls,
        sideOutwardVector: sideOutwardVector,
        clampSideOffset: clampSideOffset,
        sideAnchor: sideAnchor,
        sideToward: sideToward,
        pathIntersectsRects: pathIntersectsRects,
        buildObstacles: buildObstacles,
        pointOnPath: pointOnPath,
        pathPoints: pathPoints,
        polyRouteFromPoints: polyRouteFromPoints,
        cubicRouteFromPoints: cubicRouteFromPoints,
        rectOfNode: rectOfNode,
        clampViewCenter: clampViewCenter,
        zoomFrame: zoomFrame,
        zoomAtAnchor: zoomAtAnchor,
        screenToViewPoint: screenToViewPoint,
        buildLatencyStats: buildLatencyStats,
        relatedLlmCalls: relatedLlmCalls,
        bezierControls: bezierControls,
        dotPlanForEdge: dotPlanForEdge,
        buildTimeline: buildTimeline,
        timelinePct: timelinePct,
        servicesForPlugin: servicesForPlugin,
        pluginForService: pluginForService,
        relatedEntitiesForEdge: relatedEntitiesForEdge,
        zoomViewBox: zoomViewBox,
        placeEdgeLabels: placeEdgeLabels,
        computeDomainNeighbors: computeDomainNeighbors,
        buildEdgeDetail: buildEdgeDetail,
        focusPoint: focusPoint,
        findEdgeRow: findEdgeRow,
        spreadOffsets: spreadOffsets,
        buildNodeExamples: buildNodeExamples,
        layoutToolNodes: layoutToolNodes,
        layoutToolTargets: layoutToolTargets,
        ToolViewSvg: ToolViewSvg,
        ArchitectureSvg: ArchitectureSvg,
        LAYER_DEFS: LAYER_DEFS,
        HelpOverlay: HelpOverlay,
        FlowDots: FlowDots,
        StatRow: StatRow,
        CausalChain: CausalChain,
        PreBlock: PreBlock,
        LatencySparkline: LatencySparkline,
        DomainDetail: DomainDetail,
        RuntimeOverview: RuntimeOverview,
        DetailDrawer: DetailDrawer,
        EdgeDetail: EdgeDetail,
        TimelineTab: TimelineTab,
        ToolDetail: ToolDetail,
        EventDetail: EventDetail,
        PluginDetail: PluginDetail,
        ServiceDetail: ServiceDetail,
        BottomConsole: BottomConsole,
        MetricsTab: MetricsTab,
      },
    }
  },
})
