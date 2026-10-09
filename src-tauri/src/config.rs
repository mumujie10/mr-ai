use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

pub const LOCAL_PROVIDER_ID: &str = "__local_settings_json__";
/// Legacy kimi marker from the imported v1 config: same "use the CLI's own
/// config" semantics, different spelling.
pub(crate) const LEGACY_LOCAL_CONFIG_TOML_ID: &str = "__local_config_toml__";
pub const DISABLED_PROVIDER_ID: &str = "__disabled__";
pub const ENGINES: [&str; 13] = [
    "claude", "kimi", "grok", "codex", "pi", "omp", "dsh", "agy", "opencode", "qoder", "qoder-cn",
    // This app's own agent runtime, bundled under `cli/` and staged as `mr`.
    "mireai",
    // The official MiniMax Code CLI, installed by the user himself.
    "minimax",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderSection {
    #[serde(default)]
    pub providers: serde_json::Map<String, Value>,
    #[serde(default)]
    pub current: Option<String>,
    /// Provider that was current when the engine was disabled via the
    /// enable switch, restored on re-enable. Absent while enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_from: Option<String>,
}

/// Per-engine config sections: the engine id doubles as the serialized key,
/// so the shape stays flat (`{"claude": …, "qoder-cn": …}`) while
/// section()/section_mut() dispatch is generated, not hand-written. The
/// field name is separate from the id because ids may contain '-'.
macro_rules! engine_sections {
    ($(($field:ident, $id:literal)),* $(,)?) => {
        #[derive(Debug, Clone, Serialize, Deserialize, Default)]
        pub struct CliConfig {
            $(#[serde(default, rename = $id)] pub $field: ProviderSection,)*
            /// Preserve unknown top-level fields from legacy config on import.
            #[serde(flatten)]
            pub extra: HashMap<String, Value>,
        }

        impl CliConfig {
            pub fn section(&self, engine: &str) -> Option<&ProviderSection> {
                match engine {
                    $($id => Some(&self.$field),)*
                    _ => None,
                }
            }

            pub fn section_mut(&mut self, engine: &str) -> Option<&mut ProviderSection> {
                match engine {
                    $($id => Some(&mut self.$field),)*
                    _ => None,
                }
            }
        }
    };
}

engine_sections!(
    (claude, "claude"),
    (kimi, "kimi"),
    (grok, "grok"),
    (codex, "codex"),
    (pi, "pi"),
    (omp, "omp"),
    (dsh, "dsh"),
    (agy, "agy"),
    (opencode, "opencode"),
    (qoder, "qoder"),
    (qoder_cn, "qoder-cn"),
    (mireai, "mireai"),
    (minimax, "minimax"),
);

#[derive(Default)]
pub struct ConfigStore(pub Mutex<()>);

pub fn read_config() -> Result<CliConfig, String> {
    let path = crate::paths::config_path();
    if !path.exists() {
        return Ok(CliConfig::default());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(CliConfig::default());
    }
    let raw: Value =
        serde_json::from_str(&content).map_err(|e| format!("parse {}: {e}", path.display()))?;
    let mut config: CliConfig = serde_json::from_value(raw.clone())
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    migrate_bundled_section(&mut config, &raw);
    Ok(config)
}

/// One-time mapping of the pre-split `minimax` channel section onto `mireai`.
///
/// Channels entered in this app always drove the bundled runtime, which used to
/// be engine `minimax`; after the split that id means the official MiniMax Code
/// CLI, and its channels must not be presented as ours. The file says which
/// build wrote it: every section is serialized, so a pre-split config is exactly
/// one with no `mireai` key. Applied on read and persisted by the next write, so
/// it runs once and never rewrites a section the user filled in for MiniMax
/// Code afterwards.
fn migrate_bundled_section(config: &mut CliConfig, raw: &Value) {
    if raw.get("mireai").is_some() {
        return;
    }
    let Some(legacy) = raw.get("minimax") else {
        return;
    };
    let Ok(section) = serde_json::from_value::<ProviderSection>(legacy.clone()) else {
        return;
    };
    if config.mireai.providers.is_empty() && config.mireai.current.is_none() {
        config.mireai = section;
    }
    config.minimax = ProviderSection::default();
}

fn write_config(config: &CliConfig) -> Result<(), String> {
    let path = crate::paths::config_path();
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    crate::settings::atomic_write(&path, &content)
}

/// One-time import of the legacy ~/.ccgui/config.json claude/kimi/grok
/// sections. Runs only when the new config does not exist yet.
pub fn import_legacy_config_once() {
    let new_path = crate::paths::config_path();
    if new_path.exists() {
        return;
    }
    let legacy_path = crate::paths::legacy_home().join("config.json");
    if !legacy_path.exists() {
        return;
    }
    let Ok(content) = std::fs::read_to_string(&legacy_path) else {
        return;
    };
    let Ok(legacy) = serde_json::from_str::<Value>(&content) else {
        return;
    };
    let mut config = CliConfig::default();
    for engine in ENGINES {
        // Legacy codex providers carry configToml/authJson materialization
        // state from the pre-channel config model; skipped on import.
        if engine == "codex" {
            continue;
        }
        let Some(section) = legacy.get(engine) else {
            continue;
        };
        let providers = section
            .get("providers")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let current = section
            .get("current")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(target) = config.section_mut(engine) {
            target.providers = providers;
            target.current = current;
        }
    }
    let _ = write_config(&config);
}

/// Launch gate: the 停用 pseudo-provider refuses sends. Channel env is
/// resolved at spawn (`resolve_provider_env`) and injected onto the child.
pub fn ensure_engine_enabled(engine: &str) -> Result<(), String> {
    let config = read_config()?;
    let section = config
        .section(engine)
        .ok_or_else(|| format!("unknown engine: {engine}"))?;
    if section.current.as_deref() == Some(DISABLED_PROVIDER_ID) {
        return Err(format!("engine {engine} is disabled"));
    }
    Ok(())
}

fn is_official_provider(id: &str) -> bool {
    id.is_empty() || id == LOCAL_PROVIDER_ID || id == LEGACY_LOCAL_CONFIG_TOML_ID
}

/// Helper to find a provider in a section by exact id or by plugin prefix/suffix match.
/// For example, "custom_123" matches "plugin_model-switcher_custom_123",
/// and "plugin_model-switcher_custom_123" matches "custom_123".
/// More than one fuzzy candidate is an error: picking by insertion order
/// could silently send the conversation to the wrong endpoint.
pub(crate) fn find_provider<'a>(
    section: &'a ProviderSection,
    id: &str,
) -> Result<Option<(&'a str, &'a Value)>, String> {
    if let Some((k, v)) = section.providers.get_key_value(id) {
        return Ok(Some((k.as_str(), v)));
    }
    // Fuzzy both ways: a key ending with "_<id>" (caller passed the id
    // without its plugin prefix), or the id ending with "_<key>" (caller
    // passed it with an extra prefix).
    let mut matches = section
        .providers
        .iter()
        .filter(|(k, _)| k.ends_with(&format!("_{id}")) || id.ends_with(&format!("_{k}")));
    let first = matches.next();
    if let Some((second, _)) = matches.next() {
        let first_key = first.map(|(k, _)| k.as_str()).unwrap_or("");
        return Err(format!(
            "provider id {id} is ambiguous: matches {first_key} and {second}"
        ));
    }
    Ok(first.map(|(k, v)| (k.as_str(), v)))
}

/// Env a spawn should inject for `provider_id` on `engine`. Official / empty
/// / unknown-but-pseudo ids yield an empty map (the CLI's own files apply).
/// `__disabled__` is a launch error. Claude is injected the same way as the
/// other engines — unlike the old spawn path which skipped it.
pub fn resolve_provider_env(
    engine: &str,
    provider_id: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    resolve_provider(engine, provider_id)?
        .map(|provider| crate::provider_files::channel_env(engine, &provider))
        .unwrap_or_else(|| Ok(HashMap::new()))
}

/// Read one channel snapshot for the whole launch (env and native overrides).
pub(crate) fn resolve_provider(
    engine: &str,
    provider_id: Option<&str>,
) -> Result<Option<Value>, String> {
    let config = read_config()?;
    let section = config
        .section(engine)
        .ok_or_else(|| format!("unknown engine: {engine}"))?;
    crate::provider_files::migrate_legacy(engine, section)?;
    let explicit = provider_id.map(str::trim).filter(|s| !s.is_empty());
    let id = explicit.unwrap_or_else(|| section.current.as_deref().unwrap_or("").trim());
    if id == DISABLED_PROVIDER_ID {
        return Err(format!("engine {engine} is disabled"));
    }
    if is_official_provider(id) {
        return Ok(None);
    }

    if let Some((_matched_key, provider)) = find_provider(section, id)? {
        return Ok(Some(provider.clone()));
    }

    if explicit.is_some() {
        // An explicitly chosen channel that no longer resolves must not
        // silently reroute the conversation to whatever channel is current:
        // the user picked an endpoint. Fail the send so they can re-pick.
        return Err(format!("provider {id} not found for engine {engine}"));
    }

    // Only the stored current id may be stale (the channel was deleted out
    // from under the config): fall back to the official config rather than
    // fail every send.
    eprintln!(
        "[config] current provider {id} not found for {engine}, falling back to official config"
    );
    Ok(None)
}

// ==================== Commands ====================

#[tauri::command]
pub fn get_cli_config() -> Result<CliConfig, String> {
    read_config()
}

/// Lock-free core of mutate_section: callers that already hold the
/// ConfigStore lock (cc_switch's multi-engine import) use this directly.
pub(crate) fn mutate_section_unlocked(
    engine: &str,
    mutate: impl FnOnce(&mut ProviderSection) -> Result<(), String>,
) -> Result<(), String> {
    let mut config = read_config()?;
    let section = config
        .section_mut(engine)
        .ok_or_else(|| format!("unknown engine: {engine}"))?;
    let previous = section.clone();
    mutate(section)?;
    crate::provider_files::migrate_legacy(engine, &previous)?;
    write_config(&config)
}

/// Lock the store, apply `mutate` to one engine's section, persist. A
/// `mutate` error aborts before the write, leaving the config untouched.
fn mutate_section(
    store: &ConfigStore,
    engine: &str,
    mutate: impl FnOnce(&mut ProviderSection) -> Result<(), String>,
) -> Result<(), String> {
    let _guard = store.0.lock().map_err(|e| e.to_string())?;
    mutate_section_unlocked(engine, mutate)
}

#[tauri::command]
pub fn upsert_provider(
    store: tauri::State<'_, ConfigStore>,
    engine: String,
    id: String,
    json: Value,
) -> Result<(), String> {
    upsert_provider_inner(&store, engine, id, json)
}

/// Verify a draft channel without saving it anywhere: the bundled CLI adds it
/// into a scratch profile, runs its own connection test there, and the profile
/// is deleted again. A wrong key or an unreachable relay is therefore visible
/// before the user commits the channel, and neither provider store is touched.
#[tauri::command]
pub fn test_provider_draft(engine: String, json: Value) -> Result<Value, String> {
    if engine != crate::engine::mr_providers::MIREAI_ENGINE_ID {
        return Err(format!("引擎 {engine} 没有内置的渠道测试运行时"));
    }
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, crate::engine::mr_providers::MIREAI_ENGINE_ID);
    let channel = crate::engine::mr_providers::channel_from_json(&json)?;
    crate::engine::mr_providers::test_draft(&bin, &channel)
}

