//! mcode 系（内置运行时 / MiniMax Code）的会话标题同步。
//!
//! GUI 行的 `sessions.title` 由扫描器从转录首条用户消息截出来，而 mcode
//! 运行时会在首轮消息被接受后自己生成一个更贴题的标题，存在它的
//! `local_runtime_sessions.title` 里。这里把那份标题读回来覆盖 GUI 行：
//! - 只写 `title`，不碰 `custom_title`（用户重命名优先，同 codex_titles）；
//! - CLI 生成标题不改转录，所以扫描的快路径（stat 未变）也要跑；
//! - 扫描器每次重解析都会把 title 重算回首条消息，所以同步必须跑在
//!   upsert 之后。
//!
//! 只挑非空标题、只更新确实变了的行；CLI 侧的表来自另一个进程，字段缺失
//! 或库在写入中都不算错误，读不到就当没有标题可同步。

use std::collections::HashMap;
use std::path::Path;

use super::discovery::mcode_data_dir;

/// 两个 mcode 引擎：内置运行时（`mireai`）与官方 MiniMax Code
/// （`minimax`，见 discovery 的引擎路由）。各自读自己数据目录下的库，
/// 一份标题永远不会串到另一个引擎的行上。
const ENGINES: [&str; 2] = [crate::engine::mr_providers::MIREAI_ENGINE_ID, "minimax"];

pub(super) fn sync(db: &crate::db::Db) -> Result<bool, String> {
    let mut changed = false;
    for engine in ENGINES {
        let path = mcode_data_dir(engine)
            .join("v2")
            .join("sqlite")
            .join("runtime-state.sqlite");
        changed |= sync_from(db, engine, &path)?;
    }
    Ok(changed)
}

/// ACP 会话中途来了一条标题更新（`session_info_update`）：立刻同步，不等
/// 扫描。CLI 在标题提交之后才发这条通知，所以读到的就是刚生成的标题；
/// 有变化才发 `sessions://changed`，会话列表监听它重读。
pub(crate) fn sync_now(db: &crate::db::Db, sink: &crate::event_sink::EventSink) {
    match sync(db) {
        Ok(true) => sink.emit_sessions_changed(),
        Ok(false) => {}
        Err(error) => eprintln!("[mcode_titles] sync failed: {error}"),
    }
}

/// session_id → 已生成的非空标题。库或表不存在（该引擎没跑过）时为空。
fn read_titles(path: &Path) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return titles;
    };
    let Ok(mut stmt) = conn.prepare("SELECT session_id, title FROM local_runtime_sessions") else {
        return titles;
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
        ))
    }) else {
        return titles;
    };
    for (id, title) in rows.flatten() {
        let id = id.trim().to_owned();
        let title = title.unwrap_or_default();
        let title = title.trim();
        if !id.is_empty() && !title.is_empty() {
            titles.insert(id, title.to_owned());
        }
    }
    titles
}

fn sync_from(db: &crate::db::Db, engine: &str, path: &Path) -> Result<bool, String> {
    let titles = read_titles(path);
    if titles.is_empty() {
        return Ok(false);
    }
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let updates: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT session_id, title FROM sessions WHERE engine=?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([engine], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut updates = Vec::new();
        for row in rows {
            let (id, title) = row.map_err(|e| e.to_string())?;
            if let Some(name) = titles.get(&id).filter(|name| **name != title) {
                updates.push((id, name.clone()));
            }
        }
        updates
    };
    for (id, name) in &updates {
        tx.execute(
            "UPDATE sessions SET title=?1 WHERE engine=?2 AND session_id=?3",
            rusqlite::params![name, engine, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(!updates.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cli_db(path: &Path, rows: &[(&str, Option<&str>)]) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE local_runtime_sessions (session_id TEXT PRIMARY KEY, title TEXT)",
        )
        .unwrap();
        for (id, title) in rows {
            conn.execute(
                "INSERT INTO local_runtime_sessions(session_id, title) VALUES(?1, ?2)",
                rusqlite::params![id, title],
            )
            .unwrap();
        }
    }

    #[test]
    fn sync_takes_cli_titles_per_engine_preserving_custom_titles() -> Result<(), String> {
        let dir = std::env::temp_dir().join(format!("ccgui-mcode-titles-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Db::open_at(&dir.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            for (engine, id) in [
                ("mireai", "a"),
                ("mireai", "b"),
                ("mireai", "d"),
                ("minimax", "c"),
                ("codex", "a"),
            ] {
                conn.execute(
                    "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title, custom_title, updated_at) VALUES(?1, ?2, '/ws', ?3, 10, 20, 'first message', 'local name', 30)",
                    rusqlite::params![engine, id, format!("{engine}-{id}")],
                ).map_err(|e| e.to_string())?;
            }
        }
        let cli = dir.join("runtime-state.sqlite");
        // 库还不存在（该引擎没跑过）：什么都不动。
        assert!(!sync_from(&db, "mireai", &cli)?);
        make_cli_db(
            &cli,
            &[
                ("a", Some("统计 src 下 .ts 文件数量")),
                ("b", None),
                ("d", Some("   ")),
                ("zz", Some("GUI 里没有这行")),
            ],
        );
        assert!(sync_from(&db, "mireai", &cli)?);
        // 第二次没有变化：同步是幂等的，不白刷 on_changed。
        assert!(!sync_from(&db, "mireai", &cli)?);
        {
            let conn = db.0.lock();
            let (title, custom, updated): (String, String, i64) = conn
                .query_row(
                    "SELECT title, custom_title, updated_at FROM sessions WHERE engine='mireai' AND session_id='a'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(title, "统计 src 下 .ts 文件数量");
            // 用户重命名与时间戳都不受影响。
            assert_eq!((custom.as_str(), updated), ("local name", 30));
            let fallback: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE title='first message'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            // b（NULL 标题）、d（空白标题）保持 GUI 推导值；codex 同名行不动；
            // minimax 行此刻还没同步。
            assert_eq!(fallback, 4);
        }
        // 另一个引擎读自己的库，不串行。
        let cli_minimax = dir.join("runtime-state-minimax.sqlite");
        make_cli_db(&cli_minimax, &[("c", Some("查一下这个报错"))]);
        assert!(sync_from(&db, "minimax", &cli_minimax)?);
        let title: String = db
            .0
            .lock()
            .query_row(
                "SELECT title FROM sessions WHERE engine='minimax' AND session_id='c'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "查一下这个报错");
        std::fs::remove_file(&cli_minimax).unwrap();
        // CLI 侧重新生成标题（不改转录）：下一次扫描照样接住。
        make_cli_db(&dir.join("rewrite.sqlite"), &[("a", Some("统计 TS 文件数量"))]);
        assert!(sync_from(&db, "mireai", &dir.join("rewrite.sqlite"))?);
        let title: String = db
            .0
            .lock()
            .query_row(
                "SELECT title FROM sessions WHERE engine='mireai' AND session_id='a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(title, "统计 TS 文件数量");
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
        Ok(())
    }
}
