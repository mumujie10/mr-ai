//! 一次性标题补全（7b）：首轮结束后，用该引擎已配置的渠道跑一次轻量模型
//! 调用，把「首条用户消息截出的待办式标题」补成贴题的标题。
//!
//! 只给「没有自有命名」的引擎跑：
//! - codex 的标题来自 app 自己的 `session_index.jsonl`（codex_titles）；
//! - `mireai` / `minimax` 的标题由 CLI 首轮后生成（mcode_titles）。
//! 这两类引擎的 `sessions.title` 会持续被同步覆盖，再生成一个 auto_title
//! 只会把它盖住。其余引擎（claude/kimi/omp/…）的 `title` 永远只是扫描器截的
//! 首条消息，这里才有补全的价值。
//!
//! 生成结果写进 `session_auto_titles` 侧表（一次性、先到先得），显示优先级
//! 在自定义名与扫描标题之间；不碰 `sessions.title`，扫描器重解析也冲不掉。
//! 没有可用渠道（官方登录、没配渠道）时明确跳过：保持截断标题，不假装成功。
//!
//! 整个调用不阻塞对话：命令在自己的异步任务里 await；前端每会话只触发一次，
//! 后端再用进程内集合兜一层并发重复。

use rusqlite::OptionalExtension;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;

/// 送给模型的开场消息上限：标题只需要开头一点内容。
const MAX_SEED_CHARS: usize = 2_000;
/// 标题回复的生成上限；个别模型会先写一段推理，留出余量。
const MAX_TITLE_TOKENS: u32 = 512;
/// 生成标题的长度上限，与扫描器截首条消息的口径一致（80 字符）。
const MAX_TITLE_CHARS: usize = 80;

/// 补全结果。`status` 是给界面看的粗粒度状态（与复盘同构）：
/// - `applied`：生成了一个标题并落盘；
/// - `skipped`：没跑（该引擎自有命名 / 已有标题 / 用户重命名 / 无渠道 / 正在跑）；
/// - `failed`：跑了但失败（HTTP、回复不含可用标题、写库失败）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoTitleOutcome {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub at: i64,
}

impl AutoTitleOutcome {
    fn new(status: &str, message: Option<String>) -> Self {
        Self {
            status: status.to_string(),
            title: None,
            message,
            at: now_ms(),
        }
    }

    fn skipped(reason: &str) -> Self {
        Self::new("skipped", Some(reason.to_string()))
    }

    fn failed(message: impl Into<String>) -> Self {
        Self::new("failed", Some(message.into()))
    }

    fn applied(title: String) -> Self {
        let mut outcome = Self::new("applied", None);
        outcome.title = Some(title);
        outcome
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 这个引擎的标题是否由别处维护（codex 的 app 命名、mcode 系的 CLI 命名）。
fn own_naming(engine: &str) -> bool {
    engine == "codex" || super::mcode_titles::manages_titles(engine)
}

/// 标题提示词：只要一行、用用户的语种、不解释。
fn title_prompt(seed: &str) -> String {
    format!(
        "你是会话命名助手。根据下面这段用户的开场消息，为这场对话起一个标题。\n\
         要求：\n\
         - 用用户消息的语言；中文不超过 20 个字，其他语言不超过 60 个字符\n\
         - 概括对话主题，不评论、不加引号、不加句号、不用 Markdown\n\
         - 只输出标题本身，不要任何解释或前后缀\n\n\
         用户的开场消息：\n{seed}"
    )
}

/// 整体包裹的成对符号：引号、书名号、括号、反引号。
const WRAPPERS: [(char, char); 11] = [
    ('"', '"'),
    ('\'', '\''),
    ('`', '`'),
    ('“', '”'),
    ('‘', '’'),
    ('「', '」'),
    ('『', '』'),
    ('（', '）'),
    ('(', ')'),
    ('【', '】'),
    ('[', ']'),
];

fn strip_wrapper(text: &str) -> Option<String> {
    let first = text.chars().next()?;
    let last = text.chars().last()?;
    if text.chars().count() < 2 {
        return None;
    }
    let wrapped = WRAPPERS
        .iter()
        .any(|(open, close)| *open == first && *close == last);
    wrapped.then(|| text[first.len_utf8()..text.len() - last.len_utf8()].trim().to_string())
}

/// 把模型回复收成一行标题：取第一条非空行（「…：」独占一行时取下一行），
/// 剥掉 Markdown 标题号、「标题：」前缀和整体包裹的符号，按扫描器同一
/// 口径截到 80 字符。收不出内容返回 None。
fn clean_title(reply: &str) -> Option<String> {
    let mut lines = reply
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("```"));
    let first = lines.next()?;
    let line = if first.ends_with(['：', ':']) {
        lines.next().unwrap_or(first)
    } else {
        first
    };
    let mut title = line.trim_start_matches(['#', ' ']).trim();
    for prefix in ["标题:", "标题：", "Title:", "title:"] {
        if let Some(rest) = title.strip_prefix(prefix) {
            title = rest.trim();
        }
    }
    let mut owned = title.to_string();
    for _ in 0..2 {
        match strip_wrapper(owned.trim()) {
            Some(inner) => owned = inner,
            None => break,
        }
    }
    let cleaned = owned
        .trim()
        .trim_end_matches(['。', '．', '.'])
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return None;
    }
    let capped = super::truncate_chars(&cleaned, MAX_TITLE_CHARS);
    (!capped.is_empty()).then_some(capped)
}