fn upsert_provider_inner(
    store: &ConfigStore,
    engine: String,
    id: String,
    json: Value,
) -> Result<(), String> {
    mutate_section(&store, &engine, |section| {
        if engine == crate::engine::mr_providers::MIREAI_ENGINE_ID {
            push_channel_to_mr(&json)?;
        }
        section.providers.insert(id.clone(), json);
        Ok(())
    })
}

/// Make the bundled runtime hold every channel the app has stored.
///
/// The dialog's channel list is what the user edited; the runtime keeps its own
/// provider store in `~/.mireai`, and that directory starts empty — on first
/// launch, and again after it moved off the shared `~/.minimax`. Channels the
/// CLI already has are left alone, so the call is safe to repeat and belongs on
/// the startup path rather than in front of the window.
pub fn sync_bundled_channels() -> Result<usize, String> {
    let engine = crate::engine::mr_providers::MIREAI_ENGINE_ID;
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, engine);
    let section = read_config()?.section(engine).cloned().unwrap_or_default();
    let channels = section
        .providers
        .values()
        .filter_map(|json| crate::engine::mr_providers::channel_from_json(json).ok())
        .collect::<Vec<_>>();
    crate::engine::mr_providers::sync_missing_channels(&bin, &channels)
}

/// The bundled `mr` CLI owns its provider store in `~/.mireai/config.yaml`, so
/// a channel entered here has to go through the CLI's own commands; storing it
/// only in our config would leave the runtime unable to answer. Doing it inside
/// the mutation means a CLI failure aborts our write as well, so the two stores
/// cannot drift apart.
fn push_channel_to_mr(json: &Value) -> Result<(), String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, crate::engine::mr_providers::MIREAI_ENGINE_ID);
    let channel = crate::engine::mr_providers::channel_from_json(json)?;
    crate::engine::mr_providers::upsert_and_select(&bin, &channel)
}

