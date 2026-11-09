/**
 * dsh-anatomy — Host half (single-file ESM Cordis plugin).
 *
 * The plugin is a pure SIDE-CHANNEL observer of the running DeepSeek Harness:
 * it never mutates tool/model/session behaviour, it only reads registries and
 * wraps two waterfalls (tools/execute, llm/stream) plus two async waterfalls
 * (approval/request, user-questions/request) with pass-through bookkeeping.
 *
 * What it serves (all GET, exact routes on the bare webServer):
 *   /dsh-anatomy/api/ping      — install sanity check
 *   /dsh-anatomy/api/snapshot  — full anatomy snapshot (organs, plugins, ...)
 *   /dsh-anatomy/api/events    — incremental ring-buffer poll (?after= &limit=)
 *   /dsh-anatomy/api/stream    — NDJSON live feed (hello, snapshot, events,
 *                                metrics, snapshot-on-change, ping)
 *
 * Design rules encoded in this file:
 *  - Every listener body is defensive: a throwing observer must never break the
 *    observed pipeline. Waterfall listeners always call next() exactly once and
 *    rethrow the ORIGINAL error unchanged.
 *  - Every snapshot data source is isolated in its own try/catch; a broken
 *    source degrades to an empty array instead of failing the snapshot.
 *  - Only primitives / plain JSON go into TraceEvents; runtime objects are
 *    never serialized (no cycles, no getters invoked).
 *  - No third-party imports, no Node built-in imports: the module is importable
 *    by plain Node and all ctx access lives inside apply()/createHub().
 *
 * Contract: _analysis/anatomy/CONTRACT.md (sections 2-8).
 */

// ────────────────────────────────────────────────────────────────────────────
// 00. Identity and protocol constants
// ────────────────────────────────────────────────────────────────────────────

/** Cordis plugin name (also the Loader row and client bundle id). */
export const name = 'dsh-anatomy'

/** The bare HTTP carrier is the only hard dependency; everything else is optional. */
export const inject = ['webServer']

/** Snapshot/stream wire schema version (bump only on breaking shape changes). */
const SCHEMA_VERSION = 1

const PLUGIN_ID = 'dsh-anatomy'
const API_BASE = '/dsh-anatomy/api'
const ROUTES = {
  ping: `${API_BASE}/ping`,
  snapshot: `${API_BASE}/snapshot`,
  events: `${API_BASE}/events`,
  stream: `${API_BASE}/stream`,
}

/** Event ring buffer capacity (CONTRACT §6). */
const RING_CAPACITY = 4000
/** Rolling metric window, in one-second buckets. */
const WINDOW_SECONDS = 60
/** Client stream flush cadence. */
const FLUSH_INTERVAL_MS = 250
/** Live metrics frame cadence on the stream. */
const METRICS_INTERVAL_MS = 2000
/** Idle heartbeat cadence. */
const PING_INTERVAL_MS = 15000
/** Topology-change debounce before rebuilding/pushing a snapshot. */
const TOPOLOGY_DEBOUNCE_MS = 1000
/** Hard cap for one NDJSON events frame (CONTRACT §4). */
const MAX_FRAME_BYTES = 64 * 1024
/**
 * Snapshot frames are allowed to be much larger than events frames: the live
 * snapshot on a real profile is ~150 KiB, and trimming its plugin/service/tool
 * lists would make the architecture view empty whenever the stream snapshot
 * landed after the full HTTP fetch. The client reads whole NDJSON lines, so a
 * few hundred KiB per (debounced) snapshot frame is safe.
 */
const MAX_SNAPSHOT_FRAME_BYTES = 512 * 1024
/**
 * Full-snapshot TTL cache (v8.8): repeated GET /api/snapshot calls and stream
 * reconnects reuse one build for this long. Any topology change invalidates
 * the cache immediately, so this only absorbs idle-page reconnect bursts.
 */
const SNAPSHOT_CACHE_TTL_MS = 2000
/**
 * Lite first-paint snapshot budget (v8.8). The lite frame carries only counts
 * and 14 light organ rows, so it must stay far below the full ~150 KiB body.
 */
const LITE_SNAPSHOT_TARGET_BYTES = 20 * 1024
/** Max TraceEvents per stream frame. */
const MAX_FRAME_EVENTS = 80
/** Default/max page size for GET /api/events. */
const DEFAULT_EVENTS_LIMIT = 200
const MAX_EVENTS_LIMIT = 500
/** Stream connection and backpressure guards. */
const MAX_STREAM_CLIENTS = 32
const BACKPRESSURE_BYTES = 512 * 1024
/** Per-(session event type, organ) summary merge window. */
const SESSION_EVENT_THROTTLE_MS = 200
/** fs/observed can be very chatty while scanning; keep it a low-rate trace. */
const FS_EVENT_THROTTLE_MS = 250
/** settings/document-updated is explicitly low-frequency in the contract. */
const SETTINGS_EVENT_THROTTLE_MS = 2000
/** Async inventory caches (never let them block a snapshot). */
const PLUGIN_CACHE_TTL_MS = 10000
const BUNDLE_CACHE_TTL_MS = 30000
/** Topology caps. */
const MAX_FIBERS = 600
const MAX_PLUGINS = 400
const MAX_SERVICES = 200
const MAX_TOOLS = 300
const MAX_AGENTS = 100
const MAX_CLIENT_BUNDLES = 200
const MAX_MODELS = 200
/** Organ list caps inside one OrganView. */
const MAX_ORGAN_MEMBERS = 60

// ────────────────────────────────────────────────────────────────────────────
// 01. Organ model — the 14 fixed organs (CONTRACT §1)
// ────────────────────────────────────────────────────────────────────────────

const ORGAN_DEFS = [
  {
    id: 'skin', nameZh: '客户端界面', nameEn: 'Client UI', kind: 'system', x: 500, y: 62, size: 78,
    descZh: 'Web UI 客户端插件、渲染与交互（Client 模块图）',
    descEn: 'Web UI client plugins, rendering and interaction (client module graph)',
  },
  {
    id: 'cortex', nameZh: '会话循环', nameEn: 'Agent Loop', kind: 'core', x: 500, y: 165, size: 118,
    descZh: 'Agent Loop、会话调度、turn/step、目标与规划',
    descEn: 'Agent loop, session scheduling, turn/step, goals and planning',
  },
  {
    id: 'agents', nameZh: '子代理与工作流', nameEn: 'Subagents & Workflows', kind: 'cell', x: 706, y: 196, size: 78,
    descZh: '子代理、Agent Team、Workflow、定时任务',
    descEn: 'Subagents, Agent Teams, workflows and schedules',
  },
  {
    id: 'eyes', nameZh: '读取与搜索', nameEn: 'Read & Search', kind: 'sense', x: 300, y: 208, size: 82,
    descZh: '文件读取/搜索、图片、附件、输入感知',
    descEn: 'File reads, search, images, attachments and input perception',
  },
  {
    id: 'heart', nameZh: '模型调用', nameEn: 'LLM Calls', kind: 'core', x: 500, y: 332, size: 132,
    descZh: 'LLM 推理与模型路由（每次调用 = 一次脉冲）',
    descEn: 'LLM inference and model routing (one pulse per call)',
  },
  {
    id: 'lungs', nameZh: '网络与 MCP', nameEn: 'Network & MCP', kind: 'organ', x: 306, y: 348, size: 98,
    descZh: 'Web 搜索/抓取、MCP 通信（与外部系统交换数据）',
    descEn: 'Web search/fetch and MCP transport (data exchange with the outside)',
  },
  {
    id: 'spine', nameZh: 'Cordis 内核', nameEn: 'Cordis Kernel', kind: 'system', x: 500, y: 300, size: 70,
    descZh: '插件纤维、服务注册表、Loader、HMR、配置、Web 宿主',
    descEn: 'Plugin fibers, service registry, Loader, HMR, config, web host',
  },
  {
    id: 'liver', nameZh: '沙盒与权限', nameEn: 'Sandbox & Permissions', kind: 'defense', x: 690, y: 424, size: 92,
    descZh: '沙盒、权限、审批、工具守卫（策略过滤）',
    descEn: 'Sandbox, permissions, approvals and tool guards (policy filtering)',
  },
  {
    id: 'immune', nameZh: '凭据与授权', nameEn: 'Credentials & Auth', kind: 'defense', x: 322, y: 442, size: 80,
    descZh: '凭据、授权、账户、遥测（身份与访问）',
    descEn: 'Credentials, authorization, accounts and telemetry (identity/access)',
  },
  {
    id: 'stomach', nameZh: '工具执行', nameEn: 'Tool Runner', kind: 'organ', x: 500, y: 478, size: 96,
    descZh: '工具注册表与执行管线（调度、超时、结果）',
    descEn: 'Tool registry and execution pipeline (dispatch, timeout, results)',
  },
  {
    id: 'limbs', nameZh: '写入与终端', nameEn: 'Write & Terminal', kind: 'limb', x: 232, y: 566, size: 88,
    descZh: '写入/编辑、终端、子进程、工作区',
    descEn: 'Writes/edits, terminals, subprocesses and workspaces',
  },
  {
    id: 'kidneys', nameZh: '上下文与 Token', nameEn: 'Context & Tokens', kind: 'organ', x: 500, y: 596, size: 86,
    descZh: '上下文压缩、token 计量、溢出、结果修剪',
    descEn: 'Context compaction, token metering, spill and result pruning',
  },
  {
    id: 'intestines', nameZh: '会话日志与存储', nameEn: 'Session Log & Storage', kind: 'memory', x: 500, y: 696, size: 102,
    descZh: '会话日志、持久化、存储、检索、统计',
    descEn: 'Session logs, persistence, storage, retrieval and statistics',
  },
  {
    id: 'marrow', nameZh: '记忆与技能', nameEn: 'Memory & Skills', kind: 'memory', x: 500, y: 806, size: 86,
    descZh: '技能、Hindsight 记忆、MCP 资源、知识',
    descEn: 'Skills, Hindsight memory, MCP resources and knowledge',
  },
]

const ORGAN_IDS = ORGAN_DEFS.map(organ => organ.id)
const ORGAN_BY_ID = new Map(ORGAN_DEFS.map(organ => [organ.id, organ]))

// ────────────────────────────────────────────────────────────────────────────
// 02. Mapping rules: tool / plugin / service → organ (CONTRACT §8)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Map a tool name to the organ that owns it.
 * First match wins; names are lower-cased and matched by prefix/equality.
 * Unknown tools fall back to the kernel (spine) on purpose: the default for
 * the tool pipeline itself (stomach) would make stomach→stomach edges, which
 * the client draws as nothing — an unnamed tool would then look like no flow.
 * @param {string} rawName - tool name.
 * @returns {string} organ id.
 */
function organForTool(rawName) {
  let name = ''
  try {
    name = String(rawName ?? '').trim().toLowerCase()
  } catch {
    return 'spine'
  }
  if (!name) return 'spine'
  // MCP transport & remote resources — lungs. Checked BEFORE the generic
  // read_*/list_* rules so `read_mcp_resource`, `list_mcp_resources` and
  // `mcp__github__*` third-party tools are not captured as file reads.
  if (name.startsWith('mcp__') || name.startsWith('mcp_') || name === 'mcp'
    || name.startsWith('read_mcp_') || name.startsWith('list_mcp_')
    || name.startsWith('mcpresource')) return 'lungs'
  // Delegation and orchestration — stem cells. Exact agent names first:
  // `list_agents` must not be swallowed by the generic `list_*` read rule.
  if (name === 'list_agents' || name === 'wait_agent' || name === 'interrupt_agent'
    || name === 'send_message' || name === 'spawn_teammate' || name === 'team_task'
    || name.startsWith('team_') || name.startsWith('subagent')
    || name === 'workflow' || name.startsWith('workflow_')
    || name.startsWith('schedule_')) return 'agents'
  // Long-term memory / knowledge — marrow.
  if (name.startsWith('hindsight') || name === 'skill' || name.startsWith('skill_')) return 'marrow'
  // Acting on the machine / workspace — limbs.
  if (name === 'bash' || name === 'pwsh' || name === 'write' || name === 'edit'
    || name === 'multi_edit' || name === 'apply_patch'
    || name === 'load_workspace_dependencies' || name === 'working_directory'
    || name.startsWith('load_workspace') || name.startsWith('job_')
    || name.startsWith('terminal_')) return 'limbs'
  // Reading the world — eyes.
  if (name === 'read' || name === 'glob' || name === 'grep' || name === 'read_image'
    || name.startsWith('read_') || name.startsWith('list_')) return 'eyes'
  // The outside network — lungs.
  if (name === 'web' || name.startsWith('web_')) return 'lungs'
  // Thinking / planning — cortex.
  if (name === 'create_goal' || name === 'update_goal' || name === 'get_goal'
    || name.startsWith('goal_') || name.startsWith('todo_')
    || name.startsWith('ralph')) return 'cortex'
  // Asking the human is a safety decision — liver.
  if (name === 'ask_user_question' || name.startsWith('ask_user')) return 'liver'
  // Kernel introspection — spine.
  if (name.startsWith('cordis_') || name === 'lsp' || name.startsWith('lsp_')) return 'spine'
  // Session-log tooling — intestines.
  if (name.startsWith('session_') || name === 'session_search' || name === 'session_trace') return 'intestines'
  // Surface presentation — skin.
  if (name === 'present') return 'skin'
  // Unknown third-party tool: kernel default keeps a real stomach→spine edge.
  return 'spine'
}

/**
 * Classify a tool for the client (icon/colour family).
 * @param {string} rawName - tool name.
 * @returns {'fs'|'shell'|'web'|'agent'|'ui'|'inspect'|'other'} tool kind.
 */
function classifyToolKind(rawName) {
  let name = ''
  try {
    name = String(rawName ?? '').trim().toLowerCase()
  } catch {
    return 'other'
  }
  if (!name) return 'other'
  if (name === 'bash' || name === 'pwsh' || name.startsWith('job_') || name.startsWith('terminal_')) return 'shell'
  if (name === 'read' || name === 'glob' || name === 'grep' || name === 'read_image' || name === 'write'
    || name === 'edit' || name === 'multi_edit' || name === 'apply_patch'
    || name.startsWith('read_') || name.startsWith('list_')) return 'fs'
  if (name.startsWith('web_')) return 'web'
  if (name.startsWith('subagent') || name === 'spawn_teammate' || name === 'send_message'
    || name.startsWith('team_task') || name === 'wait_agent' || name === 'interrupt_agent'
    || name === 'list_agents' || name === 'workflow') return 'agent'
  if (name === 'present' || name === 'ask_user_question' || name.startsWith('ask_user')) return 'ui'
  if (name.startsWith('cordis_') || name.startsWith('lsp') || name === 'skill') return 'inspect'
  return 'other'
}

/**
 * Map a loader entry / bundle module name to an organ (CONTRACT §8).
 * Ordered, most-specific-first: kernel infrastructure beats generic keywords.
 * @param {string} rawName - module/package name.
 * @returns {string} organ id.
 */
function organForPlugin(rawName) {
  let name = ''
  try {
    name = String(rawName ?? '').toLowerCase()
  } catch {
    return 'spine'
  }
  if (!name) return 'spine'
  const has = needle => name.includes(needle)
  // Kernel / carrier infrastructure first: these packages host everything else.
  if (has('cordis') || has('loader') || has('hmr') || has('app-boot') || has('plugin-manager')
    || has('plugin-inventory') || has('inspector') || has('client-modules') || has('web-app')
    || has('webserver') || has('web-server') || has('connection') || has('settings')
    || has('config-editor') || has('shell') || has('profile') || has('frontend')
    || has('client-') || has('plugin-market')) return 'spine'
  // Model inference.
  if (has('llm') || has('model') || has('deepseek-llm')) return 'heart'
  // Safety / policy.
  if (has('sandbox') || has('permission') || has('approval')) return 'liver'
  // Identity / trust / telemetry.
  if (has('credential') || has('authorization') || has('account') || has('otel')
    || has('telemetry') || has('analytics')) return 'immune'
  // Context hygiene.
  if (has('compaction') || has('token-meter') || has('spill') || has('pruner')) return 'kidneys'
  // Durable history.
  if (has('session') || has('persistence') || has('storage') || has('jsonl')
    || has('projection') || has('query') || has('domain')) return 'intestines'
  // Memory substrate.
  if (has('skill') || has('hindsight') || has('memory') || has('mcp-resources')) return 'marrow'
  // Delegation.
  if (has('subagent') || has('agent-team') || has('team') || has('workflow') || has('schedule')) return 'agents'
  // Acting on the machine.
  if (has('subprocess') || has('bash') || has('pwsh') || has('terminal') || has('job')
    || has('workspace') || has('worktree') || has('fs-')) return 'limbs'
  // Perception of files.
  if (has('file-reference') || has('attachment') || has('fs') || has('image') || has('message-feedback')) return 'eyes'
  // Network.
  if (has('web') || has('mcp')) return 'lungs'
  // Tool pipeline.
  if (has('tool') || has('ptc')) return 'stomach'
  // Brain / loop.
  if (has('agent') || has('goal') || has('plan') || has('command') || has('persona')
    || has('system-prompt')) return 'cortex'
  return 'spine'
}

/**
 * Map a service name to an organ (CONTRACT §8).
 * @param {string} rawName - service key on the context.
 * @returns {string} organ id.
 */
function organForService(rawName) {
  let name = ''
  try {
    name = String(rawName ?? '').trim()
  } catch {
    return 'spine'
  }
  if (!name) return 'spine'
  if (name === 'tools' || name === 'toolRuntime' || name === 'ptcRuntime') return 'stomach'
  if (name === 'fs' || name.startsWith('fs') || name === 'attachments' || name === 'fileReferences') return 'eyes'
  if (name === 'llm' || name.startsWith('llm')) return 'heart'
  if (name === 'sessions' || name === 'sessionTitle' || name === 'sessionPersistence'
    || name === 'sessionQuery' || name === 'sessionStats' || name === 'sessionLog'
    || name.startsWith('sessionTelemetry') || name.startsWith('sessionSkill')) return 'intestines'
  if (name === 'agents' || name.startsWith('subagent') || name === 'agentTeams') return 'agents'
  if (name.startsWith('approval') || name.startsWith('sandbox') || name.startsWith('permission')) return 'liver'
  if (name.startsWith('credential') || name.startsWith('authorization') || name === 'deepseekAccount'
    || name.startsWith('account')) return 'immune'
  if (name.startsWith('compaction') || name === 'tokenMeter' || name === 'spillStore'
    || name === 'toolResultPruner') return 'kidneys'
  if (name === 'web' || name.startsWith('webSearch') || name.startsWith('webFetch')
    || name === 'mcpResources' || name.startsWith('mcp')) return 'lungs'
  if (name === 'skills' || name.startsWith('skill')) return 'marrow'
  if (name === 'agentLoop' || name === 'agentPresets' || name === 'agentDefaultModel'
    || name === 'goals' || name === 'commands' || name === 'persona'
    || name === 'systemPrompt') return 'cortex'
  if (name === 'terminals' || name === 'jobs' || name === 'subprocess'
    || name === 'workingDirectory' || name.startsWith('workspace')) return 'limbs'
  if (name === 'inspector' || name === 'hmr' || name === 'settings' || name === 'pluginManager'
    || name === 'clientModules' || name === 'webServer' || name === 'webApp'
    || name === 'connection' || name.startsWith('typert') || name === 'profileContext'
    || name === 'loader' || name === 'clientModules' || name === 'pluginMarket'
    || name === 'pluginRegistryProbe' || name === 'remoteAccess' || name === 'domain'
    || name === 'sessionProjections' || name.startsWith('storage')) return 'spine'
  if (name === 'messageFeedback' || name === 'productAnalytics' || name === 'otel'
    || name === 'telemetry') return 'immune'
  return 'spine'
}