/// 会话此刻能否补全标题。
enum TitleState {
    /// 可以跑：会话在、没有生成过标题、也没被用户重命名。
    Open,
    /// sessions 里没有这行（还没建或被删了）。
    Gone,
    /// 已有 auto_title。
    HasAuto,
    /// custom_title 非空：用户重命名优先，生成只会被盖住，不做。
    Renamed,
}

fn title_state(db: &crate::db::Db, engine: &str, session_id: &str) -> TitleState {
    let conn = db.0.lock();
    let row = conn
        .query_row(
            "SELECT s.custom_title, at.title FROM sessions s
             LEFT JOIN session_auto_titles at
               ON at.engine = s.engine AND at.session_id = s.session_id
             WHERE s.engine=?1 AND s.session_id=?2",
            rusqlite::params![engine, session_id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()
        .unwrap_or(None);
    match row {
        None => TitleState::Gone,
        Some((_, Some(_))) => TitleState::HasAuto,
        Some((Some(custom), _)) if !custom.trim().is_empty() => TitleState::Renamed,
        Some(_) => TitleState::Open,
    }
}

/// 同一个会话同时只补一次标题（前端每会话也只会触发一次，这里再兜一层：
/// 多窗口/网页端同时结算同一会话时不该付两份模型调用）。
static IN_FLIGHT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

struct InFlight(String);

impl InFlight {
    fn begin(key: &str) -> Option<Self> {
        let mut guard = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        let set = guard.get_or_insert_with(HashSet::new);
        if set.contains(key) {
            return None;
        }
        set.insert(key.to_string());
        Some(Self(key.to_string()))
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        // 中毒也要清（into_inner）：不然一次 panic 会让这个会话永远 busy。
        let mut guard = IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(set) = guard.as_mut() {
            set.remove(&self.0);
        }
    }
}

/// 跑一次标题补全。`engine`/`provider_id` 决定用哪个渠道，`model` 是当前
/// 会话的模型（None 时用渠道默认），`seed` 是前端给的会话开头文本。所有
/// 「不该跑/跑不了」都收在 `AutoTitleOutcome` 里返回，Err 只留给系统级错误。
pub(crate) async fn complete(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
    provider_id: Option<&str>,
    model: Option<&str>,
    seed: &str,
) -> AutoTitleOutcome {
    if own_naming(engine) {
        return AutoTitleOutcome::skipped("own_naming");
    }
    let seed = seed.trim();
    if seed.is_empty() {
        return AutoTitleOutcome::skipped("empty_seed");
    }
    match title_state(db, engine, session_id) {
        TitleState::Gone => return AutoTitleOutcome::skipped("missing"),
        TitleState::HasAuto => return AutoTitleOutcome::skipped("exists"),
        TitleState::Renamed => return AutoTitleOutcome::skipped("renamed"),
        TitleState::Open => {}
    }
    let Some(_guard) = InFlight::begin(&format!("{engine}/{session_id}")) else {
        return AutoTitleOutcome::skipped("busy");
    };
    let provider = match crate::config::resolve_provider(engine, provider_id) {
        Ok(Some(provider)) => provider,
        Ok(None) => return AutoTitleOutcome::skipped("no_channel"),
        Err(error) => return AutoTitleOutcome::failed(error),
    };
    let wire = match crate::channel::resolve_wire(engine, &provider, model) {
        Ok(wire) => wire,
        Err(error) => return AutoTitleOutcome::skipped(&format!("channel_incomplete: {error}")),
    };
    let prompt = title_prompt(&super::truncate_chars(seed, MAX_SEED_CHARS));
    let reply = match crate::channel::call_channel(&wire, &prompt, MAX_TITLE_TOKENS).await {
        Ok(reply) => reply,
        Err(error) => return AutoTitleOutcome::failed(error),
    };
    let Some(title) = clean_title(&reply) else {
        return AutoTitleOutcome::failed("reply carried no usable title");
    };
    // 模型调用期间用户可能重命名或删除了会话：写回之前复查一遍。
    match title_state(db, engine, session_id) {
        TitleState::Open => {}
        TitleState::HasAuto => return AutoTitleOutcome::skipped("exists"),
        TitleState::Renamed => return AutoTitleOutcome::skipped("renamed"),
        TitleState::Gone => return AutoTitleOutcome::skipped("missing"),
    }
    if let Err(error) = db.remember_session_auto_title(engine, session_id, &title, now_ms()) {
        return AutoTitleOutcome::failed(error);
    }
    AutoTitleOutcome::applied(title)
}

/// 跑一次补全，有变化就发 `sessions://changed`（列表监听它重读）。
pub(crate) async fn run(
    state: &crate::AppState,
    engine: &str,
    session_id: &str,
    provider_id: Option<&str>,
    model: Option<&str>,
    seed: &str,
) -> AutoTitleOutcome {
    let outcome = complete(&state.db, engine, session_id, provider_id, model, seed).await;
    if outcome.status == "applied" {
        state.sink.emit_sessions_changed();
    }
    outcome
}

/// 首轮结束后补全标题。补不了的细节都收在 `AutoTitleOutcome` 里返回
/// （界面据此说明原因），Err 只留给真正的系统级错误。
#[tauri::command]
pub async fn auto_title_session(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    provider_id: Option<String>,
    model: Option<String>,
    seed: String,
) -> Result<AutoTitleOutcome, String> {
    Ok(run(
        &state,
        &engine,
        &session_id,
        provider_id.as_deref(),
        model.as_deref(),
        &seed,
    )
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "ccgui-auto-title-test-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scratch_db() -> (Scratch, Db) {
        let scratch = Scratch::new();
        let db = Db::open_at(&scratch.0.join("app.db")).unwrap();
        (scratch, db)
    }

    fn insert_session(db: &Db, engine: &str, session_id: &str, custom_title: Option<&str>) {
        db.0.lock()
            .execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title, custom_title)
                 VALUES(?1, ?2, '/ws', 'f.jsonl', 1, 1, 'first message', ?3)",
                rusqlite::params![engine, session_id, custom_title],
            )
            .unwrap();
    }

    #[test]
    fn clean_title_peels_wrappers_prefixes_and_trailing_punctuation() {
        assert_eq!(clean_title("\"修复登录问题\"").as_deref(), Some("修复登录问题"));
        assert_eq!(clean_title("「修复登录」").as_deref(), Some("修复登录"));
        assert_eq!(clean_title("# 修复登录").as_deref(), Some("修复登录"));
        assert_eq!(clean_title("标题：修复登录。").as_deref(), Some("修复登录"));
        assert_eq!(clean_title("Title: fix login").as_deref(), Some("fix login"));
        // 标签独占一行时取下一行；围栏行不算内容。
        assert_eq!(clean_title("标题：\n修复登录").as_deref(), Some("修复登录"));
        assert_eq!(
            clean_title("```\n修复登录\n```").as_deref(),
            Some("修复登录")
        );
        assert_eq!(clean_title("  \n\n "), None, "空白回复没有标题");
    }

    #[test]
    fn clean_title_caps_at_the_scanner_width() {
        let long = "a".repeat(120);
        let title = clean_title(&long).unwrap();
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
    }

    #[tokio::test]
    async fn complete_leaves_engines_that_name_their_own_sessions() {
        let (_scratch, db) = scratch_db();
        for engine in ["codex", "mireai", "minimax"] {
            let outcome = complete(&db, engine, "s1", None, None, "帮我看看这个报错").await;
            assert_eq!(outcome.status, "skipped");
            assert_eq!(outcome.message.as_deref(), Some("own_naming"));
        }
    }

    #[tokio::test]
    async fn complete_reports_the_session_state_instead_of_running() {
        let (_scratch, db) = scratch_db();
        // 还没建行的会话。
        let outcome = complete(&db, "claude", "s1", None, None, "开场消息").await;
        assert_eq!(outcome.status, "skipped");
        assert_eq!(outcome.message.as_deref(), Some("missing"));

        // 空的开场消息不值得跑。
        insert_session(&db, "claude", "s1", None);
        let outcome = complete(&db, "claude", "s1", None, None, "  ").await;
        assert_eq!(outcome.message.as_deref(), Some("empty_seed"));

        // 已有生成标题：一次性，不再跑。
        db.remember_session_auto_title("claude", "s1", "生成的标题", 1)
            .unwrap();
        let outcome = complete(&db, "claude", "s1", None, None, "开场消息").await;
        assert_eq!(outcome.message.as_deref(), Some("exists"));

        // 用户重命名优先于生成，不跑。
        insert_session(&db, "claude", "s2", Some("我的名字"));
        let outcome = complete(&db, "claude", "s2", None, None, "开场消息").await;
        assert_eq!(outcome.message.as_deref(), Some("renamed"));
    }

    #[test]
    fn in_flight_admits_one_runner_per_session() {
        let first = InFlight::begin("claude/s1").expect("first runner enters");
        assert!(InFlight::begin("claude/s1").is_none(), "second is turned away");
        assert!(InFlight::begin("claude/s2").is_some(), "other sessions unaffected");
        drop(first);
        assert!(InFlight::begin("claude/s1").is_some(), "key released on drop");
    }
}