fn mr_channel_name(json: &Value) -> Option<&str> {
    json.get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
}

fn remove_channel_from_mr(name: &str) -> Result<(), String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, crate::engine::mr_providers::MIREAI_ENGINE_ID);
    crate::engine::mr_providers::remove(&bin, name)
}

fn select_channel_in_mr(json: &Value) -> Result<(), String> {
    let settings = crate::settings::read_settings().unwrap_or_default();
    let bin = crate::engine::engine_bin(&settings, crate::engine::mr_providers::MIREAI_ENGINE_ID);
    let channel = crate::engine::mr_providers::channel_from_json(json)?;
    crate::engine::mr_providers::select_current(&bin, &channel)
}

#[tauri::command]
pub fn delete_provider(
    store: tauri::State<'_, ConfigStore>,
    engine: String,
    id: String,
) -> Result<(), String> {
    delete_provider_inner(&store, engine, id)
}

fn delete_provider_inner(store: &ConfigStore, engine: String, id: String) -> Result<(), String> {
    mutate_section(&store, &engine, |section| {
        if engine == crate::engine::mr_providers::MIREAI_ENGINE_ID {
            if let Some(name) = section
                .providers
                .get(&id)
                .and_then(mr_channel_name)
                .map(str::to_string)
            {
                remove_channel_from_mr(&name)?;
            }
        }
        section.providers.remove(&id);
        if section.current.as_deref() == Some(id.as_str()) {
            // Fall back to 官方配置: spawn injects nothing for official.
            section.current = None;
        }
        Ok(())
    })
}

