//! A CLI shipped inside the app bundle, found before anything on `PATH`.
//!
//! The bundled copy must win: the ACP adapters encode conventions that only
//! hold for one runtime release, so pinning the version is what makes those
//! assumptions verifiable. A user-installed CLI of a different version would
//! silently break them, which is why `PATH` is only consulted as a fallback
//! and an explicit Settings override still outranks everything.
//!
//! Staging layout (produced by `scripts/stage-runtime.mjs`):
//! `<resources>/runtime/bin/<name>` next to the runtime payload it launches.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Directory name under the app resources that holds the staged runtime.
const RUNTIME_DIR: &str = "runtime";
/// Subdirectory of the staged runtime holding launchable executables.
const BIN_DIR: &str = "bin";

#[cfg(windows)]
const EXECUTABLE_VARIANTS: &[&str] = &["cmd", "exe", "bat", "ps1", ""];
#[cfg(not(windows))]
const EXECUTABLE_VARIANTS: &[&str] = &[""];

/// Recorded once at startup from the app handle, which is the only place that
/// knows the platform-correct resource directory for every bundle format.
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn init(resource_dir: &Path) {
    let _ = RESOURCE_DIR.set(resource_dir.to_path_buf());
}

/// Directories that could hold the staged runtime, most authoritative first:
/// the packaged resource dir, the layout a `.app` gives the executable, then
/// the in-tree location used by a source checkout (`cargo run` / tests).
fn root_candidates(resource_dir: Option<&Path>, executable: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = resource_dir {
        roots.push(dir.join(RUNTIME_DIR));
        // `tauri.conf.json` maps the source folder verbatim, so a dev build
        // that copies resources can end up one level deeper.
        roots.push(dir.join("resources").join(RUNTIME_DIR));
    }
    if let Some(exe_dir) = executable.and_then(|path| path.parent()) {
        if cfg!(target_os = "macos") {
            if let Some(contents_dir) = exe_dir.parent() {
                roots.push(contents_dir.join("Resources").join(RUNTIME_DIR));
            }
        }
        roots.push(exe_dir.join(RUNTIME_DIR));
    }
    roots.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RUNTIME_DIR),
    );
    roots
}

/// `candidate` is launchable only if it exists and, on unix, actually carries
/// an exec bit — a staged-but-not-chmod'd file would otherwise fail at spawn
/// with an os error that hides the real cause.
fn launchable(candidate: &Path) -> bool {
    if !candidate.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return candidate
            .metadata()
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }
    #[cfg(not(unix))]
    true
}

fn executable_in(root: &Path, name: &str) -> Option<PathBuf> {
    let bin_dir = root.join(BIN_DIR);
    EXECUTABLE_VARIANTS
        .iter()
        .map(|suffix| {
            if suffix.is_empty() {
                bin_dir.join(name)
            } else {
                bin_dir.join(format!("{name}.{suffix}"))
            }
        })
        .find(|candidate| launchable(candidate))
}

pub(crate) fn bundled_cli(name: &str) -> Option<PathBuf> {
    if name.trim().is_empty() {
        return None;
    }
    // Never treat a qualified name as a bundled lookup — callers pass either a
    // bare command name or a path, and a path already exists on its own.
    if name.contains('/') || name.contains('\\') {
        return None;
    }
    let resource_dir = RESOURCE_DIR.get().map(|dir| dir.as_path());
    let executable = std::env::current_exe().ok();
    root_candidates(resource_dir, executable.as_deref())
        .into_iter()
        .find_map(|root| executable_in(&root, name))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(path, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[cfg(not(unix))]
    fn make_executable(path: &Path) {
        std::fs::write(path, "").unwrap();
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-bundled-cli-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_a_staged_launcher_under_the_resource_dir() {
        let root = scratch("found");
        let bin_dir = root.join(RUNTIME_DIR).join(BIN_DIR);
        std::fs::create_dir_all(&bin_dir).unwrap();
        make_executable(&bin_dir.join("mcode"));

        let found = root_candidates(Some(&root), None)
            .into_iter()
            .find_map(|candidate| executable_in(&candidate, "mcode"));
        assert_eq!(found, Some(bin_dir.join("mcode")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_missing_exec_bit_is_not_a_hit() {
        // Staging that forgets chmod would otherwise surface as a spawn error
        // several layers away from the cause.
        let root = scratch("no-exec-bit");
        let bin_dir = root.join(RUNTIME_DIR).join(BIN_DIR);
        std::fs::create_dir_all(&bin_dir).unwrap();
        std::fs::write(bin_dir.join("mcode"), "not executable").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(
            bin_dir.join("mcode"),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();

        let hit = root_candidates(Some(&root), None)
            .into_iter()
            .any(|candidate| executable_in(&candidate, "mcode").is_some());
        // On unix the mode guard must reject it; on windows existence is the
        // only signal available.
        if cfg!(unix) {
            assert!(!hit, "a non-executable file must not count as a bundled CLI");
        }
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn no_staged_runtime_yields_no_bundled_cli() {
        let root = scratch("absent");
        assert!(root_candidates(Some(&root), None)
            .into_iter()
            .filter(|candidate| candidate.starts_with(&root))
            .all(|candidate| executable_in(&candidate, "mcode").is_none()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn qualified_names_are_left_to_the_caller() {
        assert!(bundled_cli("").is_none());
        assert!(bundled_cli("   ").is_none());
        assert!(bundled_cli("/usr/local/bin/mcode").is_none());
        assert!(bundled_cli(r"C:\tools\mcode.cmd").is_none());
    }
}