// ────────────────────────────────────────────────────────────────────────────
// 03. Small pure utilities (never throw, never touch runtime objects deeply)
// ────────────────────────────────────────────────────────────────────────────

/** @returns {number} epoch milliseconds. */
function nowMs() {
  return Date.now()
}

/** @param {number} value @returns {number} clamped to 0..1 */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/** @param {number} value @returns {number} one decimal place */
function round1(value) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10) / 10
}

/** Truncate a string without throwing. @returns {string} */
function clip(value, max) {
  let text
  try {
    text = String(value ?? '')
  } catch {
    return ''
  }
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** Coerce to a clipped string; non-primitives become ''. @returns {string} */
function safeString(value, max = 200) {
  if (value === undefined || value === null) return ''
  try {
    if (typeof value === 'string') return clip(value, max)
    if (typeof value === 'number') return Number.isFinite(value) ? clip(String(value), max) : ''
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    return ''
  } catch {
    return ''
  }
}

/** @returns {boolean} true for plain-ish objects (never arrays/null). */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Best-effort error message, max-length clipped. @returns {string} */
function errorText(error, max = 200) {
  if (error === undefined || error === null) return ''
  try {
    if (typeof error === 'string') return clip(error, max)
    if (error instanceof Error) return clip(error.message || error.name || 'error', max)
    if (isRecord(error) && typeof error.message === 'string') return clip(error.message, max)
    return previewValue(error, max)
  } catch {
    return 'unknown error'
  }
}

/**
 * Serialize a value for display: strings pass through, everything else goes
 * through a cycle-safe JSON.stringify and is truncated. Never throws.
 * @returns {string}
 */
function previewValue(value, max = 160) {
  if (value === undefined) return ''
  if (typeof value === 'string') return clip(value, max)
  try {
    const seen = new WeakSet()
    const text = JSON.stringify(value, (_key, candidate) => {
      if (typeof candidate === 'bigint') return String(candidate)
      if (typeof candidate === 'function') return '[function]'
      if (typeof candidate === 'object' && candidate !== null) {
        if (seen.has(candidate)) return '[circular]'
        seen.add(candidate)
      }
      return candidate
    })
    if (typeof text === 'string') return clip(text, max)
    return clip(String(text), max)
  } catch {
    try {
      return clip(String(value), max)
    } catch {
      return '[unserializable]'
    }
  }
}

/**
 * Keep only finite primitive values so a TraceEvent.data payload can never
 * fail JSON.stringify or retain a runtime object. One level of small plain
 * objects is preserved as well (e.g. `usage: { inputTokens, outputTokens }`);
 * deeper structures are dropped. Every string is capped.
 * @param {unknown} input
 * @returns {Record<string, any>}
 */
function sanitizeData(input) {
  const out = {}
  if (!isRecord(input)) return out
  let count = 0
  try {
    for (const key of Object.keys(input)) {
      if (count >= 12) break
      let value
      try {
        value = input[key]
      } catch {
        continue
      }
      if (value === null) {
        out[clip(key, 40)] = null
        count += 1
      } else if (typeof value === 'string') {
        out[clip(key, 40)] = clip(value, 200)
        count += 1
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        out[clip(key, 40)] = value
        count += 1
      } else if (typeof value === 'boolean') {
        out[clip(key, 40)] = value
        count += 1
      } else if (isRecord(value)) {
        // Nested plain object: keep at most 6 finite primitives, no recursion.
        const nested = {}
        let nestedCount = 0
        try {
          for (const nestedKey of Object.keys(value)) {
            if (nestedCount >= 6) break
            let nestedValue
            try {
              nestedValue = value[nestedKey]
            } catch {
              continue
            }
            if (typeof nestedValue === 'number' && Number.isFinite(nestedValue)) {
              nested[clip(nestedKey, 40)] = nestedValue
              nestedCount += 1
            } else if (typeof nestedValue === 'string') {
              nested[clip(nestedKey, 40)] = clip(nestedValue, 120)
              nestedCount += 1
            } else if (typeof nestedValue === 'boolean') {
              nested[clip(nestedKey, 40)] = nestedValue
              nestedCount += 1
            }
          }
        } catch {
          nestedCount = 0
        }
        if (nestedCount > 0) {
          out[clip(key, 40)] = nested
          count += 1
        }
      }
    }
  } catch {
    // ignore malformed payloads
  }
  return out
}

/**
 * Extract a compact preview from one tool result: scalar `value` first (the
 * most readable outcome), then text content blocks, then a JSON preview.
 * Failures return '' rather than throwing.
 * @param {any} result - ToolExecutionResult
 * @param {number} max - character cap
 * @returns {string}
 */
function toolResultPreview(result, max = 200) {
  try {
    if (!isRecord(result)) return ''
    // Successful scalar payloads are the most useful one-line preview.
    if (result.value !== undefined && result.value !== null) {
      const raw = result.value
      if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
        const text = clip(String(raw), max)
        if (text) return text
      } else {
        const text = previewValue(raw, max)
        if (text && text !== '{}' && text !== '[]') return text
      }
    }
    // Content blocks: prefer text/reasoning text joined in block order.
    const content = Array.isArray(result.content) ? result.content : null
    if (content) {
      let text = ''
      try {
        for (const block of content) {
          if (!isRecord(block)) continue
          if (block.type !== 'text' && block.type !== 'reasoning') continue
          const chunk = typeof block.text === 'string' ? block.text : ''
          if (!chunk) continue
          // Join adjacent text blocks with one space unless a boundary already
          // provides whitespace (avoids "alpha  beta" style double spaces).
          if (text && !/\s$/.test(text) && !/^\s/.test(chunk)) text += ' '
          text += chunk
          if (text.length >= max) break
        }
      } catch {
        text = ''
      }
      if (text) return clip(text, max)
      const json = previewValue(content, max)
      if (json && json !== '[]') return json
    }
    // Failure shape: keep the error summary readable.
    if (isRecord(result.error)) return errorText(result.error, max)
    return ''
  } catch {
    return ''
  }
}

/**
 * LocalizedText (string | {en, [locale]}) → one display string.
 * @returns {string}
 */
function localizedText(value, max = 200) {
  try {
    if (typeof value === 'string') return clip(value, max)
    if (!isRecord(value)) return ''
    if (typeof value.en === 'string') return clip(value.en, max)
    for (const key of Object.keys(value)) {
      if (typeof value[key] === 'string') return clip(value[key], max)
    }
    return ''
  } catch {
    return ''
  }
}

/**
 * Numeric Cordis FiberState → the public plugin fiber phase vocabulary.
 * PENDING=0, LOADING=1, ACTIVE=2, FAILED=3, DISPOSED=4, UNLOADING=5.
 * @returns {'pending'|'loading'|'active'|'failed'|'unloading'|null}
 */
function fiberStateName(state) {
  switch (state) {
    case 0: return 'pending'
    case 1: return 'loading'
    case 2: return 'active'
    case 3: return 'failed'
    case 5: return 'unloading'
    default: return null
  }
}

/**
 * Read the method names of a service-like object WITHOUT invoking getters or
 * the methods themselves. Class methods live on the prototype, so a bounded
 * prototype walk is included; private/underscore names are skipped.
 * @returns {string[]} sorted, max 40 names
 */
function listMethodNames(value) {
  const names = new Set()
  try {
    if (typeof value !== 'object' && typeof value !== 'function') return []
    if (value === null) return []
    let object = value
    let depth = 0
    while (object !== null && object !== undefined && object !== Object.prototype
      && object !== Function.prototype && depth < 3) {
      let keys = []
      try {
        keys = Object.getOwnPropertyNames(object)
      } catch {
        break
      }
      for (const key of keys) {
        if (names.size >= 40) break
        if (key === 'constructor' || key.startsWith('_') || key.startsWith('#')) continue
        let descriptor
        try {
          descriptor = Object.getOwnPropertyDescriptor(object, key)
        } catch {
          descriptor = undefined
        }
        if (descriptor && typeof descriptor.value === 'function') names.add(clip(key, 60))
      }
      let proto
      try {
        proto = Object.getPrototypeOf(object)
      } catch {
        proto = null
      }
      if (!proto || proto === object) break
      object = proto
      depth += 1
    }
  } catch {
    // a hostile proxy must not break the snapshot
  }
  return [...names].slice(0, 40).sort()
}

/** @returns {number} text byte length (UTF-8) without importing Buffer types. */
function byteLength(text) {
  try {
    if (typeof Buffer !== 'undefined' && Buffer && typeof Buffer.byteLength === 'function') {
      return Buffer.byteLength(text, 'utf8')
    }
  } catch {
    // fall through
  }
  try {
    return encodeURIComponent(text).replace(/%[0-9A-F]{2}/gi, 'x').length
  } catch {
    return text.length
  }
}

/** @returns {number} size of a JSON frame, or Infinity when unserializable. */
function frameBytes(payload) {
  try {
    const text = JSON.stringify(payload)
    if (typeof text !== 'string') return Infinity
    return byteLength(text)
  } catch {
    return Infinity
  }
}

/** Parse a query string from a relative request URL. @returns {Record<string,string>} */
function parseQuery(url) {
  const result = {}
  try {
    const text = typeof url === 'string' ? url : ''
    const mark = text.indexOf('?')
    if (mark < 0) return result
    for (const part of text.slice(mark + 1).split('&')) {
      if (!part) continue
      const eq = part.indexOf('=')
      let key
      let value
      try {
        key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq))
        value = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1))
      } catch {
        continue
      }
      if (key) result[clip(key, 40)] = clip(value, 200)
    }
  } catch {
    // unparsable URL → empty query
  }
  return result
}

/** Parse an integer query parameter with a fallback. @returns {number} */
function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

// ────────────────────────────────────────────────────────────────────────────
// 04. Rolling metric series
// ────────────────────────────────────────────────────────────────────────────

const GLOBAL_SERIES_FIELDS = ['events', 'toolCalls', 'llmCalls', 'tokens', 'errors', 'approvals', 'fsOps', 'sessionEvents']
const ORGAN_SERIES_FIELDS = ['events', 'calls', 'errors', 'ms', 'approvals']

/**
 * Create a WINDOW_SECONDS-wide rolling counter series.
 * @param {string[]} fields
 */
function createSeries(fields) {
  const series = { ts: new Array(WINDOW_SECONDS).fill(-1), fields }
  for (const field of fields) series[field] = new Array(WINDOW_SECONDS).fill(0)
  return series
}

/** Current whole second used as the bucket clock. @returns {number} */
function currentSecond() {
  return Math.floor(Date.now() / 1000)
}

/**
 * Add to the bucket for `second`, resetting stale slots as they are reused so
 * the window never needs a sweeping timer.
 */
function bumpSeries(series, field, amount, second) {
  if (!series || !series[field] || !Number.isFinite(amount) || amount === 0) return
  const index = ((second % WINDOW_SECONDS) + WINDOW_SECONDS) % WINDOW_SECONDS
  if (series.ts[index] !== second) {
    series.ts[index] = second
    for (const name of series.fields) series[name][index] = 0
  }
  const next = series[field][index] + amount
  series[field][index] = Number.isFinite(next) ? next : 0
}

/**
 * Sum one field across the last `seconds` buckets (current one included).
 * @returns {number}
 */
function seriesWindow(series, field, seconds, second) {
  if (!series || !series[field]) return 0
  const from = second - seconds + 1
  let total = 0
  for (let index = 0; index < WINDOW_SECONDS; index += 1) {
    const ts = series.ts[index]
    if (ts >= from && ts <= second) total += series[field][index]
  }
  return Number.isFinite(total) ? total : 0
}

// ────────────────────────────────────────────────────────────────────────────
// 05. Session-event routing table (CONTRACT §7)
// ────────────────────────────────────────────────────────────────────────────

/** Session event types with no dedicated mapping default to cortex + info. */
const CORTEX_EVENT_PREFIXES = ['turn/', 'step/', 'request/context', 'model/selection', 'plan/mode', 'goal/change', 'todo/write', 'agent-preset/']
const HEART_EVENT_PREFIXES = ['assistant/message', 'assistant/attempt', 'request/header', 'llm/retry', 'llm/retry-started']
const IMMUNE_EVENT_PREFIXES = ['feedback/', 'session/end-seed', 'deliverables/presented', 'system/message', 'developer/message']

/**
 * Map one committed session event to a visual route.
 * The event payload is only READ for scalar metadata (type, seq, turn, step,
 * tool name, error text); message content never leaves the log.
 * @param {string} type - event.type
 * @param {any} event - the committed SessionEvent
 * @param {Map<string,string>} toolNames - callId → tool name (from tool/call events)
 * @returns {{organ:string,target?:string,label:string,detail?:string,level:string}}
 */
