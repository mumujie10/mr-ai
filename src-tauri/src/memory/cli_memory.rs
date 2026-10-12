//! 设置 → 记忆：内置引擎 (mireai) 长期记忆的目录指引。
//!
//! 与本目录其他文件的 Bot 记忆账本是两回事：这里指路的是 CLI 运行时自己的
//! 长期记忆文件——`<mireai 数据目录>/memory/` 下 `user.md` 是全局记忆，
//! `projects/<slug>/MEMORY.md` 是按项目分组的记忆。读写全部归 CLI，GUI 只
//! 负责把目录托给系统文件管理器展示，不碰文件内容。

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDirs {
    /// 全局记忆文件夹（内含 user.md）。
    pub global_dir: String,
    /// 项目记忆根文件夹，按项目 slug 分组（projects/<slug>/MEMORY.md）。
    pub projects_dir: String,
}

fn memory_dirs_blocking() -> Result<MemoryDirs, String> {
    let base = crate::history::discovery::mcode_data_dir(
        crate::engine::mr_providers::MIREAI_ENGINE_ID,
    )
    .join("memory");
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let projects = base.join("projects");
    std::fs::create_dir_all(&projects).map_err(|e| e.to_string())?;
    Ok(MemoryDirs {
        global_dir: base.to_string_lossy().to_string(),
        projects_dir: projects.to_string_lossy().to_string(),
    })
}

/// 与 prompts_dirs 一致：指引前先保证目录存在，避免 `open -R` 落空。
#[tauri::command]
pub async fn memory_dirs() -> Result<MemoryDirs, String> {
    tauri::async_runtime::spawn_blocking(memory_dirs_blocking)
        .await
        .map_err(|e| e.to_string())?
}