/// Enable-switch semantics: disabling remembers the current provider in
/// `disabled_from` and parks `current` on `__disabled__`; enabling restores
/// it (falling back to 官方配置 when nothing was remembered or the remembered
/// provider was deleted in between).
#[tauri::command]
pub fn set_engine_enabled(
    store: tauri::State<'_, ConfigStore>,
    engine: String,
    enabled: bool,
) -> Result<(), String> {
    set_engine_enabled_inner(&store, engine, enabled)
}

fn set_engine_enabled_inner(
    store: &ConfigStore,
    engine: String,
    enabled: bool,
) -> Result<(), String> {
    mutate_section(&store, &engine, |section| {
        if enabled {
            if section.current.as_deref() == Some(DISABLED_PROVIDER_ID) {
                let restore = section
                    .disabled_from
                    .take()
                    .filter(|id| id != DISABLED_PROVIDER_ID && section.providers.contains_key(id));
                let id = restore.unwrap_or_else(|| LOCAL_PROVIDER_ID.to_string());
                section.current = Some(id);
            }
        } else if section.current.as_deref() != Some(DISABLED_PROVIDER_ID) {
            section.disabled_from = section.current.clone();
            section.current = Some(DISABLED_PROVIDER_ID.to_string());
        }
        Ok(())
    })
}