function routeSessionEvent(type, event, toolNames) {
  const route = { organ: 'cortex', label: type, level: 'info' }
  try {
    const data = isRecord(event) && isRecord(event.data) ? event.data : {}
    const text = String(type ?? '')

    // Error / severity first: it also decides the level of any route below.
    if (data.error) route.level = 'error'
    else if (/error|failed|failure|denied|rejected/i.test(text)) route.level = 'error'
    else if (/approval|permission|sandbox|policy/i.test(text)) route.level = 'warn'

    // Tools: the organ is derived from the tool name.
    if (text === 'tool/call' || text.startsWith('tool/ptc-dispatch')) {
      const toolName = safeString(data.name, 80) || safeString(data.tool, 80) || safeString(data.toolName, 80)
      route.organ = 'stomach'
      route.target = organForTool(toolName)
      route.label = toolName ? `tool:${toolName}` : text
      route.detail = previewValue(data.arguments, 120)
      return route
    }
    if (text === 'tool/result') {
      const callId = safeString(data.callId, 80) || safeString(isRecord(data.message) ? data.message.toolCallId : '', 80)
      const toolName = callId ? toolNames.get(callId) ?? '' : ''
      // Result direction: the tool's organ reports back into the tool pipeline.
      route.organ = organForTool(toolName)
      route.target = 'stomach'
      route.label = toolName ? `tool:${toolName}` : 'tool:result'
      if (callId) toolNames.delete(callId)
      const message = isRecord(data.message) ? data.message : {}
      const failed = Boolean(data.error) || message.isError === true
      route.level = failed ? 'error' : 'success'
      if (data.error) route.detail = errorText(data.error, 120)
      return route
    }

    // Delegation & orchestration.
    if (text.startsWith('subagent/') || text.startsWith('team/')) {
      route.organ = 'agents'
      if (text.includes('start') || text.includes('delivered') || text.includes('queued')) route.target = 'cortex'
      return route
    }
    // Approvals / policy.
    if (text.startsWith('approval/') || text === 'sandbox/mode' || text === 'permission/preset') {
      route.organ = 'liver'
      route.target = 'cortex'
      if (route.level === 'info') route.level = 'warn'
      return route
    }
    // Context hygiene. A compaction result is written back into the agent's
    // context, so the semantic direction is kidneys → cortex.
    if (text.startsWith('compaction/')) {
      route.organ = 'kidneys'
      route.target = 'cortex'
      return route
    }
    if (text === 'image/offload') {
      route.organ = 'kidneys'
      return route
    }
    // Durable history.
    if (text === 'session/title' || text.startsWith('session-log-deepseek/')) {
      route.organ = 'intestines'
      return route
    }
    // Network.
    if (text.startsWith('web/')) {
      route.organ = 'lungs'
      return route
    }
    // Acting on the machine.
    if (text === 'workspace/changes' || text === 'working-directory/change' || text.startsWith('job/')) {
      route.organ = 'limbs'
      return route
    }
    // Command lifecycle lives in the kernel.
    if (text === 'command/run' || text === 'command/done') {
      route.organ = 'spine'
      if (text === 'command/done' && /error/i.test(safeString(isRecord(data) ? data.kind : '', 20))) route.level = 'error'
      return route
    }
    // Scheduling.
    if (text === 'schedule/change') {
      route.organ = 'agents'
      return route
    }
    // Hooks are kernel extension points.
    if (text.startsWith('hook/')) {
      route.organ = 'spine'
      return route
    }
    // Human-facing surface events.
    if (text === 'user/message') {
      route.organ = 'skin'
      route.target = 'cortex'
      const sourceKind = safeString(isRecord(data.source) ? data.source.kind : '', 40)
      if (sourceKind) route.detail = `source=${sourceKind}`
      return route
    }
    // Model inference round-trips.
    if (HEART_EVENT_PREFIXES.some(prefix => text === prefix || text.startsWith(prefix))) {
      route.organ = 'heart'
      route.target = 'cortex'
      return route
    }
    // Human feedback / system framing sits on the surface.
    if (IMMUNE_EVENT_PREFIXES.some(prefix => text === prefix || text.startsWith(prefix))) {
      route.organ = 'skin'
      route.target = 'cortex'
      return route
    }
    // Everything else that the loop owns.
    if (CORTEX_EVENT_PREFIXES.some(prefix => text === prefix || text.startsWith(prefix))) {
      route.organ = 'cortex'
      if (text === 'turn/end') {
        // The finished turn is appended to the durable session log: the log
        // write is a real cortex → intestines flow.
        route.target = 'intestines'
        const reason = safeString(data.reason, 40)
        if (reason) route.detail = `reason=${reason}`
        if (/error|abort/i.test(reason)) route.level = 'warn'
      }
      return route
    }
    // Unknown future event: keep it visible but low priority.
    route.organ = 'cortex'
    route.detail = text
    return route
  } catch {
    return { organ: 'cortex', label: safeString(type, 80) || 'session.event', level: 'info' }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 06. The hub: ring buffer, metrics, listeners, snapshot, HTTP, timers
// ────────────────────────────────────────────────────────────────────────────

/**
 * One dsh-anatomy host instance bound to one Cordis context/fiber.
 * The class itself is context-free; apply() constructs it and calls install().
 */
class AnatomyHub {
  /** @param {{on:Function,get:Function,reflect:any,registry:any,logger:any,effect:Function,root:any}} ctx */
  constructor(ctx) {
    this.ctx = ctx
    this.startedAt = nowMs()
    this.disposed = false
    this.active = false

    // Event ring buffer (seq is monotonic; the id of an event equals its seq).
    this.ring = new Array(RING_CAPACITY)
    this.ringIndex = 0
    this.ringCount = 0
    this.seq = 0
    this.eventsTotal = 0

    // Rolling counters.
    this.series = createSeries(GLOBAL_SERIES_FIELDS)
    this.orgSeries = new Map()

    // Lifetime accumulators.
    this.toolMetrics = new Map() // name → {calls, errors, totalMs, minMs, maxMs}
    this.sessionToolNames = new Map() // callId → tool name (for tool/result organ routing)
    this.agents = new Map() // id → {status, startedAt, source, organ}
    this.modelSeen = new Map() // "provider::model" → {provider, model}
    this.runningTools = 0
    this.activeLlm = 0

    // Stream clients and topology bookkeeping.
    this.clients = new Set()
    this.dirtyAt = 0
    this.snapshotVersion = 0
    this.lastSnapshotBuildAt = 0
    this.lastTopologyPushAt = 0
    this.lastMetricsFrameAt = 0

    // v8.8 first-paint support: a lite snapshot frame is sent before the full
    // one, and the expensive full inventory walk is cached for a short TTL and
    // coalesced so reconnects do not repeat it.
    this.snapshotCache = { value: null, builtAt: 0, organCounts: null }
    this.snapshotBuildInFlight = false
    this.snapshotCacheHits = 0
    this.snapshotCacheMisses = 0
    this.lastFullBuildMs = 0
    this.lastLiteBuildMs = 0
    this.lastLiteBytes = 0
    this.lastSnapshotRequestMs = 0

    // HTTP diagnostics (exposed by /api/ping): helps tell "the page never
    // reached the host" apart from "the page reached it but no data flowed".
    this.httpCounts = { ping: 0, snapshot: 0, events: 0, stream: 0 }
    this.framesSent = { snapshot: 0, events: 0, metrics: 0, ping: 0 }
    this.lastRequestAt = 0
    this.lastStreamRequestAt = 0
    this.lastSnapshotRequestAt = 0
    this.lastEventsRequestAt = 0
    this.lastPingRequestAt = 0
    this.lastSnapshotBytes = 0
    this.requestLog = []

    // Throttle maps.
    this.sessionThrottle = new Map()
    this.lastSettingsEventAt = 0
    this.lastCredentialsEventAt = 0
    this.lastFsEventAt = 0

    // Async inventory caches (never awaited by the snapshot path).
    this.pluginCache = { at: 0, items: null, loading: false }
    this.bundleCache = { at: 0, items: null, loading: false }
    this.clientModuleRelease = null

    // Cleanup registries.
    this.timers = []
    this.routeDisposers = []
    this.listenerDisposers = []
    this.listenerCount = 0
    this.warnCount = 0
  }

  // ── 06.1 lifecycle ──────────────────────────────────────────────────────

  /** Install listeners, routes and the single 250 ms tick. Idempotent. */
  install() {
    if (this.active || this.disposed) return
    this.active = true
    this.installListeners()
    this.installRoutes()
    this.startTimers()
    // Warm the async inventories so the first snapshot already has metadata.
    this.refreshPlugins()
    this.refreshBundles()
    this.markTopologyDirty()
  }

  /** Tear every resource down. Idempotent; must never throw. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.active = false
    for (const timer of this.timers) {
      try {
        clearInterval(timer)
      } catch {
        // ignore
      }
    }
    this.timers = []
    for (const disposeRoute of this.routeDisposers) {
      try {
        if (typeof disposeRoute === 'function') disposeRoute()
      } catch {
        // ignore
      }
    }
    this.routeDisposers = []
    for (const disposeListener of this.listenerDisposers) {
      try {
        if (typeof disposeListener === 'function') disposeListener()
      } catch {
        // ignore
      }
    }
    this.listenerDisposers = []
    for (const client of [...this.clients]) this.dropClient(client, 'plugin-disposed')
    this.clients.clear()
    // Release retained references so an HMR reload can collect the old hub.
    this.ring = []
    this.ringCount = 0
    this.ringIndex = 0
    this.sessionThrottle.clear()
    this.sessionToolNames.clear()
    this.orgSeries.clear()
    this.agents.clear()
    this.modelSeen.clear()
    this.pluginCache = { at: 0, items: null, loading: false }
    this.bundleCache = { at: 0, items: null, loading: false }
    this.clientModuleRelease = null
    // v8.8 snapshot cache: release the retained full snapshot on unload.
    this.snapshotCache = { value: null, builtAt: 0, organCounts: null }
    this.snapshotBuildInFlight = false
  }

  /** Log once-ish through the Cordis logger; never throw. */
  warn(message, error) {
    this.warnCount += 1
    try {
      if (this.warnCount > 40) return // avoid spamming a broken deployment
      const logger = this.ctx && this.ctx.logger
      const suffix = error === undefined ? '' : `: ${errorText(error, 160)}`
      if (logger && typeof logger.warn === 'function') logger.warn(`[${PLUGIN_ID}] ${message}${suffix}`)
    } catch {
      // logging must never break the observer
    }
  }

  /** Read an optional service without ever throwing. @returns {any} */
  getService(serviceName) {
    try {
      if (this.ctx && typeof this.ctx.get === 'function') return this.ctx.get(serviceName)
    } catch {
      // a service accessor may throw while its provider is unloading
    }
    return undefined
  }

  // ── 06.2 event production ───────────────────────────────────────────────

  /** Current event-bucket clock. */
  currentSecond() {
    return Math.floor(nowMs() / 1000)
  }

  /** Oldest seq still retained in the ring (seq+1 when empty). */
  oldestSeq() {
    if (this.ringCount === 0) return this.seq + 1
    return this.seq - this.ringCount + 1
  }

  /** Add one occurrence to the global and per-organ rolling counters. */
  countEvent(kind, organ) {
    const second = this.currentSecond()
    bumpSeries(this.series, 'events', 1, second)
    this.bumpOrgan(organ, 'events', 1, second)
    if (kind === 'tool.start' || kind === 'tool.end') {
      bumpSeries(this.series, 'toolCalls', 1, second)
      this.bumpOrgan(organ, 'calls', 1, second)
    } else if (kind === 'llm.start' || kind === 'llm.end') {
      bumpSeries(this.series, 'llmCalls', 1, second)
      this.bumpOrgan(organ, 'calls', 1, second)
    } else if (kind === 'error') {
      bumpSeries(this.series, 'errors', 1, second)
      this.bumpOrgan(organ, 'errors', 1, second)
    } else if (kind === 'approval.start' || kind === 'question.start' || kind === 'auth.change') {
      bumpSeries(this.series, 'approvals', 1, second)
      this.bumpOrgan(organ, 'approvals', 1, second)
    } else if (kind === 'fs.observed') {
      bumpSeries(this.series, 'fsOps', 1, second)
    } else if (kind === 'session.event') {
      bumpSeries(this.series, 'sessionEvents', 1, second)
    }
  }

  /** Add duration to the organ's rolling latency average. */
  bumpOrganDuration(organ, ms) {
    if (!Number.isFinite(ms) || ms < 0) return
    this.bumpOrgan(organ, 'ms', ms, this.currentSecond())
  }

  /** Lazily create and bump one per-organ series. */
  bumpOrgan(organ, field, amount, second = this.currentSecond()) {
    if (!ORGAN_BY_ID.has(organ)) return
    let series = this.orgSeries.get(organ)
    if (!series) {
      series = createSeries(ORGAN_SERIES_FIELDS)
      this.orgSeries.set(organ, series)
    }
    bumpSeries(series, field, amount, second)
  }

  /** Record one token-usage observation (never a TraceEvent). */
  addTokens(inputTokens, outputTokens) {
    const input = Number(inputTokens)
    const output = Number(outputTokens)
    const total = (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0)
    if (!Number.isFinite(total) || total <= 0) return
    bumpSeries(this.series, 'tokens', total, this.currentSecond())
  }

  /**
   * Append one TraceEvent to the ring buffer.
   * @param {{kind:string,organ:string,target?:string,label?:string,detail?:string,
   *          level?:string,ms?:number,ok?:boolean,sessionId?:string,agentId?:string,
   *          data?:Record<string,unknown>}} spec
   * @returns {object|null} the recorded event (or null when inactive/failed)
   */
  record(spec) {
    if (!this.active) return null
    try {
      const kind = clip(safeString(spec.kind, 60) || 'event', 60)
      const organ = ORGAN_BY_ID.has(spec.organ) ? spec.organ : 'cortex'
      const target = typeof spec.target === 'string' && ORGAN_BY_ID.has(spec.target) ? spec.target : ''
      const level = spec.level === 'success' || spec.level === 'warn' || spec.level === 'error' ? spec.level : 'info'
      const seq = this.seq + 1
      this.seq = seq
      this.eventsTotal += 1
      const event = {
        id: seq,
        t: nowMs(),
        kind,
        organ,
        label: clip(safeString(spec.label, 80) || kind, 80),
        level,
      }
      if (target) event.target = target
      const detail = safeString(spec.detail, 120)
      if (detail) event.detail = detail
      if (typeof spec.ms === 'number' && Number.isFinite(spec.ms)) event.ms = Math.max(0, Math.round(spec.ms))
      if (typeof spec.ok === 'boolean') event.ok = spec.ok
      const sessionId = safeString(spec.sessionId, 80)
      if (sessionId) event.sessionId = sessionId
      const agentId = safeString(spec.agentId, 80)
      if (agentId) event.agentId = agentId
      const data = sanitizeData(spec.data)
      if (Object.keys(data).length > 0) event.data = data

      this.ring[this.ringIndex] = event
      this.ringIndex = (this.ringIndex + 1) % RING_CAPACITY
      if (this.ringCount < RING_CAPACITY) this.ringCount += 1
      this.countEvent(kind, organ)
      this.bumpOrganDuration(organ, spec.ms)
      // A severity-carrying event (tool/llm failure, rejected approval, …) is
      // an error for health purposes even when its kind is not `error`.
      if (level === 'error' && kind !== 'error') {
        bumpSeries(this.series, 'errors', 1, this.currentSecond())
        this.bumpOrgan(organ, 'errors', 1, this.currentSecond())
      }
      return event
    } catch (error) {
      this.warn('failed to record trace event', error)
      return null
    }
  }

  /** Read events with `id > after`, bounded by `limit`; handles ring eviction. */
  readEventsAfter(after, limit) {
    if (this.ringCount === 0) return []
    const oldest = this.oldestSeq()
    let cursor = Number.isFinite(after) ? Math.max(0, Math.floor(after)) : 0
    if (cursor > this.seq) return []
    // The client fell behind the ring: skip to the oldest retained event.
    if (cursor < oldest - 1) cursor = oldest - 1
    const firstSeq = cursor + 1
    if (firstSeq > this.seq) return []
    const count = Math.min(this.seq - firstSeq + 1, Math.max(1, Math.floor(limit)))
    const startOffset = (this.ringIndex - this.ringCount + (firstSeq - oldest) + RING_CAPACITY * 2) % RING_CAPACITY
    const events = []
    for (let offset = 0; offset < count; offset += 1) {
      const event = this.ring[(startOffset + offset) % RING_CAPACITY]
      if (event) events.push(event)
    }
    return events
  }

  /** Mark topology changed; the tick rebuilds/pushes a snapshot after 1 s. */
  markTopologyDirty() {
    if (!this.active) return
    const now = nowMs()
    if (this.dirtyAt === 0) this.dirtyAt = now
    // A composition/topology change must never be served from the TTL cache.
    this.invalidateSnapshotCache()
  }

  /** Drop the cached full snapshot (next reader rebuilds it). */
  invalidateSnapshotCache() {
    this.snapshotCache.value = null
    this.snapshotCache.builtAt = 0
    this.snapshotCache.organCounts = null
  }

  /** Forget the cached plugin inventory (next snapshot refreshes it). */
  invalidatePluginCache() {
    this.pluginCache.at = 0
  }

  /** Forget the cached bundle inventory (next snapshot refreshes it). */
  invalidateBundleCache() {
    this.bundleCache.at = 0
  }

  /** Track a "provider::model" pair seen at runtime for the models view. */
  rememberModel(provider, model) {
    const providerId = safeString(provider, 80)
    const modelId = safeString(model, 80)
    if (!providerId || !modelId) return
    const key = `${providerId}::${modelId}`
    if (this.modelSeen.has(key)) return
    if (this.modelSeen.size >= MAX_MODELS) {
      const oldest = this.modelSeen.keys().next()
      if (!oldest.done) this.modelSeen.delete(oldest.value)
    }
    this.modelSeen.set(key, { provider: providerId, model: modelId })
  }

  // ── 06.3 listeners ──────────────────────────────────────────────────────

  /** Register one global listener defensively. */
  on(event, listener) {
    try {
      if (!this.ctx || typeof this.ctx.on !== 'function') return
      const disposer = this.ctx.on(event, listener, { global: true })
      this.listenerCount += 1
      if (typeof disposer === 'function') this.listenerDisposers.push(disposer)
    } catch (error) {
      this.warn(`could not register listener ${event}`, error)
    }
  }

  /** Wrap a synchronous handler so an observer bug can never escape. */
  guarded(label, handler) {
    return (...args) => {
      try {
        return handler(...args)
      } catch (error) {
        this.warn(`${label} listener failed`, error)
        return undefined
      }
    }
  }

  installListeners() {
    // ── waterfall: every tool dispatch (CONTRACT §8.3) ──
    this.on('tools/execute', async (exec, next) => {
      let startedAt = 0
      try {
        startedAt = nowMs()
        this.toolStart(exec)
      } catch (error) {
        this.warn('tools/execute start bookkeeping failed', error)
      }
      try {
        const result = await next()
        try {
          this.toolEnd(exec, result, startedAt, null)
        } catch (error) {
          this.warn('tools/execute end bookkeeping failed', error)
        }
        return result
      } catch (error) {
        try {
          this.toolEnd(exec, null, startedAt, error)
        } catch (innerError) {
          this.warn('tools/execute failure bookkeeping failed', innerError)
        }
        throw error // rethrow the ORIGINAL error unchanged
      }
    })

    // ── waterfall: every streaming model call (CONTRACT §8.3) ──
    this.on('llm/stream', (options, next) => {
      let startedAt = 0
      try {
        startedAt = nowMs()
        this.llmStart(options)
      } catch (error) {
        this.warn('llm/stream start bookkeeping failed', error)
      }
      let stream
      try {
        stream = next()
      } catch (error) {
        try {
          this.llmEnd(options, startedAt, error)
        } catch (innerError) {
          this.warn('llm/stream failure bookkeeping failed', innerError)
        }
        throw error // rethrow the ORIGINAL error unchanged
      }
      try {
        return this.wrapLlmStream(stream, options, startedAt)
      } catch (error) {
        this.warn('llm/stream wrapper creation failed', error)
        return stream
      }
    })

    // ── waterfall: human approval decisions (liver ↔ cortex) ──
    this.on('approval/request', async (req, next) => {
      let startedAt = 0
      try {
        startedAt = nowMs()
        this.approvalStart(req)
      } catch (error) {
        this.warn('approval/request start bookkeeping failed', error)
      }
      try {
        const outcome = await next()
        try {
          this.approvalEnd(req, outcome, startedAt, null)
        } catch (error) {
          this.warn('approval/request end bookkeeping failed', error)
        }
        return outcome
      } catch (error) {
        try {
          this.approvalEnd(req, null, startedAt, error)
        } catch (innerError) {
          this.warn('approval/request failure bookkeeping failed', innerError)
        }
        throw error
      }
    })

    // ── waterfall: structured questions (start only; never interfere) ──
    this.on('user-questions/request', async (request, next) => {
      try {
        this.questionStart(request)
      } catch (error) {
        this.warn('user-questions/request bookkeeping failed', error)
      }
      return next()
    })

    // ── session log feed ──
    this.on('session/event', this.guarded('session/event', (session, event) => this.sessionEvent(session, event)))

    // ── agents ──
    this.on('agent/status', this.guarded('agent/status', payload => this.agentStatusChanged(payload)))
    this.on('agent/created', this.guarded('agent/created', payload => this.agentCreated(payload)))
    this.on('agent/disposed', this.guarded('agent/disposed', payload => this.agentDisposed(payload)))
    this.on('agent/error', this.guarded('agent/error', payload => this.agentErrored(payload)))

    // ── subagents ──
    this.on('subagent/start', this.guarded('subagent/start', info => this.subagentStarted(info)))
    this.on('subagent/end', this.guarded('subagent/end', info => this.subagentEnded(info)))

    // ── workflows ──
    this.on('workflow/start', this.guarded('workflow/start', info => {
      this.markTopologyDirty()
      this.record({ kind: 'workflow.start', organ: 'agents', label: this.workflowLabel(info), detail: safeString(info && info.id, 80), data: { run: safeString(info && info.id, 80) } })
    }))
    this.on('workflow/phase', this.guarded('workflow/phase', (info, title) => {
      this.record({ kind: 'workflow.phase', organ: 'agents', label: clip(safeString(title, 80) || 'phase', 80), detail: safeString(info && info.id, 80) })
    }))
    this.on('workflow/end', this.guarded('workflow/end', (info, result) => {
      this.markTopologyDirty()
      const stopReason = safeString(result && result.stopReason, 40)
      const level = stopReason === 'error' ? 'error' : (stopReason === 'cancelled' ? 'warn' : 'success')
      this.record({ kind: 'workflow.end', organ: 'agents', label: this.workflowLabel(info), level, detail: stopReason, data: { stopReason, agentsStarted: toInt(result && result.agentsStarted, 0) } })
    }))
    this.on('workflow/agent-start', this.guarded('workflow/agent-start', (info, agent) => {
      this.markTopologyDirty()
      this.record({ kind: 'workflow.agent-start', organ: 'agents', target: 'cortex', label: this.workflowAgentLabel(agent), detail: safeString(info && info.id, 80) })
    }))
    this.on('workflow/agent-end', this.guarded('workflow/agent-end', (info, agent) => {
      this.markTopologyDirty()
      const outcome = safeString(agent && agent.outcome, 40)
      const failed = outcome === 'error' || outcome === 'cancelled'
      this.record({ kind: 'workflow.agent-end', organ: 'cortex', target: 'agents', label: this.workflowAgentLabel(agent), level: failed ? 'warn' : 'success', detail: outcome })
    }))
    this.on('workflow/log', this.guarded('workflow/log', (info, message) => {
      this.record({ kind: 'workflow.log', organ: 'agents', label: clip(safeString(message, 80) || 'log', 80), detail: safeString(info && info.id, 80) })
    }))

    // ── filesystem observations (low-rate: throttled) ──
    this.on('fs/observed', this.guarded('fs/observed', (target, observation) => {
      const second = this.currentSecond()
      bumpSeries(this.series, 'fsOps', 1, second)
      const now = nowMs()
      if (now - this.lastFsEventAt < FS_EVENT_THROTTLE_MS) return
      this.lastFsEventAt = now
      const displayPath = clip(safeString(target && target.displayPath, 100) || 'fs', 100)
      const kind = safeString(observation && observation.kind, 20)
      this.record({ kind: 'fs.observed', organ: 'eyes', label: displayPath, detail: kind, data: { observation: kind, path: displayPath } })
    }))

    // ── plugin composition / installation / HMR ──
    this.on('plugin-manager/changed', this.guarded('plugin-manager/changed', change => {
      this.invalidatePluginCache()
      this.invalidateBundleCache()
      this.markTopologyDirty()
      const reason = safeString(change && change.reason, 40)
      this.record({ kind: 'plugin.change', organ: 'spine', label: 'plugin-manager:changed', detail: reason, data: { reason } })
    }))
    this.on('plugin-manager/install-state', this.guarded('plugin-manager/install-state', progress => {
      this.markTopologyDirty()
      const phase = safeString(progress && progress.phase, 40)
      this.record({ kind: 'plugin.change', organ: 'spine', label: 'plugin-manager:install', detail: phase, data: { phase } })
    }))
    this.on('hmr/reload', this.guarded('hmr/reload', reloads => {
      this.invalidatePluginCache()
      this.markTopologyDirty()
      let count = 0
      try {
        count = reloads && typeof reloads.size === 'number' ? reloads.size : 0
      } catch {
        count = 0
      }
      this.record({ kind: 'plugin.change', organ: 'spine', label: 'hmr:reload', detail: `${count} module(s)`, data: { reloaded: count } })
    }))
    this.on('app-boot/config-reload', this.guarded('app-boot/config-reload', () => {
      this.invalidatePluginCache()
      this.markTopologyDirty()
      this.record({ kind: 'plugin.change', organ: 'spine', label: 'app-boot:config-reload' })
    }))

    // ── registry invalidations ──
    this.on('tools/change', this.guarded('tools/change', () => {
      this.markTopologyDirty()
      this.record({ kind: 'tool.change', organ: 'stomach', label: 'tools:changed' })
    }))
    this.on('skills/change', this.guarded('skills/change', () => {
      this.markTopologyDirty()
      this.record({ kind: 'skill.change', organ: 'marrow', label: 'skills:changed' })
    }))
    this.on('llm/adapters-updated', this.guarded('llm/adapters-updated', () => {
      this.markTopologyDirty()
    }))

    // ── settings / credentials / authorization ──
    this.on('settings/document-updated', this.guarded('settings/document-updated', (ns) => {
      const now = nowMs()
      if (now - this.lastSettingsEventAt < SETTINGS_EVENT_THROTTLE_MS) return
      this.lastSettingsEventAt = now
      this.markTopologyDirty()
      this.record({ kind: 'settings.change', organ: 'spine', label: 'settings:updated', detail: safeString(ns, 80) })
    }))
    this.on('credentials/record-updated', this.guarded('credentials/record-updated', () => {
      const now = nowMs()
      if (now - this.lastCredentialsEventAt < SETTINGS_EVENT_THROTTLE_MS) return
      this.lastCredentialsEventAt = now
      this.record({ kind: 'credentials.change', organ: 'immune', label: 'credentials:record' })
    }))
    this.on('credentials/reference-updated', this.guarded('credentials/reference-updated', () => {
      const now = nowMs()
      if (now - this.lastCredentialsEventAt < SETTINGS_EVENT_THROTTLE_MS) return
      this.lastCredentialsEventAt = now
      this.record({ kind: 'credentials.change', organ: 'immune', label: 'credentials:reference' })
    }))
    this.on('authorization/settled', this.guarded('authorization/settled', (key, settlement) => {
      const failed = safeString(settlement && settlement.status, 40) === 'failed'
      this.record({ kind: 'auth.change', organ: 'immune', label: 'authorization:settled', level: failed ? 'warn' : 'success' })
    }))

    // ── goals / schedules / domains ──
    this.on('goal/changed', this.guarded('goal/changed', payload => {
      const operation = safeString(payload && payload.change && payload.change.operation, 40)
      this.record({ kind: 'goal.change', organ: 'cortex', label: 'goal:changed', detail: operation, agentId: safeString(payload && payload.agent && payload.agent.id, 80), data: { operation } })
    }))
    this.on('schedule/changed', this.guarded('schedule/changed', () => {
      this.markTopologyDirty()
      this.record({ kind: 'schedule.change', organ: 'agents', label: 'schedule:changed' })
    }))
    this.on('domain/changed', this.guarded('domain/changed', change => {
      this.record({ kind: 'domain.change', organ: 'intestines', label: 'domain:changed', detail: safeString(change && change.domain, 60) })
    }))

    // ── session lifecycle (counts/topology only) ──
    this.on('session/created', this.guarded('session/created', () => this.markTopologyDirty()))
    this.on('session/disposed', this.guarded('session/disposed', () => this.markTopologyDirty()))

    // ── Cordis internals: cheap topology dirty marks ──
    this.on('internal/plugin', this.guarded('internal/plugin', () => this.markTopologyDirty()))
    this.on('internal/service', this.guarded('internal/service', () => this.markTopologyDirty()))
  }

  // ── 06.4 command / llm / session trace recorders ────────────────────────

  /** Record tool start + lifetime/rolling counters. */
  toolStart(exec) {
    const toolName = safeString(exec && exec.name, 80) || 'unknown'
    const organ = organForTool(toolName)
    this.runningTools += 1
    let metric = this.toolMetrics.get(toolName)
    if (!metric) {
      metric = { calls: 0, errors: 0, totalMs: 0, minMs: 0, maxMs: 0 }
      this.toolMetrics.set(toolName, metric)
    }
    const callId = safeString(exec && exec.callId, 80)
    const agentId = safeString(exec && exec.agent && exec.agent.id, 80)
    const sessionId = safeString(exec && exec.agent && exec.agent.session && exec.agent.session.id, 80)
    this.record({
      kind: 'tool.start',
      organ: 'stomach',
      target: organ,
      label: toolName,
      detail: clip(previewValue(exec && exec.arguments, 100), 120),
      sessionId,
      agentId,
      data: { tool: toolName, callId, argsPreview: previewValue(exec && exec.arguments, 160) },
    })
  }

  /** Record tool end, result metadata and latency. */
  toolEnd(exec, result, startedAt, error) {
    this.runningTools = Math.max(0, this.runningTools - 1)
    const toolName = safeString(exec && exec.name, 80) || 'unknown'
    const organ = organForTool(toolName)
    const ms = startedAt > 0 ? Math.max(0, nowMs() - startedAt) : 0
    const ok = error === null || error === undefined
    const failed = !ok || Boolean(result && result.isError === true)
    const callId = safeString(exec && exec.callId, 80)
    const agentId = safeString(exec && exec.agent && exec.agent.id, 80)
    let metric = this.toolMetrics.get(toolName)
    if (!metric) {
      metric = { calls: 0, errors: 0, totalMs: 0, minMs: 0, maxMs: 0 }
      this.toolMetrics.set(toolName, metric)
    }
    metric.calls += 1
    metric.totalMs += ms
    if (failed) metric.errors += 1
    if (metric.calls === 1 || typeof metric.minMs !== 'number' || typeof metric.maxMs !== 'number') {
      metric.minMs = ms
      metric.maxMs = ms
    } else {
      if (ms < metric.minMs) metric.minMs = ms
      if (ms > metric.maxMs) metric.maxMs = ms
    }
    // Latency is attributed to the tool's own organ as well as to the stomach
    // pipeline, so per-organ avgMs reflects the tool that actually ran.
    this.bumpOrganDuration(organ, ms)
    const detail = failed ? errorText(error ?? (result && result.error), 120) : ''
    // Call-detail fields for the HUD: bounded argument/result previews. The
    // failure error summary stays in `detail`; previews are ≤200 chars so a
    // stream frame cannot be inflated by one call.
    const argsPreview = previewValue(exec && exec.arguments, 160)
    let resultPreview = ''
    try {
      resultPreview = failed ? '' : toolResultPreview(result, 200)
    } catch {
      resultPreview = ''
    }
    this.record({
      kind: 'tool.end',
      // Result direction: the tool's own organ returns control to the tool
      // pipeline (tool.start recorded the opposite stomach → organ dispatch),
      // so the graph shows a real round-trip with correct arrowheads.
      organ,
      target: 'stomach',
      label: toolName,
      detail,
      ms,
      ok: !failed,
      level: failed ? 'error' : 'success',
      agentId,
      data: { tool: toolName, callId, ok: !failed, ms, argsPreview, resultPreview },
    })
    if (failed) this.bumpOrgan('stomach', 'errors', 1)
  }

  /** Record one LLM call start. */
  llmStart(options) {
    const provider = safeString(options && options.provider, 60) || 'unknown'
    const model = safeString(options && options.model, 80) || 'unknown'
    const purpose = safeString(options && options.purpose, 40)
    const sessionId = safeString(options && options.sessionId, 80)
    this.activeLlm += 1
    this.rememberModel(provider, model)
    this.record({
      kind: 'llm.start',
      // Request direction: the agent loop asks the model. llm.end records the
      // opposite direction (heart → cortex), so the rendered edge is a real
      // request/response round-trip instead of a one-way arrow.
      organ: 'cortex',
      target: 'heart',
      label: `${provider}/${model}`,
      detail: purpose,
      sessionId,
      data: { provider, model, purpose },
    })
    // Semantic flow (one per call): the agent loop reads session history /
    // context out of the durable log before asking the model, so the first
    // heartbeat of a session also draws intestines → cortex.
    let messageCount = 0
    try {
      if (isRecord(options) && Array.isArray(options.messages)) messageCount = options.messages.length
    } catch {
      messageCount = 0
    }
    if (!Number.isFinite(messageCount) || messageCount < 0) messageCount = 0
    this.record({
      kind: 'context.load',
      organ: 'intestines',
      target: 'cortex',
      label: '上下文加载',
      detail: `${messageCount} 条消息`,
      sessionId,
      data: { messages: messageCount },
    })
  }

  /**
   * Record one LLM call end (idempotency is the caller's job).
   * @param {any} options - the GenerateOptions of the call
   * @param {number} startedAt - start timestamp (epoch ms)
   * @param {any} error - failure, when the call failed
   * @param {{inputTokens?:number,outputTokens?:number}|null} [usage] - optional
   *   per-call token totals accumulated by the stream wrapper; omitted when the
   *   adapter reported no usage chunk.
   */
  llmEnd(options, startedAt, error, usage) {
    this.activeLlm = Math.max(0, this.activeLlm - 1)
    const provider = safeString(options && options.provider, 60) || 'unknown'
    const model = safeString(options && options.model, 80) || 'unknown'
    const ms = startedAt > 0 ? Math.max(0, nowMs() - startedAt) : 0
    const failed = error !== null && error !== undefined
    const sessionId = safeString(options && options.sessionId, 80)
    const data = { provider, model, ms }
    // Per-call usage is only present when the adapter emitted a usage chunk.
    try {
      if (isRecord(usage)) {
        const inputTokens = Number(usage.inputTokens)
        const outputTokens = Number(usage.outputTokens)
        if (Number.isFinite(inputTokens) || Number.isFinite(outputTokens)) {
          data.usage = {
            inputTokens: Number.isFinite(inputTokens) ? Math.max(0, Math.round(inputTokens)) : 0,
            outputTokens: Number.isFinite(outputTokens) ? Math.max(0, Math.round(outputTokens)) : 0,
          }
        }
      }
    } catch {
      // usage stays omitted
    }
    this.record({
      kind: 'llm.end',
      organ: 'heart',
      target: 'cortex',
      label: `${provider}/${model}`,
      detail: failed ? errorText(error, 120) : safeString(options && options.purpose, 40),
      ms,
      ok: !failed,
      level: failed ? 'error' : 'success',
      sessionId,
      data,
    })
    // Semantic flow: measured tokens leave the heart for context metering /
    // trimming (kidneys). Only drawn when the adapter reported actual tokens;
    // this is one extra low-frequency event per model call.
    try {
      const usageData = isRecord(data.usage) ? data.usage : null
      if (usageData && (usageData.inputTokens > 0 || usageData.outputTokens > 0)) {
        this.record({
          kind: 'token.usage',
          organ: 'heart',
          target: 'kidneys',
          label: 'Token 计量',
          sessionId,
          data: { inputTokens: usageData.inputTokens, outputTokens: usageData.outputTokens },
        })
      }
    } catch {
      // token.usage is decorative; never let it disturb llm.end
    }
  }

  /**
   * Wrap an AsyncIterable<StreamChunk> so every chunk passes through unchanged
   * while usage tokens are accumulated and llm.end is recorded exactly once.
   * Per-call usage totals are handed to llmEnd as its optional 4th argument.
   * @returns {AsyncIterable<any>}
   */
  wrapLlmStream(stream, options, startedAt) {
    const hub = this
    let finalized = false
    /** @type {{inputTokens:number,outputTokens:number}|null} */
    let usageTotals = null
    const accumulateUsage = usage => {
      try {
        if (!isRecord(usage)) return
        const inputTokens = Number(usage.inputTokens)
        const outputTokens = Number(usage.outputTokens)
        if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens)) return
        if (!usageTotals) usageTotals = { inputTokens: 0, outputTokens: 0 }
        if (Number.isFinite(inputTokens)) usageTotals.inputTokens += Math.max(0, inputTokens)
        if (Number.isFinite(outputTokens)) usageTotals.outputTokens += Math.max(0, outputTokens)
      } catch (innerError) {
        hub.warn('llm/stream usage accumulation failed', innerError)
      }
    }
    const finish = error => {
      if (finalized) return
      finalized = true
      try {
        hub.llmEnd(options, startedAt, error, usageTotals)
      } catch (innerError) {
        hub.warn('llm/stream end bookkeeping failed', innerError)
      }
    }
    // If a consumer never iterates the returned generator, release the counter
    // after a generous grace period instead of leaking "streaming" forever.
    let guardTimer = null
    try {
      guardTimer = setTimeout(() => {
        if (!finalized) finish(new Error('stream was never iterated'))
      }, 30000)
      if (guardTimer && typeof guardTimer.unref === 'function') guardTimer.unref()
    } catch {
      guardTimer = null
    }
    async function* iterable() {
      let sawError = false
      try {
        for await (const chunk of stream) {
          try {
            if (chunk && chunk.type === 'usage' && isRecord(chunk.usage)) {
              hub.addTokens(chunk.usage.inputTokens, chunk.usage.outputTokens)
              accumulateUsage(chunk.usage)
            }
          } catch (innerError) {
            hub.warn('llm/stream usage bookkeeping failed', innerError)
          }
          yield chunk
        }
      } catch (error) {
        sawError = true
        finish(error)
        throw error // preserve the original stream error
      } finally {
        if (guardTimer) {
          try {
            clearTimeout(guardTimer)
          } catch {
            // ignore
          }
          guardTimer = null
        }
        if (!sawError) finish(null)
      }
    }
    return iterable()
  }

  /** Record one committed session event (throttled summary). */
  sessionEvent(session, event) {
    if (!this.active) return
    const type = safeString(event && event.type, 80)
    if (!type) return
    const sessionId = safeString(session && session.id, 80)
    // Track callId→toolName so tool/result routes to the right organ.
    try {
      if (type === 'tool/call' && isRecord(event.data)) {
        const callId = safeString(event.data.callId, 80)
        const name = safeString(event.data.name, 80)
        if (callId && name) {
          if (this.sessionToolNames.size >= 500) {
            const oldest = this.sessionToolNames.keys().next()
            if (!oldest.done) this.sessionToolNames.delete(oldest.value)
          }
          this.sessionToolNames.set(callId, name)
        }
      }
    } catch {
      // name tracking is best effort
    }
    // Usage tokens ride on assistant/message commits; count them even when the
    // summary event itself is merged by the throttle below.
    try {
      if (type === 'assistant/message' && isRecord(event.data) && isRecord(event.data.usage)) {
        this.addTokens(event.data.usage.inputTokens, event.data.usage.outputTokens)
      }
      if (type === 'request/header' && isRecord(event.data) && isRecord(event.data.header) && isRecord(event.data.header.config)) {
        this.rememberModel(event.data.header.config.provider, event.data.header.config.model)
      }
      if (type === 'model/selection' && isRecord(event.data)) {
        this.rememberModel(event.data.provider, event.data.model)
      }
    } catch {
      // token/model bookkeeping is best effort
    }
    const route = routeSessionEvent(type, event, this.sessionToolNames)
    const throttleKey = `${type}|${route.organ}`
    const now = nowMs()
    const previous = this.sessionThrottle.get(throttleKey)
    if (previous && now - previous.at < SESSION_EVENT_THROTTLE_MS) {
      previous.at = now
      if (previous.event) {
        const prior = isRecord(previous.event.data) ? previous.event.data : {}
        const count = toInt(prior.count, 1) + 1
        previous.event.data = sanitizeData({ ...prior, count })
      }
      // The occurrence still counts toward rates even though no event is pushed.
      this.countEvent('session.event', route.organ)
      this.eventsTotal += 1
      return
    }
    const recorded = this.record({
      kind: 'session.event',
      organ: route.organ,
      target: route.target,
      label: route.label,
      detail: route.detail,
      level: route.level,
      sessionId,
      data: {
        type,
        seq: Number.isFinite(event && event.seq) ? event.seq : undefined,
        count: 1,
      },
    })
    if (recorded) {
      if (this.sessionThrottle.size >= 3000) this.sessionThrottle.clear()
      this.sessionThrottle.set(throttleKey, { at: now, event: recorded })
    }
  }

  /** approval/request start. */
  approvalStart(req) {
    const toolName = safeString(req && req.toolName, 80) || 'approval'
    const agentId = safeString(req && req.agent && req.agent.id, 80)
    this.record({
      kind: 'approval.start',
      organ: 'liver',
      target: 'cortex',
      label: toolName,
      level: 'warn',
      agentId,
      data: { tool: toolName, callId: safeString(req && req.callId, 80) },
    })
  }

  /** approval/request end (called on success and on error). */
  approvalEnd(req, outcome, startedAt, error) {
    const toolName = safeString(req && req.toolName, 80) || 'approval'
    const ms = startedAt > 0 ? Math.max(0, nowMs() - startedAt) : 0
    const failed = error !== null && error !== undefined
    const outcomeText = failed ? 'error' : safeString(outcome, 40) || 'unavailable'
    const denied = outcomeText === 'rejected' || outcomeText === 'cancelled'
    const level = failed ? 'error' : (denied ? 'warn' : 'success')
    this.record({
      kind: 'approval.end',
      organ: 'liver',
      target: 'cortex',
      label: toolName,
      detail: outcomeText,
      ms,
      ok: !failed && !denied,
      level,
      agentId: safeString(req && req.agent && req.agent.id, 80),
      data: { outcome: outcomeText, ms },
    })
  }

  /** user-questions/request start (start only — never end the waterfall). */
  questionStart(request) {
    let count = 0
    try {
      if (isRecord(request) && Array.isArray(request.questions)) count = request.questions.length
    } catch {
      count = 0
    }
    const agentId = safeString(request && request.agent && request.agent.id, 80)
    this.record({
      kind: 'question.start',
      organ: 'liver',
      target: 'skin',
      label: 'user-question',
      level: 'warn',
      agentId,
      data: { questions: count },
    })
  }

  // ── 06.5 agent / subagent listeners ─────────────────────────────────────

  /** Ensure an agent bookkeeping record exists. */
  agentRecord(agentId) {
    let record = this.agents.get(agentId)
    if (!record) {
      record = { status: 'unknown', startedAt: 0, source: '', organ: 'cortex' }
      this.agents.set(agentId, record)
    }
    return record
  }

  agentStatusChanged(payload) {
    const agentId = safeString(payload && payload.agent && payload.agent.id, 80)
    if (!agentId) return
    const status = safeString(payload && payload.status, 20) || 'unknown'
    const record = this.agentRecord(agentId)
    record.status = status
    this.record({
      kind: 'agent.status',
      organ: 'cortex',
      target: 'cortex',
      label: `agent:${status}`,
      detail: agentId,
      level: 'info',
      agentId,
      data: { status },
    })
  }

  agentCreated(payload) {
    const agentId = safeString(payload && payload.agent && payload.agent.id, 80)
    if (!agentId) return
    const record = this.agentRecord(agentId)
    record.startedAt = nowMs()
    record.source = safeString(payload && payload.source, 40)
    record.status = 'idle'
    this.markTopologyDirty()
    this.record({
      kind: 'agent.created',
      organ: 'cortex',
      target: 'agents',
      label: 'agent:created',
      detail: agentId,
      agentId,
      data: { source: record.source },
    })
  }

  agentDisposed(payload) {
    const agentId = safeString(payload && payload.agent && payload.agent.id, 80)
    if (agentId) this.agents.delete(agentId)
    this.markTopologyDirty()
    this.record({
      kind: 'agent.disposed',
      organ: 'cortex',
      target: 'agents',
      label: 'agent:disposed',
      detail: agentId,
      agentId,
    })
  }

  agentErrored(payload) {
    const agentId = safeString(payload && payload.agent && payload.agent.id, 80)
    this.record({
      kind: 'error',
      organ: 'cortex',
      target: 'cortex',
      label: 'agent:error',
      detail: errorText(payload && payload.error, 120),
      level: 'error',
      agentId,
      data: { turn: toInt(payload && payload.turn, 0), step: toInt(payload && payload.step, 0) },
    })
  }

  subagentStarted(info) {
    const id = safeString(info && info.id, 80)
    if (id) {
      const record = this.agentRecord(id)
      record.organ = 'agents'
    }
    this.markTopologyDirty()
    this.record({
      kind: 'subagent.start',
      organ: 'agents',
      target: 'cortex',
      label: safeString(info && info.provider, 60) || 'subagent',
      detail: id,
      agentId: id,
      data: { provider: safeString(info && info.provider, 60), local: info && info.local === true },
    })
  }

  subagentEnded(info) {
    const id = safeString(info && info.id, 80)
    const stopReason = safeString(info && info.stopReason, 40)
    this.markTopologyDirty()
    this.record({
      kind: 'subagent.end',
      organ: 'cortex',
      target: 'agents',
      label: safeString(info && info.provider, 60) || 'subagent',
      detail: stopReason || id,
      level: stopReason === 'error' ? 'error' : (stopReason === 'completed' ? 'success' : 'warn'),
      agentId: id,
      data: { provider: safeString(info && info.provider, 60), stopReason, local: info && info.local === true },
    })
  }

  workflowLabel(info) {
    try {
      const meta = isRecord(info) && isRecord(info.meta) ? info.meta : {}
      return clip(safeString(meta.name, 80) || safeString(meta.title, 80) || safeString(info && info.id, 80) || 'workflow', 80)
    } catch {
      return 'workflow'
    }
  }

  workflowAgentLabel(agent) {
    try {
      if (!isRecord(agent)) return 'workflow:agent'
      return clip(safeString(agent.label, 80) || safeString(agent.id, 80) || safeString(agent.seq, 20) || 'workflow:agent', 80)
    } catch {
      return 'workflow:agent'
    }
  }

  // ── 06.6 snapshot: inventory readers ────────────────────────────────────

  /** Kick off an async pluginManager.listPlugins() refresh when stale. */
  refreshPlugins() {
    const cache = this.pluginCache
    if (cache.loading) return
    if (nowMs() - cache.at < PLUGIN_CACHE_TTL_MS && Array.isArray(cache.items)) return
    const service = this.getService('pluginManager')
    if (!service || typeof service.listPlugins !== 'function') {
      cache.at = nowMs()
      return
    }
    cache.loading = true
    let pending
    try {
      pending = service.listPlugins()
    } catch (error) {
      cache.loading = false
      cache.at = nowMs()
      this.warn('pluginManager.listPlugins() threw synchronously', error)
      return
    }
    Promise.resolve(pending).then(items => {
      if (!this.active) return
      cache.items = Array.isArray(items) ? items.filter(isRecord) : []
      cache.at = nowMs()
    }).catch(error => {
      cache.at = nowMs()
      this.warn('pluginManager.listPlugins() rejected', error)
    }).finally(() => {
      cache.loading = false
    })
  }

  /** Kick off an async pluginManager.listBundles() refresh when stale. */
  refreshBundles() {
    const cache = this.bundleCache
    if (cache.loading) return
    if (nowMs() - cache.at < BUNDLE_CACHE_TTL_MS && Array.isArray(cache.items)) return
    const service = this.getService('pluginManager')
    if (!service || typeof service.listBundles !== 'function') {
      cache.at = nowMs()
      return
    }
    cache.loading = true
    let pending
    try {
      pending = service.listBundles()
    } catch (error) {
      cache.loading = false
      cache.at = nowMs()
      this.warn('pluginManager.listBundles() threw synchronously', error)
      return
    }
    Promise.resolve(pending).then(items => {
      if (!this.active) return
      cache.items = Array.isArray(items) ? items.filter(isRecord) : []
      cache.at = nowMs()
    }).catch(error => {
      cache.at = nowMs()
      this.warn('pluginManager.listBundles() rejected', error)
    }).finally(() => {
      cache.loading = false
    })
  }

  /** @returns {Map<string, any>} pluginManager inventory keyed by entryId */
  cachedPluginMap() {
    if (nowMs() - this.pluginCache.at > PLUGIN_CACHE_TTL_MS) this.refreshPlugins()
    const map = new Map()
    const items = Array.isArray(this.pluginCache.items) ? this.pluginCache.items : []
    for (const item of items) {
      const entryId = safeString(item && item.entryId, 160)
      if (entryId && !map.has(entryId)) map.set(entryId, item)
    }
    return map
  }

  /** @returns {Map<string,string>} entryId/rowId → bundle name (from cache) */
  cachedBundleRowMap() {
    if (nowMs() - this.bundleCache.at > BUNDLE_CACHE_TTL_MS) this.refreshBundles()
    const map = new Map()
    const items = Array.isArray(this.bundleCache.items) ? this.bundleCache.items : []
    for (const bundle of items) {
      const bundleName = safeString(bundle && bundle.name, 160)
      if (!bundleName) continue
      let rows = []
      try {
        rows = Array.isArray(bundle.rows) ? bundle.rows : []
      } catch {
        rows = []
      }
      for (const row of rows) {
        const entryId = safeString(row && row.entryId, 160) || safeString(row && row.rowId, 160)
        if (entryId && !map.has(entryId)) map.set(entryId, bundleName)
      }
    }
    return map
  }

  /** Classify a plugin module name for the client. */
  pluginKind(moduleName) {
    const moduleText = safeString(moduleName, 200)
    if (!moduleText) return 'third-party'
    if (moduleText.startsWith('.') || /^[A-Za-z]:[\\/]/.test(moduleText) || moduleText.startsWith('/')) return 'local'
    if (moduleText.startsWith('@deepseek-ai/') || moduleText.includes('@deepseek-ai/')) return 'official'
    return 'third-party'
  }

  /** Read a loader entry id without letting the composed-id getter throw. */
  loaderEntryId(entry) {
    try {
      if (isRecord(entry) && typeof entry.id === 'string' && entry.id) return clip(entry.id, 160)
    } catch {
      // fall through to options.id
    }
    try {
      return safeString(entry && entry.options && entry.options.id, 160)
    } catch {
      return ''
    }
  }

  /** @returns {PluginView[]} */
  collectPlugins() {
    const cached = this.cachedPluginMap()
    const bundleRows = this.cachedBundleRowMap()
    const rows = []
    const seen = new Set()
    let entries = []
    try {
      const loader = this.getService('loader')
      if (loader && typeof loader.entries === 'function') entries = [...loader.entries()]
    } catch (error) {
      this.warn('loader.entries() failed', error)
      entries = []
    }
    for (const entry of entries) {
      if (rows.length >= MAX_PLUGINS) break
      try {
        const entryId = this.loaderEntryId(entry)
        if (!entryId || seen.has(entryId)) continue
        const options = isRecord(entry && entry.options) ? entry.options : {}
        // `group: true` rows are composition tree nodes, not plugins.
        if (options.group === true) continue
        seen.add(entryId)
        const moduleName = safeString(options.name, 200) || entryId
        let enabled = options.disabled !== true
        try {
          if (typeof entry.disabled === 'boolean') enabled = !entry.disabled
        } catch {
          // effective-disabled getter may throw when a !!js expression fails
        }
        let fiber = null
        try {
          fiber = entry.fiber ?? null
        } catch {
          fiber = null
        }
        let fiberPhase = null
        let fiberUid
        try {
          if (fiber) {
            fiberPhase = fiberStateName(fiber.state)
            if (typeof fiber.uid === 'number') fiberUid = fiber.uid
          }
        } catch {
          fiberPhase = null
        }
        const cachedItem = cached.get(entryId)
        const meta = isRecord(cachedItem) && isRecord(cachedItem.meta) ? cachedItem.meta : {}
        const view = {
          entryId,
          name: moduleName,
          enabled,
          fiberPhase,
          organ: organForPlugin(moduleName),
          kind: this.pluginKind(moduleName),
        }
        if (typeof fiberUid === 'number') view.fiberUid = fiberUid
        const title = localizedText(meta.title, 120)
        if (title) view.title = title
        const description = localizedText(meta.description, 240)
        if (description) view.description = description
        const errorMeta = localizedText(meta.error, 120)
        if (errorMeta) view.error = errorMeta
        const bundleName = bundleRows.get(entryId)
        if (bundleName) view.bundle = bundleName
        rows.push(view)
      } catch (error) {
        this.warn('skipped a loader entry while building the snapshot', error)
      }
    }
    // If the Loader is unavailable, fall back to the pluginManager inventory.
    if (rows.length === 0 && cached.size > 0) {
      for (const [entryId, item] of cached) {
        if (rows.length >= MAX_PLUGINS) break
        const meta = isRecord(item.meta) ? item.meta : {}
        const phase = safeString(item.fiberPhase, 20) || null
        const view = {
          entryId,
          name: safeString(item.moduleName, 200) || entryId,
          enabled: item.enabled === true,
          fiberPhase: phase === 'pending' || phase === 'loading' || phase === 'active' || phase === 'failed' || phase === 'unloading' ? phase : null,
          organ: organForPlugin(safeString(item.moduleName, 200) || entryId),
          kind: this.pluginKind(safeString(item.moduleName, 200) || entryId),
        }
        const title = localizedText(meta.title, 120)
        if (title) view.title = title
        const description = localizedText(meta.description, 240)
        if (description) view.description = description
        rows.push(view)
      }
    }
    // Client bundles are plugins too: the skin is made of them (CONTRACT §1).
    try {
      const clientBundles = this.collectClientBundles()
      for (const clientBundle of clientBundles) {
        if (rows.length >= MAX_PLUGINS) break
        if (!clientBundle.id || seen.has(clientBundle.id)) continue
        seen.add(clientBundle.id)
        const view = {
          entryId: clientBundle.id,
          name: clientBundle.id,
          enabled: true,
          fiberPhase: null,
          organ: 'skin',
          kind: 'client',
        }
        const version = safeString(this.clientModuleRelease && this.clientModuleRelease.version, 60)
        if (version) view.version = version
        rows.push(view)
      }
    } catch (error) {
      this.warn('could not append client bundle plugins', error)
    }
    return rows
  }

  /** @returns {ClientBundleView[]} */
  collectClientBundles() {
    const service = this.getService('clientModules')
    if (!service || typeof service.graph !== 'function') return []
    let graph
    try {
      graph = service.graph()
    } catch (error) {
      this.warn('clientModules.graph() failed', error)
      return []
    }
    if (!isRecord(graph)) return []
    try {
      if (isRecord(graph.release)) this.clientModuleRelease = graph.release
    } catch {
      this.clientModuleRelease = null
    }
    const rows = []
    let entries = []
    try {
      entries = Array.isArray(graph.entries) ? graph.entries : []
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (rows.length >= MAX_CLIENT_BUNDLES) break
      try {
        const id = safeString(entry && entry.id, 160)
        if (!id) continue
        const view = { id }
        const rev = safeString(entry && entry.rev, 80)
        if (rev) view.rev = rev
        rows.push(view)
      } catch {
        // skip malformed row
      }
    }
    return rows
  }

  /** @returns {ServiceView[]} */
  collectServices() {
    const rows = []
    let store
    try {
      const reflect = this.ctx && this.ctx.reflect
      store = reflect ? reflect.store : undefined
    } catch (error) {
      this.warn('ctx.reflect.store is unavailable', error)
      return rows
    }
    if (!isRecord(store)) return rows
    const seen = new Set()
    let keys = []
    try {
      keys = Reflect.ownKeys(store)
    } catch {
      return rows
    }
    for (const key of keys) {
      if (rows.length >= MAX_SERVICES) break
      let implementation
      try {
        implementation = store[key]
      } catch {
        continue
      }
      if (!isRecord(implementation)) continue
      const serviceName = safeString(implementation.name, 120) || safeString(key, 120)
      if (!serviceName || seen.has(serviceName)) continue
      seen.add(serviceName)
      let provider = 'root'
      let active = false
      try {
        const fiber = implementation.fiber
        provider = safeString(fiber && fiber.runtime && fiber.runtime.name, 120) || 'root'
        active = Boolean(fiber && fiber.state === 2)
      } catch {
        provider = 'root'
        active = false
      }
      const view = { name: serviceName, organ: organForService(serviceName), provider, active, methods: [] }
      try {
        view.methods = listMethodNames(implementation.value)
      } catch {
        view.methods = []
      }
      rows.push(view)
    }
    return rows
  }

  /** @returns {ToolView[]} */
  collectTools() {
    const rows = []
    const service = this.getService('tools')
    if (!service || typeof service.schemas !== 'function') return rows
    let schemas
    try {
      schemas = service.schemas()
    } catch (error) {
      this.warn('tools.schemas() failed', error)
      return rows
    }
    if (!Array.isArray(schemas)) return rows
    for (const schema of schemas) {
      if (rows.length >= MAX_TOOLS) break
      try {
        const toolName = safeString(schema && schema.name, 120)
        if (!toolName) continue
        const metric = this.toolMetrics.get(toolName)
        rows.push({
          name: toolName,
          organ: organForTool(toolName),
          description: clip(safeString(schema && schema.description, 400), 400),
          calls: metric ? metric.calls : 0,
          errors: metric ? metric.errors : 0,
          avgMs: metric && metric.calls > 0 ? Math.round(metric.totalMs / metric.calls) : 0,
          kind: classifyToolKind(toolName),
        })
      } catch {
        // skip malformed schema
      }
    }
    return rows
  }

  /** @returns {AgentView[]} */
  collectAgents() {
    const rows = []
    const agentsService = this.getService('agents')
    let list = []
    try {
      if (agentsService && typeof agentsService.list === 'function') list = agentsService.list()
    } catch (error) {
      this.warn('agents.list() failed', error)
      return rows
    }
    if (!Array.isArray(list)) return rows
    const sessionsService = this.getService('sessions')
    const titleService = this.getService('sessionTitle')
    for (const agent of list) {
      if (rows.length >= MAX_AGENTS) break
      try {
        const id = safeString(agent && agent.id, 120)
        if (!id) continue
        const bookkeeping = this.agents.get(id)
        const view = {
          id,
          status: bookkeeping && (bookkeeping.status === 'running' || bookkeeping.status === 'idle') ? bookkeeping.status : 'unknown',
          organ: bookkeeping && bookkeeping.organ ? bookkeeping.organ : 'cortex',
        }
        if (bookkeeping && bookkeeping.startedAt > 0) view.startedAt = bookkeeping.startedAt
        try {
          if (titleService && typeof titleService.get === 'function' && sessionsService && typeof sessionsService.get === 'function') {
            const session = sessionsService.get(id)
            if (session) {
              const title = titleService.get(session)
              const text = safeString(title && title.title, 120)
              if (text) view.title = text
            }
          }
        } catch {
          // titles are optional decoration
        }
        rows.push(view)
      } catch {
        // skip malformed agent
      }
    }
    return rows
  }

  /** @returns {{providers:object[],models:object[],default:object|null}} */
  collectModels() {
    const providers = []
    const providerIds = new Set()
    const llmService = this.getService('llm')
    try {
      if (llmService && typeof llmService.listProviders === 'function') {
        const list = llmService.listProviders()
        if (Array.isArray(list)) {
          for (const provider of list) {
            const id = safeString(provider && provider.id, 80)
            if (!id || providerIds.has(id)) continue
            providerIds.add(id)
            providers.push({ id, name: safeString(provider && provider.name, 120) || id })
          }
        }
      }
    } catch (error) {
      this.warn('llm.listProviders() failed', error)
    }
    try {
      if (llmService && typeof llmService.listConfigurableProviders === 'function') {
        const list = llmService.listConfigurableProviders()
        if (Array.isArray(list)) {
          for (const entry of list) {
            const id = safeString(entry && entry.provider, 80)
            if (!id || providerIds.has(id)) continue
            providerIds.add(id)
            providers.push({ id, name: safeString(entry && entry.displayName, 120) || id })
          }
        }
      }
    } catch {
      // configurable directory is optional
    }
    let defaultSelection = null
    try {
      const defaultModel = this.getService('agentDefaultModel')
      if (defaultModel && typeof defaultModel.currentSelection === 'function') {
        const selection = defaultModel.currentSelection()
        if (isRecord(selection)) {
          const provider = safeString(selection.provider, 80)
          const model = safeString(selection.model, 80)
          if (provider && model) {
            defaultSelection = { provider, model }
            this.rememberModel(provider, model)
          }
        }
      }
    } catch {
      // default selection is optional
    }
    const models = []
    for (const value of this.modelSeen.values()) {
      if (models.length >= MAX_MODELS) break
      models.push({ provider: value.provider, id: value.model, name: value.model })
    }
    models.sort((left, right) => {
      const providerOrder = left.provider.localeCompare(right.provider)
      return providerOrder !== 0 ? providerOrder : left.id.localeCompare(right.id)
    })
    return { providers: providers.slice(0, 50), models, default: defaultSelection }
  }

  /** @returns {BundleView[]} */
  collectBundles() {
    if (nowMs() - this.bundleCache.at > BUNDLE_CACHE_TTL_MS) this.refreshBundles()
    const items = Array.isArray(this.bundleCache.items) ? this.bundleCache.items : []
    const rows = []
    for (const bundle of items) {
      if (rows.length >= 100) break
      try {
        const bundleName = safeString(bundle && bundle.name, 160)
        if (!bundleName) continue
        const view = { name: bundleName, enabled: bundle.enabled === true }
        const version = safeString(bundle && bundle.version, 60)
        if (version) view.version = version
        if (typeof bundle.official === 'boolean') view.official = bundle.official
        rows.push(view)
      } catch {
        // skip malformed bundle
      }
    }
    return rows
  }

  /** @returns {{rootUid:number, fibers:FiberView[]}} */
  collectTopology() {
    const fibers = []
    try {
      const registry = this.ctx && this.ctx.registry
      if (registry && typeof registry.entries === 'function') {
        for (const entry of registry.entries()) {
          if (fibers.length >= MAX_FIBERS) break
          let runtime
          try {
            runtime = Array.isArray(entry) ? entry[1] : entry
          } catch {
            runtime = null
          }
          if (!isRecord(runtime)) continue
          let runtimeFibers = []
          try {
            // Cordis stores fibers in a `DisposableList`, which is iterable but
            // NOT an Array. Support arrays, iterables and array-likes alike.
            const list = runtime.fibers
            if (Array.isArray(list)) runtimeFibers = list
            else if (list && typeof list[Symbol.iterator] === 'function') runtimeFibers = [...list]
            else if (list && typeof list.length === 'number') runtimeFibers = Array.prototype.slice.call(list)
            else runtimeFibers = []
          } catch {
            runtimeFibers = []
          }
          for (const fiber of runtimeFibers) {
            if (fibers.length >= MAX_FIBERS) break
            try {
              const uid = typeof fiber.uid === 'number' ? fiber.uid : -1
              let parentUid = null
              const rawParentUid = fiber && fiber.parent && fiber.parent.fiber ? fiber.parent.fiber.uid : null
              if (typeof rawParentUid === 'number' && rawParentUid !== 0) parentUid = rawParentUid
              const view = {
                uid,
                parentUid,
                name: clip(safeString(runtime.name, 120) || safeString(fiber.runtime && fiber.runtime.name, 120) || 'root', 120),
                state: fiberStateName(fiber.state) || 'unknown',
                plugin: Boolean(fiber.runtime),
                provides: [],
                inject: [],
              }
              try {
                view.provides = Object.keys(fiber.store ?? {}).slice(0, 20)
              } catch {
                view.provides = []
              }
              try {
                view.inject = Object.keys(fiber.inject ?? {}).slice(0, 20)
              } catch {
                view.inject = []
              }
              fibers.push(view)
            } catch {
              // skip malformed fiber
            }
          }
        }
      }
    } catch (error) {
      this.warn('topology collection failed', error)
    }
    return { rootUid: 0, fibers }
  }

  /** @returns {object} runtime block */
  buildRuntime() {
    let dshVersion = 'unknown'
    try {
      if (this.clientModuleRelease && this.clientModuleRelease.version) {
        dshVersion = safeString(this.clientModuleRelease.version, 60) || 'unknown'
      }
    } catch {
      dshVersion = 'unknown'
    }
    let profile = null
    let profileDir = null
    try {
      const profileContext = this.getService('profileContext')
      if (isRecord(profileContext)) {
        profile = safeString(profileContext.name, 120) || null
        profileDir = safeString(profileContext.dir, 400) || null
      }
    } catch {
      // optional launcher service
    }
    if (!profile) profile = safeString(process.env.DSH_PROFILE, 120) || null
    if (!profileDir) profileDir = safeString(process.env.DSH_PROFILE_DIR, 400) || null
    let origin = null
    try {
      // Resolve through the same fallback path as route registration: a
      // ctx.get() miss must not hide the injected webServer from the snapshot.
      const webServer = this.resolveWebServer()
      if (webServer && typeof webServer.getOrigin === 'function') origin = safeString(webServer.getOrigin(), 400) || null
    } catch {
      origin = null
    }
    let cwd = ''
    try {
      cwd = safeString(process.cwd(), 400)
    } catch {
      cwd = ''
    }
    const hostname = safeString(process.env.COMPUTERNAME, 120) || safeString(process.env.HOSTNAME, 120) || 'unknown'
    return {
      dshVersion,
      node: safeString(process.version, 40) || 'unknown',
      platform: `${safeString(process.platform, 20)} ${safeString(process.arch, 20)}`.trim(),
      pid: typeof process.pid === 'number' ? process.pid : 0,
      hostname,
      profile,
      profileDir,
      cwd,
      startedAt: this.startedAt,
      uptimeSec: Math.max(0, Math.round((nowMs() - this.startedAt) / 1000)),
      origin,
    }
  }

  // ── 06.7 snapshot: derived metrics and organ views ──────────────────────

  /** @returns {object} live metrics block */
  liveMetrics() {
    const second = currentSecond()
    const window = (field, seconds) => seriesWindow(this.series, field, seconds, second)
    const eventsInTwo = window('events', 2)
    return {
      eventsPerSec: round1(eventsInTwo / 2),
      toolCallsPerMin: round1(window('toolCalls', WINDOW_SECONDS)),
      llmCallsPerMin: round1(window('llmCalls', WINDOW_SECONDS)),
      tokensPerMin: round1(window('tokens', WINDOW_SECONDS)),
      errorsPerMin: round1(window('errors', WINDOW_SECONDS)),
      approvalsPerMin: round1(window('approvals', WINDOW_SECONDS)),
      fsOpsPerMin: round1(window('fsOps', WINDOW_SECONDS)),
      uptimeSec: Math.max(0, Math.round((nowMs() - this.startedAt) / 1000)),
    }
  }

  /** @returns {object} one organ's rolling metrics */
  organMetrics(organ) {
    const second = currentSecond()
    const series = this.orgSeries.get(organ)
    const events = seriesWindow(series, 'events', WINDOW_SECONDS, second)
    const errors = seriesWindow(series, 'errors', WINDOW_SECONDS, second)
    const calls = seriesWindow(series, 'calls', WINDOW_SECONDS, second)
    const ms = seriesWindow(series, 'ms', WINDOW_SECONDS, second)
    return {
      eventsPerMin: round1(events),
      errorsPerMin: round1(errors),
      callsPerMin: round1(calls),
      avgMs: calls > 0 ? Math.round(ms / calls) : 0,
    }
  }

  /** @returns {Record<string,object>} all organ metrics */
  orgMetricsView() {
    const result = {}
    for (const organ of ORGAN_IDS) result[organ] = this.organMetrics(organ)
    return result
  }

  /** @returns {Record<string,{calls:number,errors:number,avgMs:number,minMs:number,maxMs:number}>} */
  toolMetricsView() {
    const result = {}
    let count = 0
    for (const [toolName, metric] of this.toolMetrics) {
      if (count >= 120) break
      if (!metric) continue
      result[toolName] = {
        calls: metric.calls,
        errors: metric.errors,
        avgMs: metric.calls > 0 ? Math.round(metric.totalMs / metric.calls) : 0,
        // Added for the call-detail view; optional fields, consumers tolerate
        // their absence on older snapshots.
        minMs: Number.isFinite(metric.minMs) ? Math.round(metric.minMs) : 0,
        maxMs: Number.isFinite(metric.maxMs) ? Math.round(metric.maxMs) : 0,
      }
      count += 1
    }
    return result
  }

  /** Number of live agents currently reported as running. */
  countRunningAgents() {
    let running = 0
    for (const record of this.agents.values()) if (record && record.status === 'running') running += 1
    return running
  }

  /** @returns {number} live session count (0 when the service is unavailable) */
  countSessions() {
    try {
      const sessionsService = this.getService('sessions')
      if (sessionsService && typeof sessionsService.list === 'function') {
        const list = sessionsService.list()
        if (Array.isArray(list)) return list.length
      }
    } catch {
      // count is cosmetic
    }
    return 0
  }

  /**
   * One organ's visual vitals (status + intensity) from its rolling counters.
   * Shared by the full snapshot (collectOrgans) and the cheap lite first-paint
   * snapshot (buildLiteSnapshot) so both always agree.
   * @param {object} def - organ definition
   * @param {number} components - plugins+services+tools+visible agents
   * @param {number} failedPlugins - failed plugin rows owned by the organ
   * @param {number} [runningAgents] - optional precomputed running-agent count
   * @returns {{status:string,intensity:number,events10:number,errors15:number,approvals30:number}}
   */
  organVitals(def, components, failedPlugins, runningAgents) {
    const second = currentSecond()
    const series = this.orgSeries.get(def.id)
    const events10 = seriesWindow(series, 'events', 10, second)
    const calls10 = seriesWindow(series, 'calls', 10, second)
    const errors15 = seriesWindow(series, 'errors', 15, second)
    const approvals30 = seriesWindow(series, 'approvals', 30, second)
    const activeAgents = typeof runningAgents === 'number' ? runningAgents : this.countRunningAgents()
    let intensity = clamp01((events10 + calls10 * 1.5) / 20)
    if (def.id === 'heart' && this.activeLlm > 0) intensity = Math.max(intensity, 0.65)
    if (def.id === 'cortex' && activeAgents > 0) intensity = Math.max(intensity, 0.5)
    if (def.id === 'stomach' && this.runningTools > 0) intensity = Math.max(intensity, 0.45)
    let status = 'idle'
    if (components === 0) status = 'offline'
    else if (errors15 > 0) status = 'error'
    else if (approvals30 > 0 || failedPlugins > 0) status = 'warn'
    else if (events10 > 0 || intensity > 0.02) status = 'active'
    return { status, intensity: Math.round(intensity * 100) / 100, events10, errors15, approvals30 }
  }

  /**
   * Build the 14 OrganViews from the collected inventories.
   * @param {object[]} plugins
   * @param {object[]} services
   * @param {object[]} tools
   * @param {object[]} clientBundles
   * @param {object[]} agents
   * @returns {object[]}
   */
  collectOrgans(plugins, services, tools, clientBundles, agents) {
    const pluginsByOrgan = new Map()
    const servicesByOrgan = new Map()
    const toolsByOrgan = new Map()
    const agentsByOrgan = new Map()
    const failedPluginsByOrgan = new Map()
    const push = (map, organ, value) => {
      if (!ORGAN_BY_ID.has(organ)) organ = 'spine'
      let list = map.get(organ)
      if (!list) {
        list = []
        map.set(organ, list)
      }
      if (list.length < MAX_ORGAN_MEMBERS) list.push(value)
    }
    try {
      for (const plugin of plugins) {
        push(pluginsByOrgan, plugin.organ, plugin.entryId)
        if (plugin.fiberPhase === 'failed') {
          failedPluginsByOrgan.set(plugin.organ, (failedPluginsByOrgan.get(plugin.organ) ?? 0) + 1)
        }
      }
    } catch {
      // degrade to empty members
    }
    try {
      for (const service of services) push(servicesByOrgan, service.organ, service.name)
    } catch {
      // degrade
    }
    try {
      for (const tool of tools) push(toolsByOrgan, tool.organ, tool.name)
    } catch {
      // degrade
    }
    try {
      for (const agent of agents) {
        const organ = agent.organ === 'agents' ? 'agents' : 'cortex'
        push(agentsByOrgan, organ, agent.id)
      }
    } catch {
      // degrade
    }
    const runningAgents = this.countRunningAgents()
    const views = []
    for (const def of ORGAN_DEFS) {
      try {
        const organPlugins = (pluginsByOrgan.get(def.id) ?? []).slice().sort()
        const organServices = (servicesByOrgan.get(def.id) ?? []).slice().sort()
        const organTools = (toolsByOrgan.get(def.id) ?? []).slice().sort()
        const organAgents = agentsByOrgan.get(def.id) ?? []
        const skinClientCount = def.id === 'skin' ? clientBundles.length : 0
        const components = organPlugins.length + organServices.length + organTools.length + organAgents.length + skinClientCount
        const failedPlugins = failedPluginsByOrgan.get(def.id) ?? 0
        const vitals = this.organVitals(def, components, failedPlugins, runningAgents)
        views.push({
          id: def.id,
          nameZh: def.nameZh,
          nameEn: def.nameEn,
          descZh: def.descZh,
          descEn: def.descEn,
          kind: def.kind,
          x: def.x,
          y: def.y,
          size: def.size,
          status: vitals.status,
          intensity: vitals.intensity,
          metrics: this.organMetrics(def.id),
          plugins: organPlugins,
          services: organServices,
          tools: organTools,
          agents: organAgents.length,
        })
      } catch (error) {
        this.warn(`organ view ${def.id} failed`, error)
        views.push({
          id: def.id,
          nameZh: def.nameZh,
          nameEn: def.nameEn,
          descZh: def.descZh,
          descEn: def.descEn,
          kind: def.kind,
          x: def.x,
          y: def.y,
          size: def.size,
          status: 'offline',
          intensity: 0,
          metrics: { eventsPerMin: 0, errorsPerMin: 0, callsPerMin: 0, avgMs: 0 },
          plugins: [],
          services: [],
          tools: [],
          agents: 0,
        })
      }
    }
    return views
  }

  // ── 06.8a v8.8 first paint: lite snapshot + full-snapshot cache ─────────

  /** Cheap DSH version lookup for the lite frame (no inventory walk). */
  quickDshVersion() {
    try {
      if (this.clientModuleRelease && this.clientModuleRelease.version) {
        return safeString(this.clientModuleRelease.version, 60) || 'unknown'
      }
      const clientModules = this.getService('clientModules')
      const graph = clientModules && typeof clientModules.graph === 'function' ? clientModules.graph() : null
      if (graph && isRecord(graph.release)) {
        this.clientModuleRelease = graph.release
        return safeString(graph.release.version, 60) || 'unknown'
      }
    } catch {
      // release identity is cosmetic for first paint
    }
    return 'unknown'
  }

  /**
   * Minimal inventory probe for the lite snapshot: names/phases only, no
   * PluginView/ServiceView/ToolView objects, no fiber tree, no method
   * reflection. Every source is isolated; on a real profile this is a few ms.
   * @returns {{pluginRows:object[],services:string[],tools:string[],agents:object[],clientBundles:number}}
   */
  quickInventories() {
    const result = { pluginRows: [], services: [], tools: [], agents: [], clientBundles: 0 }
    // Loader entries: one cheap iteration; group rows are composition nodes.
    try {
      const loader = this.getService('loader')
      if (loader && typeof loader.entries === 'function') {
        for (const entry of loader.entries()) {
          try {
            const options = isRecord(entry && entry.options) ? entry.options : {}
            if (options.group === true) continue
            const entryId = this.loaderEntryId(entry)
            if (!entryId) continue
            const moduleName = safeString(options.name, 200) || entryId
            let phase = null
            try {
              const fiber = entry.fiber
              if (fiber) phase = fiberStateName(fiber.state)
            } catch {
              phase = null
            }
            result.pluginRows.push({ moduleName, phase })
          } catch {
            // skip malformed entry
          }
        }
      }
    } catch {
      // Loader is optional
    }
    // pluginManager fallback when the Loader is unavailable or empty.
    if (result.pluginRows.length === 0) {
      try {
        const items = Array.isArray(this.pluginCache.items) ? this.pluginCache.items : []
        for (const item of items) {
          const moduleName = safeString(item && item.moduleName, 200)
          if (!moduleName) continue
          result.pluginRows.push({ moduleName, phase: safeString(item.fiberPhase, 20) || null })
        }
      } catch {
        // optional cache
      }
      if (nowMs() - this.pluginCache.at > PLUGIN_CACHE_TTL_MS) this.refreshPlugins()
    }
    // Services: unique impl names only (no method-name reflection).
    try {
      const reflect = this.ctx && this.ctx.reflect
      const store = reflect ? reflect.store : undefined
      if (isRecord(store)) {
        const seen = new Set()
        for (const key of Reflect.ownKeys(store)) {
          try {
            const impl = store[key]
            if (!isRecord(impl)) continue
            const serviceName = safeString(impl.name, 120) || safeString(key, 120)
            if (!serviceName || seen.has(serviceName)) continue
            seen.add(serviceName)
            result.services.push(serviceName)
          } catch {
            // skip malformed service record
          }
        }
      }
    } catch {
      // reflect is optional
    }
    // Tools: the public global schema view (already deep-cloned by the service).
    try {
      const service = this.getService('tools')
      if (service && typeof service.schemas === 'function') {
        const schemas = service.schemas()
        if (Array.isArray(schemas)) {
          for (const schema of schemas) {
            const toolName = safeString(schema && schema.name, 120)
            if (toolName) result.tools.push(toolName)
          }
        }
      }
    } catch {
      // tools are optional
    }
    // Agents: identities and owning organ only.
    try {
      const agentsService = this.getService('agents')
      if (agentsService && typeof agentsService.list === 'function') {
        const list = agentsService.list()
        if (Array.isArray(list)) {
          for (const agent of list) {
            const id = safeString(agent && agent.id, 120)
            if (!id) continue
            const bookkeeping = this.agents.get(id)
            result.agents.push({ id, organ: bookkeeping && bookkeeping.organ === 'agents' ? 'agents' : 'cortex' })
          }
        }
      }
    } catch {
      // agents are optional
    }
    // Client bundle rows power the skin's composition count.
    try {
      const clientModules = this.getService('clientModules')
      const graph = clientModules && typeof clientModules.graph === 'function' ? clientModules.graph() : null
      if (graph && Array.isArray(graph.entries)) {
        result.clientBundles = graph.entries.length
        if (isRecord(graph.release)) this.clientModuleRelease = graph.release
      }
    } catch {
      // client modules are optional
    }
    return result
  }

  /**
   * Count all organ members without the MAX_ORGAN_MEMBERS display cap.
   * @returns {Map<string,{plugins:number,services:number,tools:number,agents:number}>}
   */
  countOrganMembers(plugins, services, tools, agents) {
    const counts = new Map()
    const ensure = organ => {
      const safeOrgan = ORGAN_BY_ID.has(organ) ? organ : 'spine'
      let entry = counts.get(safeOrgan)
      if (!entry) {
        entry = { plugins: 0, services: 0, tools: 0, agents: 0 }
        counts.set(safeOrgan, entry)
      }
      return entry
    }
    try {
      for (const plugin of Array.isArray(plugins) ? plugins : []) ensure(plugin && plugin.organ).plugins += 1
    } catch {
      // degrade
    }
    try {
      for (const service of Array.isArray(services) ? services : []) ensure(service && service.organ).services += 1
    } catch {
      // degrade
    }
    try {
      for (const tool of Array.isArray(tools) ? tools : []) ensure(tool && tool.organ).tools += 1
    } catch {
      // degrade
    }
    try {
      for (const agent of Array.isArray(agents) ? agents : []) {
        ensure(agent && agent.organ === 'agents' ? 'agents' : 'cortex').agents += 1
      }
    } catch {
      // degrade
    }
    return counts
  }

  /** Counts block derived from a full snapshot (no inventory walk). */
  liteCountsFromFull(full) {
    const counts = isRecord(full && full.counts) ? full.counts : {}
    const count = value => {
      const numeric = Number(value)
      return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
    }
    return {
      plugins: count(counts.plugins),
      pluginsActive: count(counts.pluginsActive),
      pluginsFailed: count(counts.pluginsFailed),
      services: count(counts.services),
      tools: count(counts.tools),
      agents: count(counts.agents),
      sessions: count(counts.sessions),
      eventsTotal: count(counts.eventsTotal),
      organs: ORGAN_DEFS.length,
    }
  }

  /** One light organ row in the lite snapshot vocabulary. */
  liteOrganRow(def, counts, vitals) {
    let plugins = Number(counts && counts.plugins)
    let services = Number(counts && counts.services)
    let tools = Number(counts && counts.tools)
    let agents = Number(counts && counts.agents)
    if (!Number.isFinite(plugins) || plugins < 0) plugins = 0
    if (!Number.isFinite(services) || services < 0) services = 0
    if (!Number.isFinite(tools) || tools < 0) tools = 0
    if (!Number.isFinite(agents) || agents < 0) agents = 0
    const intensity = clamp01(Number(vitals && vitals.intensity))
    return {
      id: def.id,
      name: def.nameZh,
      nameZh: def.nameZh,
      nameEn: def.nameEn,
      status: safeString(vitals && vitals.status, 20) || 'idle',
      intensity: Math.round(intensity * 100) / 100,
      activity: Math.round(intensity * 100) / 100,
      counts: {
        plugins: Math.round(plugins),
        services: Math.round(services),
        tools: Math.round(tools),
        agents: Math.round(agents),
      },
      metrics: this.organMetrics(def.id),
    }
  }

  /** One light organ row derived from the cached full snapshot's OrganView. */
  liteOrganFromFull(organ) {
    const organId = organ && ORGAN_BY_ID.has(organ.id) ? organ.id : 'spine'
    const def = ORGAN_BY_ID.get(organId)
    const memberCounts = this.snapshotCache.organCounts ? this.snapshotCache.organCounts.get(organId) : null
    const counts = memberCounts ?? {
      plugins: Array.isArray(organ && organ.plugins) ? organ.plugins.length : 0,
      services: Array.isArray(organ && organ.services) ? organ.services.length : 0,
      tools: Array.isArray(organ && organ.tools) ? organ.tools.length : 0,
      agents: Number.isFinite(Number(organ && organ.agents)) ? Number(organ.agents) : 0,
    }
    return this.liteOrganRow(def, counts, {
      status: safeString(organ && organ.status, 20) || 'idle',
      intensity: Number(organ && organ.intensity),
    })
  }

  /**
   * Build the v8.8 lite first-paint snapshot: schemaVersion/version/
   * generatedAt/seq + full counts + 14 light organ rows. Deliberately carries
   * NO plugins/services/tools/agents/models/bundles/clientBundles/topology
   * arrays. When the full-snapshot cache is warm this is a pure remap
   * (sub-millisecond); otherwise it runs the minimal inventory probe above.
   * @returns {object}
   */
  buildLiteSnapshot() {
    const startedAt = nowMs()
    const cached = this.snapshotCache.value
    let counts
    let organs
    if (cached && isRecord(cached) && Array.isArray(cached.organs)) {
      counts = this.liteCountsFromFull(cached)
      organs = cached.organs.map(organ => this.liteOrganFromFull(organ))
    } else {
      counts = {
        plugins: 0,
        pluginsActive: 0,
        pluginsFailed: 0,
        services: 0,
        tools: 0,
        agents: 0,
        sessions: 0,
        eventsTotal: this.eventsTotal,
        organs: ORGAN_DEFS.length,
      }
      organs = ORGAN_DEFS.map(def => this.liteOrganRow(def, null, { status: 'idle', intensity: 0 }))
      try {
        const inventories = this.quickInventories()
        const memberCounts = new Map()
        const ensure = organ => {
          const safeOrgan = ORGAN_BY_ID.has(organ) ? organ : 'spine'
          let entry = memberCounts.get(safeOrgan)
          if (!entry) {
            entry = { plugins: 0, services: 0, tools: 0, agents: 0 }
            memberCounts.set(safeOrgan, entry)
          }
          return entry
        }
        const failedByOrgan = new Map()
        let pluginsActive = 0
        let pluginsFailed = 0
        for (const row of inventories.pluginRows) {
          const organ = organForPlugin(row.moduleName)
          ensure(organ).plugins += 1
          if (row.phase === 'active') pluginsActive += 1
          if (row.phase === 'failed') {
            pluginsFailed += 1
            failedByOrgan.set(organ, (failedByOrgan.get(organ) ?? 0) + 1)
          }
        }
        for (const serviceName of inventories.services) ensure(organForService(serviceName)).services += 1
        for (const toolName of inventories.tools) ensure(organForTool(toolName)).tools += 1
        for (const agent of inventories.agents) ensure(agent.organ).agents += 1
        // Client bundles render on the skin; the full snapshot shows them as
        // client-kind plugin rows.
        if (inventories.clientBundles > 0) ensure('skin').plugins += inventories.clientBundles
        const runningAgents = this.countRunningAgents()
        counts = {
          plugins: inventories.pluginRows.length + inventories.clientBundles,
          pluginsActive,
          pluginsFailed,
          services: inventories.services.length,
          tools: inventories.tools.length,
          agents: inventories.agents.length,
          sessions: this.countSessions(),
          eventsTotal: this.eventsTotal,
          organs: ORGAN_DEFS.length,
        }
        organs = ORGAN_DEFS.map(def => {
          const members = memberCounts.get(def.id) ?? { plugins: 0, services: 0, tools: 0, agents: 0 }
          const components = members.plugins + members.services + members.tools + members.agents
          const vitals = this.organVitals(def, components, failedByOrgan.get(def.id) ?? 0, runningAgents)
          return this.liteOrganRow(def, members, vitals)
        })
      } catch (error) {
        this.warn('lite inventory probe failed', error)
      }
    }
    const lite = {
      // The flag lives inside the snapshot too: the client's onSnapshot hook
      // receives only frame.snapshot, so it can tell a first-paint frame apart.
      lite: true,
      schemaVersion: SCHEMA_VERSION,
      version: cached && isRecord(cached.runtime) ? safeString(cached.runtime.dshVersion, 60) || 'unknown' : this.quickDshVersion(),
      generatedAt: nowMs(),
      seq: this.seq,
      counts,
      organs,
    }
    this.lastLiteBuildMs = Math.max(0, nowMs() - startedAt)
    return lite
  }

  /**
   * Return the complete snapshot from the short TTL cache, or build it once.
   * A reentrant caller during an in-flight synchronous build reuses the
   * previous value instead of starting a second inventory walk (coalescing).
   * @returns {object}
   */
  getFullSnapshot() {
    const cache = this.snapshotCache
    const now = nowMs()
    if (cache.value && cache.builtAt > 0 && now - cache.builtAt <= SNAPSHOT_CACHE_TTL_MS) {
      this.snapshotCacheHits += 1
      return cache.value
    }
    if (this.snapshotBuildInFlight && cache.value) {
      this.snapshotCacheHits += 1
      return cache.value
    }
    this.snapshotCacheMisses += 1
    this.snapshotBuildInFlight = true
    const startedAt = nowMs()
    try {
      const value = this.buildFullSnapshot()
      cache.value = value
      cache.builtAt = nowMs()
      try {
        cache.organCounts = this.countOrganMembers(value.plugins, value.services, value.tools, value.agents)
      } catch {
        cache.organCounts = null
      }
      this.lastFullBuildMs = Math.max(0, cache.builtAt - startedAt)
      return value
    } finally {
      this.snapshotBuildInFlight = false
    }
  }

  /** Back-compat alias: callers get the cached full snapshot. */
  buildSnapshot() {
    return this.getFullSnapshot()
  }

  // ── 06.8b snapshot assembly ─────────────────────────────────────────────

  /**
   * Build a complete, defensive snapshot (CONTRACT §3).
   * Every source is isolated: one broken inventory degrades to an empty array.
   * @returns {object}
   */
  buildFullSnapshot() {
    const generatedAt = nowMs()
    // Source collection, one try/catch per block.
    let clientBundles = []
    try {
      clientBundles = this.collectClientBundles()
    } catch (error) {
      this.warn('client bundle collection failed', error)
    }
    let runtime = null
    try {
      runtime = this.buildRuntime()
    } catch (error) {
      this.warn('runtime block failed', error)
      runtime = {
        dshVersion: 'unknown', node: 'unknown', platform: 'unknown', pid: 0, hostname: 'unknown',
        profile: null, profileDir: null, cwd: '', startedAt: this.startedAt, uptimeSec: 0, origin: null,
      }
    }
    let plugins = []
    try {
      plugins = this.collectPlugins()
    } catch (error) {
      this.warn('plugin collection failed', error)
    }
    let services = []
    try {
      services = this.collectServices()
    } catch (error) {
      this.warn('service collection failed', error)
    }
    let tools = []
    try {
      tools = this.collectTools()
    } catch (error) {
      this.warn('tool collection failed', error)
    }
    let agents = []
    try {
      agents = this.collectAgents()
    } catch (error) {
      this.warn('agent collection failed', error)
    }
    let models = { providers: [], models: [], default: null }
    try {
      models = this.collectModels()
    } catch (error) {
      this.warn('model collection failed', error)
    }
    let bundles = []
    try {
      bundles = this.collectBundles()
    } catch (error) {
      this.warn('bundle collection failed', error)
    }
    let topology = { rootUid: 0, fibers: [] }
    try {
      topology = this.collectTopology()
    } catch (error) {
      this.warn('topology collection failed', error)
    }
    let organs = []
    try {
      organs = this.collectOrgans(plugins, services, tools, clientBundles, agents)
    } catch (error) {
      this.warn('organ assembly failed', error)
      organs = ORGAN_DEFS.map(def => ({
        id: def.id, nameZh: def.nameZh, nameEn: def.nameEn, descZh: def.descZh, descEn: def.descEn,
        kind: def.kind, x: def.x, y: def.y, size: def.size, status: 'offline', intensity: 0,
        metrics: { eventsPerMin: 0, errorsPerMin: 0, callsPerMin: 0, avgMs: 0 },
        plugins: [], services: [], tools: [], agents: 0,
      }))
    }
    let live = { eventsPerSec: 0, toolCallsPerMin: 0, llmCallsPerMin: 0, tokensPerMin: 0, errorsPerMin: 0, approvalsPerMin: 0, fsOpsPerMin: 0, uptimeSec: 0 }
    try {
      live = this.liveMetrics()
    } catch (error) {
      this.warn('live metrics failed', error)
    }
    let orgMetrics = {}
    try {
      orgMetrics = this.orgMetricsView()
    } catch (error) {
      this.warn('organ metrics failed', error)
    }
    let toolMetrics = {}
    try {
      toolMetrics = this.toolMetricsView()
    } catch (error) {
      this.warn('tool metrics failed', error)
    }
    let sessions = 0
    try {
      sessions = this.countSessions()
    } catch {
      sessions = 0
    }
    const snapshot = {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      seq: this.seq,
      runtime,
      organs,
      plugins,
      services,
      tools,
      agents,
      models,
      bundles,
      clientBundles,
      topology,
      counts: {
        plugins: plugins.length,
        pluginsActive: plugins.filter(plugin => plugin.fiberPhase === 'active').length,
        pluginsFailed: plugins.filter(plugin => plugin.fiberPhase === 'failed').length,
        services: services.length,
        tools: tools.length,
        agents: agents.length,
        sessions,
        eventsTotal: this.eventsTotal,
        organs: ORGAN_DEFS.length,
      },
      live,
      orgMetrics,
      toolMetrics,
    }
    this.snapshotVersion += 1
    this.lastSnapshotBuildAt = generatedAt
    return snapshot
  }

  // ── 06.9 HTTP routes ────────────────────────────────────────────────────

  /**
   * Write one JSON HTTP response defensively.
   * @returns {number} serialized body size in bytes (0 when unknown)
   */
  writeJson(res, status, payload, extraHeaders) {
    let body
    try {
      body = JSON.stringify(payload)
      if (typeof body !== 'string') body = '{"ok":false,"error":"response is not JSON"}'
    } catch (error) {
      body = JSON.stringify({ ok: false, error: errorText(error, 160) })
    }
    let bodyBytes = 0
    try {
      bodyBytes = byteLength(body)
    } catch {
      bodyBytes = 0
    }
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // Read-only public observability: the Web UI may reach this route either
      // same-origin (browser / dsh-app forwarding) or from the Host's real
      // origin (__DSH_TRANSPORT__.streamBaseUrl). The second case is
      // cross-origin, so every route advertises the wildcard. No credentials
      // are sent and no state exists to protect.
      'access-control-allow-origin': '*',
      ...(extraHeaders ?? {}),
    }
    if (bodyBytes > 0) headers['content-length'] = String(bodyBytes)
    try {
      if (res && typeof res.writeHead === 'function') {
        res.writeHead(status, headers)
      } else if (res && typeof res.setHeader === 'function') {
        for (const [headerName, headerValue] of Object.entries(headers)) {
          try {
            res.setHeader(headerName, headerValue)
          } catch {
            // ignore one header
          }
        }
        if (res && typeof res === 'object') res.statusCode = status
      }
    } catch {
      // headers already sent / fake response
    }
    try {
      if (res && typeof res.end === 'function') res.end(body)
    } catch {
      // a dead response must not throw into the route
    }
    return bodyBytes
  }

  /** Wrap a route handler with method filtering and a catch-all. */
  routeWrapper(label, handler) {
    const hub = this
    return function dshAnatomyRoute(req, res) {
      try {
        const method = req && typeof req.method === 'string' ? req.method.toUpperCase() : 'GET'
        if (method === 'OPTIONS') {
          // Simple GET clients do not preflight, but a browser MAY preflight
          // when its transport asks for a non-safelisted configuration. Answer
          // the CORS preflight rather than 405.
          try {
            res.writeHead(204, {
              'access-control-allow-origin': '*',
              'access-control-allow-methods': 'GET, OPTIONS',
              'access-control-allow-headers': 'accept, content-type',
              'access-control-max-age': '600',
              'cache-control': 'no-store',
            })
            res.end()
          } catch {
            // ignore
          }
          return
        }
        if (method !== 'GET') {
          hub.writeJson(res, 405, { ok: false, error: 'method not allowed', schemaVersion: SCHEMA_VERSION }, { allow: 'GET' })
          return
        }
        hub.noteRequest(label, req)
        handler(req, res)
      } catch (error) {
        hub.warn(`${label} route failed`, error)
        try {
          hub.writeJson(res, 500, { ok: false, error: errorText(error, 200), schemaVersion: SCHEMA_VERSION })
        } catch {
          // response already unusable
        }
      }
    }
  }

  /** Resolve the injected webServer without trusting either access form. */
  resolveWebServer() {
    let webServer
    try {
      webServer = this.getService('webServer')
    } catch {
      webServer = undefined
    }
    if (!webServer) {
      try {
        webServer = this.ctx && this.ctx.webServer
      } catch {
        webServer = undefined
      }
    }
    return webServer
  }

  /** Register the four exact routes; individual failures never abort the hub. */
  installRoutes() {
    const webServer = this.resolveWebServer()
    if (!webServer || typeof webServer.register !== 'function') {
      throw new Error(`${PLUGIN_ID}: the webServer service is unavailable; HTTP routes cannot be mounted`)
    }
    const register = (routePath, label, handler) => {
      try {
        const disposer = webServer.register({
          kind: 'exact',
          path: routePath,
          handler: this.routeWrapper(label, handler),
        })
        if (typeof disposer === 'function') this.routeDisposers.push(disposer)
      } catch (error) {
        this.warn(`could not register route ${routePath}`, error)
      }
    }
    register(ROUTES.ping, 'ping', (req, res) => this.handlePing(req, res))
    register(ROUTES.snapshot, 'snapshot', (req, res) => this.handleSnapshot(req, res))
    register(ROUTES.events, 'events', (req, res) => this.handleEvents(req, res))
    register(ROUTES.stream, 'stream', (req, res) => this.handleStream(req, res))
  }

  /** Record one inbound HTTP request for the ping diagnostics block. */
  noteRequest(label, req) {
    try {
      const at = nowMs()
      this.lastRequestAt = at
      if (label === 'ping') {
        this.httpCounts.ping += 1
        this.lastPingRequestAt = at
      } else if (label === 'snapshot') {
        this.httpCounts.snapshot += 1
        this.lastSnapshotRequestAt = at
      } else if (label === 'events') {
        this.httpCounts.events += 1
        this.lastEventsRequestAt = at
      } else if (label === 'stream') {
        this.httpCounts.stream += 1
        this.lastStreamRequestAt = at
      }
      const headers = req && isRecord(req.headers) ? req.headers : {}
      const entry = {
        route: label,
        at,
        url: clip(safeString(req && req.url, 160), 160),
        ua: clip(safeString(headers['user-agent'], 90), 90),
        origin: clip(safeString(headers.origin, 90), 90),
        referer: clip(safeString(headers.referer, 90), 90),
        host: clip(safeString(headers.host, 90), 90),
      }
      this.requestLog.push(entry)
      if (this.requestLog.length > 12) this.requestLog.shift()
    } catch {
      // diagnostics must never break a route
    }
  }

  /** Diagnostics block exposed by GET /api/ping. */
  diagnostics() {
    return {
      http: { ...this.httpCounts },
      framesSent: { ...this.framesSent },
      activeStreamClients: this.clients.size,
      lastRequestAt: this.lastRequestAt,
      lastPingRequestAt: this.lastPingRequestAt,
      lastSnapshotRequestAt: this.lastSnapshotRequestAt,
      lastEventsRequestAt: this.lastEventsRequestAt,
      lastStreamRequestAt: this.lastStreamRequestAt,
      requestLog: this.requestLog.slice(-6),
      snapshotBytes: this.lastSnapshotBytes,
      // v8.8 staged first paint / snapshot cache visibility.
      snapshot: {
        cacheTtlMs: SNAPSHOT_CACHE_TTL_MS,
        cacheHits: this.snapshotCacheHits,
        cacheMisses: this.snapshotCacheMisses,
        lastFullBuildMs: this.lastFullBuildMs,
        lastLiteBuildMs: this.lastLiteBuildMs,
        lastLiteBytes: this.lastLiteBytes,
        lastSnapshotRequestMs: this.lastSnapshotRequestMs,
      },
      uptimeMs: Math.max(0, nowMs() - this.startedAt),
    }
  }

  /** GET /api/ping */
  handlePing(_req, res) {
    this.writeJson(res, 200, {
      ok: true,
      plugin: PLUGIN_ID,
      schemaVersion: SCHEMA_VERSION,
      uptimeMs: Math.max(0, nowMs() - this.startedAt),
      diagnostics: this.diagnostics(),
    })
  }

  /** GET /api/snapshot */
  handleSnapshot(_req, res) {
    const startedAt = nowMs()
    let snapshot
    try {
      // Cached (2 s TTL) + coalesced: repeats and stream reconnects are cheap.
      snapshot = this.buildSnapshot()
    } catch (error) {
      this.warn('snapshot request failed', error)
      this.writeJson(res, 500, { ok: false, error: 'snapshot build failed', schemaVersion: SCHEMA_VERSION })
      return
    }
    this.lastSnapshotRequestMs = Math.max(0, nowMs() - startedAt)
    // `writeJson` serializes once; reuse its byte count instead of stringifying
    // the (large) snapshot a second time just for diagnostics.
    try {
      this.lastSnapshotBytes = this.writeJson(res, 200, snapshot) || 0
    } catch {
      this.lastSnapshotBytes = 0
      this.writeJson(res, 200, snapshot)
    }
  }

  /** GET /api/events?after=&limit= */
  handleEvents(req, res) {
    const query = parseQuery(req && req.url)
    let after = toInt(query.after, 0)
    if (!Number.isFinite(after) || after < 0) after = 0
    let limit = toInt(query.limit, DEFAULT_EVENTS_LIMIT)
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_EVENTS_LIMIT
    if (limit > MAX_EVENTS_LIMIT) limit = MAX_EVENTS_LIMIT
    const oldest = this.oldestSeq()
    const reset = after < oldest - 1
    let events = []
    try {
      events = this.readEventsAfter(after, limit)
    } catch (error) {
      this.warn('event lookup failed', error)
      events = []
    }
    let metrics
    let orgMetrics
    let toolMetrics
    try {
      metrics = this.liveMetrics()
      orgMetrics = this.orgMetricsView()
      toolMetrics = this.toolMetricsView()
    } catch (error) {
      this.warn('event payload metrics failed', error)
      metrics = { eventsPerSec: 0, toolCallsPerMin: 0, llmCallsPerMin: 0, tokensPerMin: 0, errorsPerMin: 0, approvalsPerMin: 0, fsOpsPerMin: 0, uptimeSec: 0 }
      orgMetrics = {}
      toolMetrics = {}
    }
    // "The snapshot is stale" window: a pending topology change or a recent
    // topology push both tell a poller it should refetch /api/snapshot.
    const recentlyPushed = this.lastTopologyPushAt > 0 && nowMs() - this.lastTopologyPushAt < 3000
    // `seq` is the polling cursor: the last event id actually delivered in
    // this response (never the hub head, which would let a truncated page
    // silently skip events). With no events it is the current head.
    const deliveredSeq = events.length > 0 ? events[events.length - 1].id : this.seq
    this.writeJson(res, 200, {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      seq: deliveredSeq,
      reset,
      events,
      metrics,
      orgMetrics,
      toolMetrics,
      snapshotChanged: this.dirtyAt > 0 || recentlyPushed,
    })
  }

  // ── 06.10 NDJSON stream ─────────────────────────────────────────────────

  /** GET /api/stream — one long-lived NDJSON feed. */
  handleStream(req, res) {
    if (!res || typeof res.write !== 'function') {
      this.writeJson(res, 500, { ok: false, error: 'streaming is not supported by this response object', schemaVersion: SCHEMA_VERSION })
      return
    }
    if (this.clients.size >= MAX_STREAM_CLIENTS) {
      this.writeJson(res, 503, { ok: false, error: 'too many stream clients', schemaVersion: SCHEMA_VERSION })
      return
    }
    try {
      if (typeof res.writeHead === 'function') {
        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
          'access-control-allow-origin': '*',
        })
      }
    } catch {
      // some carriers own their headers
    }
    // v8.8 staged first paint, contractual order:
    //   hello → snapshot(lite:true) → snapshot(full) → events/metrics/…
    // The lite body carries no heavy arrays and is written BEFORE the full
    // inventory walk, so the HUD skeleton paints immediately even when the
    // full snapshot takes hundreds of milliseconds to assemble.
    const client = { res, cursor: this.seq, lastWriteAt: 0, closed: false }
    const helloOk = this.writeFrame(client, { type: 'hello', schemaVersion: SCHEMA_VERSION, seq: 0, serverTime: nowMs() })
    if (!helloOk) {
      this.dropClient(client, 'initial-write-failed')
      return
    }
    try {
      const lite = this.buildLiteSnapshot()
      this.lastLiteBytes = frameBytes({ type: 'snapshot', lite: true, seq: lite.seq, snapshot: lite })
      this.writeFrame(client, this.fitLiteFrame(lite))
    } catch (error) {
      this.warn('stream lite snapshot failed', error)
    }
    let snapshot
    try {
      snapshot = this.buildSnapshot()
    } catch (error) {
      this.warn('stream snapshot failed', error)
      try {
        res.end()
      } catch {
        // ignore
      }
      return
    }
    client.cursor = snapshot.seq
    const snapshotOk = this.writeFrame(client, this.fitSnapshotFrame(snapshot))
    if (!snapshotOk) {
      this.dropClient(client, 'initial-write-failed')
      return
    }
    this.clients.add(client)
    const cleanup = () => this.dropClient(client, 'closed')
    try {
      // `res` close is the disconnect signal the contract specifies. A
      // `req` close listener is deliberately NOT used: for a bodyless GET the
      // request can be "complete" immediately, which would drop the live feed.
      if (typeof res.on === 'function') {
        res.on('close', cleanup)
        res.on('error', cleanup)
      }
    } catch {
      // an unobservable response just stays until the next failed write
    }
  }

  /** Write one NDJSON frame; applies backpressure policy and never throws. */
  writeFrame(client, payload) {
    if (!client || client.closed) return false
    const res = client.res
    if (!res) {
      client.closed = true
      return false
    }
    try {
      if (res.destroyed === true || res.writableEnded === true) {
        client.closed = true
        this.clients.delete(client)
        return false
      }
    } catch {
      // treat as dead
    }
    let line
    try {
      line = JSON.stringify(payload)
    } catch {
      return false
    }
    if (typeof line !== 'string') return false
    try {
      res.write(`${line}\n`)
      client.lastWriteAt = nowMs()
      const frameType = payload && typeof payload.type === 'string' ? payload.type : 'other'
      if (Object.prototype.hasOwnProperty.call(this.framesSent, frameType)) this.framesSent[frameType] += 1
      const buffered = typeof res.writableLength === 'number' ? res.writableLength : 0
      if (buffered > BACKPRESSURE_BYTES) {
        this.dropClient(client, 'backpressure')
        return false
      }
      return true
    } catch {
      this.dropClient(client, 'write-error')
      return false
    }
  }

  /** Remove and close one stream client. */
  dropClient(client, _reason) {
    if (!client || client.closed) return
    client.closed = true
    this.clients.delete(client)
    try {
      const res = client.res
      if (res && typeof res.end === 'function' && res.writableEnded !== true) res.end()
      else if (res && typeof res.destroy === 'function') res.destroy()
    } catch {
      // a dead socket is already dead
    }
  }

  /** Fit a snapshot into one stream frame (shape-compatible); full → lite:false. */
  fitSnapshotFrame(snapshot) {
    const wrap = candidate => ({ type: 'snapshot', lite: false, seq: candidate && typeof candidate.seq === 'number' ? candidate.seq : this.seq, snapshot: candidate })
    let frame = wrap(snapshot)
    if (frameBytes(frame) <= MAX_SNAPSHOT_FRAME_BYTES) return frame
    const topologyOf = candidate => (isRecord(candidate.topology) ? candidate.topology : { rootUid: 0, fibers: [] })
    const attempts = [
      () => ({
        ...snapshot,
        topology: { ...topologyOf(snapshot), fibers: (topologyOf(snapshot).fibers ?? []).slice(0, 300) },
        truncated: true,
      }),
      () => ({
        ...snapshot,
        topology: { ...topologyOf(snapshot), fibers: (topologyOf(snapshot).fibers ?? []).slice(0, 120) },
        plugins: snapshot.plugins.slice(0, 150),
        services: snapshot.services.slice(0, 100),
        tools: snapshot.tools.slice(0, 150),
        clientBundles: snapshot.clientBundles.slice(0, 60),
        bundles: snapshot.bundles.slice(0, 40),
        agents: snapshot.agents.slice(0, 40),
        truncated: true,
      }),
      () => ({
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        generatedAt: snapshot.generatedAt,
        seq: snapshot.seq,
        runtime: snapshot.runtime,
        organs: snapshot.organs,
        plugins: [],
        services: [],
        tools: [],
        agents: [],
        models: { providers: [], models: [], default: snapshot.models && snapshot.models.default ? snapshot.models.default : null },
        bundles: [],
        clientBundles: [],
        topology: { rootUid: 0, fibers: [] },
        counts: snapshot.counts,
        live: snapshot.live,
        orgMetrics: snapshot.orgMetrics,
        toolMetrics: snapshot.toolMetrics,
        truncated: true,
      }),
    ]
    for (const attempt of attempts) {
      try {
        const candidate = attempt()
        frame = wrap(candidate)
        if (frameBytes(frame) <= MAX_SNAPSHOT_FRAME_BYTES) return frame
      } catch {
        // try the next reduction
      }
    }
    return frame
  }

  /** Fit the lite first-paint snapshot into its ≤20 KiB budget. */
  fitLiteFrame(lite) {
    const wrap = candidate => ({ type: 'snapshot', lite: true, seq: candidate && typeof candidate.seq === 'number' ? candidate.seq : this.seq, snapshot: candidate })
    let frame = wrap(lite)
    if (frameBytes(frame) <= LITE_SNAPSHOT_TARGET_BYTES) return frame
    // Stage 1: drop the per-organ rolling metrics block.
    try {
      frame = wrap({
        ...lite,
        organs: (Array.isArray(lite.organs) ? lite.organs : []).map(organ => ({
          id: organ.id,
          name: organ.name,
          status: organ.status,
          intensity: organ.intensity,
          activity: organ.activity,
          counts: organ.counts,
        })),
        trimmed: true,
      })
      if (frameBytes(frame) <= LITE_SNAPSHOT_TARGET_BYTES) return frame
    } catch {
      // fall through to the minimal body
    }
    // Stage 2: minimal identity + counts.
    try {
      frame = wrap({ lite: true, schemaVersion: lite.schemaVersion, version: lite.version, generatedAt: lite.generatedAt, seq: lite.seq, counts: lite.counts, organs: [], trimmed: true })
    } catch {
      // keep stage 1 frame
    }
    return frame
  }

  /** Fit an events frame by dropping the tail until it fits. */
  fitEventsFrame(payload) {
    try {
      while (payload.events.length > 1 && frameBytes(payload) > MAX_FRAME_BYTES) payload.events.pop()
    } catch {
      // keep whatever we have
    }
    return payload
  }

  // ── 06.11 tick: events / metrics / topology / ping ──────────────────────

  startTimers() {
    if (this.timers.length > 0) return
    const timer = setInterval(() => {
      try {
        this.tick()
      } catch (error) {
        this.warn('anatomy tick failed', error)
      }
    }, FLUSH_INTERVAL_MS)
    this.timers.push(timer)
  }

  /** One 250 ms tick: debounced topology snapshots, event frames, metrics, pings. */
  tick() {
    if (!this.active || this.disposed) return
    const at = nowMs()

    // 1) Debounced topology snapshot (rebuild even with no clients so the
    //    polling clients' snapshotChanged flag stays meaningful).
    if (this.dirtyAt > 0 && at - this.dirtyAt >= TOPOLOGY_DEBOUNCE_MS) {
      this.dirtyAt = 0
      let snapshot = null
      try {
        snapshot = this.buildSnapshot()
      } catch (error) {
        this.warn('debounced snapshot build failed', error)
      }
      if (snapshot) {
        this.lastTopologyPushAt = at
        if (this.clients.size > 0) {
          const frame = this.fitSnapshotFrame(snapshot)
          for (const client of [...this.clients]) this.writeFrame(client, frame)
        }
      }
    }

    if (this.clients.size === 0) return

    // 2) Metrics are computed at most once per tick and reused by all frames.
    let metricsCache = null
    const metricsFor = () => {
      if (metricsCache) return metricsCache
      try {
        metricsCache = {
          metrics: this.liveMetrics(),
          orgMetrics: this.orgMetricsView(),
          toolMetrics: this.toolMetricsView(),
        }
      } catch (error) {
        this.warn('tick metrics failed', error)
        metricsCache = {
          metrics: { eventsPerSec: 0, toolCallsPerMin: 0, llmCallsPerMin: 0, tokensPerMin: 0, errorsPerMin: 0, approvalsPerMin: 0, fsOpsPerMin: 0, uptimeSec: 0 },
          orgMetrics: {},
          toolMetrics: {},
        }
      }
      return metricsCache
    }
    const sendMetricsFrame = at - this.lastMetricsFrameAt >= METRICS_INTERVAL_MS

    for (const client of [...this.clients]) {
      if (client.closed) continue
      // 2a) Incremental events (max 80 per frame).
      let events = []
      try {
        events = this.readEventsAfter(client.cursor, MAX_FRAME_EVENTS)
      } catch (error) {
        this.warn('event read for stream failed', error)
        events = []
      }
      if (events.length > 0) {
        const lastId = events[events.length - 1].id
        const payload = this.fitEventsFrame({
          type: 'events',
          seq: lastId,
          events,
          ...metricsFor(),
        })
        if (this.writeFrame(client, payload)) {
          const sent = Array.isArray(payload.events) && payload.events.length > 0
            ? payload.events[payload.events.length - 1].id
            : client.cursor
          client.cursor = sent
        }
      }
      // 2b) Periodic metrics frame. Its `seq` is the client's delivered
      // cursor, never the hub head: a client that advances its poll cursor
      // past undelivered events would lose them if the stream dropped.
      if (sendMetricsFrame) {
        this.writeFrame(client, { type: 'metrics', seq: client.cursor, ...metricsFor() })
      }
      // 2c) Idle heartbeat.
      if (client.lastWriteAt > 0 && at - client.lastWriteAt >= PING_INTERVAL_MS) {
        this.writeFrame(client, { type: 'ping', seq: this.seq, serverTime: at })
      }
    }
    if (sendMetricsFrame) this.lastMetricsFrameAt = at
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 07. Module-level snapshot helper (exported for tests via __internals)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a snapshot from a hub instance. Kept module-level so tests can call
 * `__internals.buildSnapshot(hub)` without touching Cordis.
 * @param {AnatomyHub} hub
 * @returns {object|null}
 */
function buildSnapshot(hub) {
  try {
    if (hub && typeof hub.buildSnapshot === 'function') return hub.buildSnapshot()
    return null
  } catch {
    return null
  }
}

/**
 * Build the lite first-paint snapshot from a hub instance (tests only).
 * @param {AnatomyHub} hub
 * @returns {object|null}
 */
function buildLiteSnapshot(hub) {
  try {
    if (hub && typeof hub.buildLiteSnapshot === 'function') return hub.buildLiteSnapshot()
    return null
  } catch {
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 08. Plugin entry
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mount the anatomy host half on a Cordis context.
 * @param {any} ctx - host context (must provide `webServer`; everything else is optional)
 * @param {any} [config] - unused; the plugin is configuration-free
 */
export function apply(ctx, _config) {
  const hub = new AnatomyHub(ctx)
  ctx.effect(() => {
    hub.install()
    return () => hub.dispose()
  }, `${PLUGIN_ID}: host hub`)
}

// ────────────────────────────────────────────────────────────────────────────
// 09. Harmless internals export (used by the fake-ctx selftest harness)
// ────────────────────────────────────────────────────────────────────────────

export const __internals = {
  buildSnapshot,
  buildLiteSnapshot,
  organForTool,
  organForPlugin,
  organForService,
  classifyToolKind,
  routeSessionEvent,
  fiberStateName,
  ORGAN_DEFS,
  ORGAN_IDS,
  ROUTES,
  SCHEMA_VERSION,
  createSeries,
  bumpSeries,
  seriesWindow,
}