#[tauri::command]
pub fn set_current_provider(
    store: tauri::State<'_, ConfigStore>,
    engine: String,
    id: String,
) -> Result<(), String> {
    set_current_provider_inner(&store, engine, id)
}

fn set_current_provider_inner(
    store: &ConfigStore,
    engine: String,
    id: String,
) -> Result<(), String> {
    mutate_section(&store, &engine, |section| {
        if id != LOCAL_PROVIDER_ID
            && id != DISABLED_PROVIDER_ID
            && id != LEGACY_LOCAL_CONFIG_TOML_ID
        {
            if let Some((matched_key, _)) = find_provider(section, &id)? {
                if engine == crate::engine::mr_providers::MIREAI_ENGINE_ID {
                    let json = section
                        .providers
                        .get(matched_key)
                        .cloned()
                        .unwrap_or(Value::Null);
                    select_channel_in_mr(&json)?;
                }
                section.current = Some(matched_key.to_string());
                return Ok(());
            }
            return Err(format!("provider {id} not found for {engine}"));
        }
        // Session-scoped: this is the default for new chats. Existing sessions
        // keep the provider they remembered; spawn injects env, never writes
        // the CLI's own config file.
        section.current = Some(id.clone());
        Ok(())
    })
}

#[tauri::command]
pub fn reorder_providers(
    store: tauri::State<'_, ConfigStore>,
    engine: String,
    ids: Vec<String>,
) -> Result<(), String> {
    mutate_section(&store, &engine, |section| {
        // Rebuild map in requested order; keep unknown ids at the end.
        let mut ordered = serde_json::Map::new();
        let mut remaining: Vec<(String, Value)> =
            std::mem::take(&mut section.providers).into_iter().collect();
        for id in &ids {
            if let Some(pos) = remaining.iter().position(|(k, _)| k == id) {
                let (k, v) = remaining.remove(pos);
                ordered.insert(k, v);
            }
        }
        for (k, v) in remaining {
            ordered.insert(k, v);
        }
        section.providers = ordered;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::paths::HOME_ENV_LOCK;

    struct Scratch {
        dir: std::path::PathBuf,
        prev_home: Option<std::ffi::OsString>,
        prev_profile: Option<std::ffi::OsString>,
        engine_homes: Vec<(&'static str, Option<std::ffi::OsString>)>,
        _lock: parking_lot::MutexGuard<'static, ()>,
    }
    impl Scratch {
        fn new() -> Self {
            let lock = HOME_ENV_LOCK.lock();
            let dir = std::env::temp_dir()
                .join(format!("ccgui-next-config-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let prev_home = std::env::var_os("HOME");
            let prev_profile = std::env::var_os("USERPROFILE");
            std::env::set_var("HOME", &dir);
            std::env::set_var("USERPROFILE", &dir);
            let engine_homes = [
                "CLAUDE_CONFIG_DIR",
                "CODEX_HOME",
                "KIMI_CODE_HOME",
                "GROK_HOME",
                "GROK_CONFIG_PATH",
                "GROK_AUTH_PATH",
                "ANTIGRAVITY_HOME",
            ]
            .into_iter()
            .map(|key| {
                let previous = std::env::var_os(key);
                let path = match key {
                    "GROK_CONFIG_PATH" => dir.join("grok-override/config.toml"),
                    "GROK_AUTH_PATH" => dir.join("grok-override/auth.json"),
                    _ => dir.join(key),
                };
                std::env::set_var(key, path);
                (key, previous)
            })
            .collect();
            Self {
                dir,
                prev_home,
                prev_profile,
                engine_homes,
                _lock: lock,
            }
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            for (key, previous) in &self.engine_homes {
                match previous {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
            match &self.prev_home {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
            match &self.prev_profile {
                Some(v) => std::env::set_var("USERPROFILE", v),
                None => std::env::remove_var("USERPROFILE"),
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn seed_channel(engine: &str, id: &str, current: Option<&str>, provider: Value) {
        crate::paths::ensure_dirs().unwrap();
        let mut config = CliConfig::default();
        let section = config.section_mut(engine).unwrap();
        section.providers.insert(id.to_string(), provider);
        section.current = current.map(str::to_string);
        write_config(&config).unwrap();
    }

    /// Channels entered here always drove the bundled runtime, so a config
    /// written before it got its own engine id has to present them under
    /// `mireai`. The `mireai` key is the marker: once it exists (every section
    /// is serialized), a `minimax` section means the official CLI and stays.
    #[test]
    fn pre_split_channels_belong_to_the_bundled_engine() {
        let _scratch = Scratch::new();
        crate::paths::ensure_dirs().unwrap();
        let path = crate::paths::config_path();
        std::fs::write(
            &path,
            serde_json::to_string(&json!({
                "minimax": {
                    "providers": {"chan-1": {"name": "Relay", "baseUrl": "https://r.example/v1"}},
                    "current": "chan-1"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let config = read_config().unwrap();
        assert_eq!(config.mireai.current.as_deref(), Some("chan-1"));
        assert!(config.mireai.providers.contains_key("chan-1"));
        assert!(config.minimax.providers.is_empty());
        // The channel resolves for the engine that actually runs it.
        assert!(resolve_provider("mireai", Some("chan-1")).is_ok());

        std::fs::write(
            &path,
            serde_json::to_string(&json!({
                "mireai": { "providers": {}, "current": null },
                "minimax": {
                    "providers": {"chan-official": {"name": "MiniMax Code"}},
                    "current": "chan-official"
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let config = read_config().unwrap();
        assert_eq!(config.minimax.current.as_deref(), Some("chan-official"));
        assert!(config.mireai.providers.is_empty());
    }

    #[test]
    fn resolve_provider_env_official_is_empty_and_claude_injects() {
        let _scratch = Scratch::new();
        seed_channel(
            "claude",
            "chan-a",
            Some("chan-a"),
            json!({
                "baseUrl": "https://a.example",
                "apiKey": "sk-a",
                "model": "m-a",
            }),
        );
        let env = resolve_provider_env("claude", Some("chan-a")).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://a.example")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-a")
        );
        assert_eq!(env.get("ANTHROPIC_MODEL").map(String::as_str), Some("m-a"));

        let official = resolve_provider_env("claude", Some(LOCAL_PROVIDER_ID)).unwrap();
        assert!(official.is_empty());
        let empty = resolve_provider_env("claude", Some("")).unwrap();
        // Empty id falls back to section.current (chan-a).
        assert_eq!(
            empty.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://a.example")
        );
    }

    #[test]
    fn resolve_provider_env_disabled_errors() {
        let _scratch = Scratch::new();
        seed_channel("kimi", "chan-a", Some(DISABLED_PROVIDER_ID), json!({}));
        assert!(resolve_provider_env("kimi", Some(DISABLED_PROVIDER_ID)).is_err());
    }

    #[test]
    fn resolve_provider_env_matches_plugin_prefix_and_falls_back() {
        let _scratch = Scratch::new();
        seed_channel(
            "claude",
            "plugin_model-switcher_custom_1789366959743",
            Some("plugin_model-switcher_custom_1789366959743"),
            json!({
                "baseUrl": "https://tobapi.example.com",
                "apiKey": "sk-test",
            }),
        );
        // Suffix match: caller passes unprefixed id from plugin
        let env = resolve_provider_env("claude", Some("custom_1789366959743")).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://tobapi.example.com")
        );
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-test")
        );

        // A stale explicit id must fail, not silently reroute the
        // conversation to whatever channel happens to be current.
        let stale = resolve_provider_env("claude", Some("deleted_channel_123"));
        assert!(stale.is_err(), "stale explicit provider id must error");
        assert!(stale.unwrap_err().contains("deleted_channel_123"));
    }

    #[test]
    fn find_provider_fails_on_ambiguous_suffix_match() {
        let _scratch = Scratch::new();
        let mut section = ProviderSection::default();
        section.providers.insert(
            "plugin_a_custom_1".to_string(),
            json!({"baseUrl": "https://a.example"}),
        );
        section.providers.insert(
            "plugin_b_custom_1".to_string(),
            json!({"baseUrl": "https://b.example"}),
        );
        assert!(find_provider(&section, "custom_1").is_err());
        // Exact id still wins over fuzzy candidates.
        section.providers.insert(
            "custom_1".to_string(),
            json!({"baseUrl": "https://exact.example"}),
        );
        let (key, _) = find_provider(&section, "custom_1").unwrap().unwrap();
        assert_eq!(key, "custom_1");
    }

    /// Engines whose channels must never touch the CLI's own files: switching
    /// only re-points our config. The bundled `mr` runtime is the exception —
    /// it has no env channel, so a saved key has to travel through its provider
    /// commands or the runtime cannot answer at all; that path is covered by
    /// `mr_provider_sync_aborts_before_any_secret_or_write` below.
    #[test]
    fn set_current_provider_does_not_write_native_files() {
        let _scratch = Scratch::new();
        let store = ConfigStore::default();
        for engine in ENGINES
            .iter()
            .copied()
            .filter(|engine| *engine != crate::engine::mr_providers::MIREAI_ENGINE_ID)
        {
            seed_channel(
                engine,
                "chan-a",
                None,
                json!({"baseUrl":"https://a.example", "apiKey":"sk-a"}),
            );
            let paths = crate::provider_files::provider_file_paths(engine.into());
            for path in &paths {
                std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
                // Intentionally arbitrary bytes: switching must not parse/reformat
                // an existing native file when there is no legacy migration.
                std::fs::write(path, "# user's own config\n中文 🧪\n").unwrap();
            }
            for id in ["chan-a", LOCAL_PROVIDER_ID, "chan-a"] {
                set_current_provider_inner(&store, engine.into(), id.into()).unwrap();
                assert_eq!(
                    read_config()
                        .unwrap()
                        .section(engine)
                        .unwrap()
                        .current
                        .as_deref(),
                    Some(id)
                );
            }
            assert!(set_current_provider_inner(&store, engine.into(), "missing".into()).is_err());
            upsert_provider_inner(
                &store,
                engine.into(),
                "chan-a".into(),
                json!({"apiKey":"updated"}),
            )
            .unwrap();
            set_engine_enabled_inner(&store, engine.into(), false).unwrap();
            set_engine_enabled_inner(&store, engine.into(), true).unwrap();
            delete_provider_inner(&store, engine.into(), "chan-a".into()).unwrap();
            for path in &paths {
                assert_eq!(
                    std::fs::read_to_string(path).unwrap(),
                    "# user's own config\n中文 🧪\n",
                    "{engine}: {path}"
                );
                std::fs::remove_file(path).unwrap();
            }
            upsert_provider_inner(
                &store,
                engine.into(),
                "chan-a".into(),
                json!({"apiKey":"new"}),
            )
            .unwrap();
            set_current_provider_inner(&store, engine.into(), "chan-a".into()).unwrap();
            for path in paths {
                assert!(!std::path::Path::new(&path).exists());
            }
        }
    }

    /// The bundled runtime has no env channel, so a dialog save has to reach the
    /// CLI. A half-filled channel must fail BEFORE our store changes, instead of
    /// recording a "current" channel the runtime cannot use and then showing it
    /// as if it were configured.
    #[test]
    fn incomplete_mr_channel_is_refused_without_touching_either_store() {
        let _scratch = Scratch::new();
        let store = ConfigStore::default();
        let engine = crate::engine::mr_providers::MIREAI_ENGINE_ID;
        let complete = json!({
            "name": "Relay", "baseUrl": "https://r.example/v1",
            "apiKey": "sk-x", "model": "m1"
        });
        seed_channel(engine, "chan-mr", Some("chan-mr"), complete.clone());
        let error = upsert_provider_inner(
            &store,
            engine.into(),
            "chan-mr".into(),
            json!({ "baseUrl": "https://r.example/v1", "apiKey": "sk-x" }),
        )
        .expect_err("a channel without a name or model cannot be activated");
        assert!(error.contains("name"), "{error}");
        let stored = read_config()
            .unwrap()
            .section(engine)
            .unwrap()
            .providers
            .get("chan-mr")
            .cloned();
        assert_eq!(
            stored,
            Some(complete),
            "the aborted save must not replace the channel"
        );
    }
}
