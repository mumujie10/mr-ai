//! The bundled `mr` CLI keeps its model providers in its own
//! `~/.minimax/config.yaml`; the desktop client is the only place a user can
//! enter a key, so a channel saved here has to reach the CLI or the first
//! message cannot be answered.
//!
//! This module speaks the CLI's own provider commands instead of writing that
//! YAML by hand: the file schema, provider slugs and default-model encoding all
//! stay the CLI's business, and a fork-side format change cannot silently
//! produce a config the CLI misreads.
//!
//! The API key travels ONLY as a child-process environment variable. It is not
//! an argv value (a command line is visible to other processes and lands in
//! crash reports and logs) and it is never included in an error string.

use serde_json::Value;
use std::process::{Command, Stdio};

/// Engine id of the bundled runtime (its binary is `mr`).
pub(crate) const MR_ENGINE_ID: &str = "minimax";

const API_KEY_ENV: &str = "MCODE_PROVIDER_API_KEY";

/// One dialog channel mapped onto what the CLI needs to store it.
pub(crate) struct MrChannel<'a> {
    pub(crate) name: &'a str,
    pub(crate) base_url: &'a str,
    pub(crate) api_key: &'a str,
    pub(crate) model: &'a str,
    /// Wire protocol the CLI must use; its own default is `anthropic-messages`,
    /// so an OpenAI-compatible relay has to say so explicitly.
    pub(crate) api_format: &'a str,
}

/// Reads the flat `baseUrl`/`apiKey`/`model` shape the provider dialog writes.
pub(crate) fn channel_from_json(json: &Value) -> Result<MrChannel<'_>, String> {
    let field = |name: &'static str| {
        json.get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("渠道缺少 {name}"))
    };
    Ok(MrChannel {
        name: field("name")?,
        base_url: field("baseUrl")?,
        api_key: field("apiKey")?,
        model: field("model")?,
        api_format: json
            .get("apiFormat")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("openai-completions"),
    })
}

/// `mr provider add` argv. The key is supplied through the child environment,
/// which is what `--api-key-env` reads.
fn add_args(channel: &MrChannel<'_>) -> Vec<String> {
    vec![
        "provider".into(),
        "add".into(),
        "--name".into(),
        channel.name.to_string(),
        "--base-url".into(),
        channel.base_url.to_string(),
        "--api-format".into(),
        channel.api_format.to_string(),
        "--model".into(),
        channel.model.to_string(),
        "--api-key-env".into(),
        API_KEY_ENV.into(),
    ]
}

fn list_args() -> Vec<String> {
    vec!["provider".into(), "list".into(), "--json".into()]
}

fn select_args(model_key: &str) -> Vec<String> {
    vec!["provider".into(), "select".into(), model_key.to_string()]
}

/// `mr provider test` argv for one saved provider and one of its models. The
/// key comes from the CLI's own stored config, so no env is required here.
fn test_args(provider_id: &str, model: &str) -> Vec<String> {
    vec![
        "provider".into(),
        "test".into(),
        provider_id.to_string(),
        "--model".into(),
        model.to_string(),
        "--json".into(),
    ]
}

fn remove_args(provider_id: &str) -> Vec<String> {
    vec![
        "provider".into(),
        "remove".into(),
        provider_id.to_string(),
        "--yes".into(),
    ]
}

/// Picks the CLI provider id that carries this display name. The slug is the
/// CLI's to mint, so it is read back from `provider list --json` rather than
/// guessed here.
fn provider_id_for_name(list_json: &str, name: &str) -> Option<String> {
    let document: Value = serde_json::from_str(list_json).ok()?;
    document
        .get("providers")?
        .as_array()?
        .iter()
        .find(|provider| provider.get("name").and_then(Value::as_str) == Some(name))
        .and_then(|provider| provider.get("providerId"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

struct Invocation {
    status: i32,
    stdout: String,
    stderr: String,
}

fn invoke(bin: &str, args: &[String], envs: &[(&str, &str)]) -> Result<Invocation, String> {
    let output = Command::new(bin)
        .args(args)
        .envs(envs.iter().map(|(key, value)| (*key, *value)))
        .stdin(Stdio::null())
        // Piped explicitly: the provider id and the default-model result are
        // read from these, so inheriting a terminal would silently lose them.
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 {bin}：{error}"))?
        .wait_with_output();
    let output = output.map_err(|error| format!("调用 {bin} 失败：{error}"))?;
    Ok(Invocation {
        status: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Save the channel, then make it the default model — the CLI's own words for
/// "this is the channel we answer with". Saving deliberately performs no
/// connectivity probe: a save must not fail because a relay is briefly
/// unreachable, and 验证 a draft is what [`test_draft`] is for. A user choosing
/// 当前渠道 is already the explicit act.
pub(crate) fn upsert_and_select(bin: &str, channel: &MrChannel<'_>) -> Result<(), String> {
    let added = invoke(
        bin,
        &add_args(channel),
        &[(API_KEY_ENV, channel.api_key)],
    )?;
    if added.status != 0 {
        return Err(failure("保存渠道", &added));
    }
    let listed = invoke(bin, &list_args(), &[])?;
    if listed.status != 0 {
        return Err(failure("读取渠道", &listed));
    }
    let provider_id = provider_id_for_name(&listed.stdout, channel.name).ok_or_else(|| {
        format!(
            "CLI 没有保存名为 {} 的渠道（读取到：{}）",
            channel.name,
            listed.stdout.trim()
        )
    })?;
    let model_key = format!("{}/{}", provider_id, channel.model);
    let selected = invoke(bin, &select_args(&model_key), &[])?;
    if selected.status != 0 {
        return Err(failure("设为当前模型", &selected));
    }
    Ok(())
}

/// Drop the channel from the CLI too, so a deleted relay cannot stay selected.
pub(crate) fn remove(bin: &str, name: &str) -> Result<(), String> {
    let listed = invoke(bin, &list_args(), &[])?;
    if listed.status != 0 {
        return Err(failure("读取渠道", &listed));
    }
    let Some(provider_id) = provider_id_for_name(&listed.stdout, name) else {
        // Never saved (or already gone): nothing to do.
        return Ok(());
    };
    let removed = invoke(bin, &remove_args(&provider_id), &[])?;
    if removed.status != 0 {
        return Err(failure("删除渠道", &removed));
    }
    Ok(())
}

/// Keep the CLI's default model aligned with the channel the user picked as
/// current, without re-writing its credentials.
pub(crate) fn select_current(bin: &str, channel: &MrChannel<'_>) -> Result<(), String> {
    let listed = invoke(bin, &list_args(), &[])?;
    if listed.status != 0 {
        return Err(failure("读取渠道", &listed));
    }
    let provider_id = provider_id_for_name(&listed.stdout, channel.name)
        .ok_or_else(|| format!("CLI 中没有名为 {} 的渠道", channel.name))?;
    let selected = invoke(
        bin,
        &select_args(&format!("{}/{}", provider_id, channel.model)),
        &[],
    )?;
    if selected.status != 0 {
        return Err(failure("设为当前模型", &selected));
    }
    Ok(())
}

/// A scratch CLI data directory that deletes itself, so testing a draft reaches
/// neither the user's own provider store nor a leftover profile in `/tmp`.
struct TempProfile {
    path: std::path::PathBuf,
}

impl TempProfile {
    fn create() -> Result<Self, String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir()
            .join(format!("mr-provider-test-{}-{nanos}", std::process::id()));
        create_private_dir(&path)?;
        Ok(Self { path })
    }

    fn path_str(&self) -> String {
        self.path.display().to_string()
    }
}

/// Creates the scratch directory owner-only. The CLI writes the channel's key
/// into `<dir>/config.yaml` for the duration of the probe, so the parent must
/// not be listable by any other account even briefly.
fn create_private_dir(path: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|error| format!("无法创建测试用的临时配置目录：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("无法限制临时配置目录权限：{error}"))?;
    }
    Ok(())
}

impl Drop for TempProfile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Test a draft channel the same way a saved one is tested, but inside a scratch
/// profile: add it there, read the provider id the CLI minted, run the CLI's own
/// connection test, and report the parsed verdict. Neither store the user owns
/// is written, and the key travels only as child environment.
pub(crate) fn test_draft(bin: &str, channel: &MrChannel<'_>) -> Result<Value, String> {
    let profile = TempProfile::create()?;
    let data_dir = profile.path_str();
    let envs = [
        (API_KEY_ENV, channel.api_key),
        ("MINIMAX_DATA_DIR", data_dir.as_str()),
        ("MAVIS_DATA_DIR", data_dir.as_str()),
    ];
    let added = invoke(bin, &add_args(channel), &envs)?;
    if added.status != 0 {
        return Err(failure("准备测试渠道", &added));
    }
    let listed = invoke(bin, &list_args(), &envs)?;
    if listed.status != 0 {
        return Err(failure("读取测试渠道", &listed));
    }
    let provider_id = provider_id_for_name(&listed.stdout, channel.name)
        .ok_or_else(|| format!("CLI 没有接受名为 {} 的测试渠道", channel.name))?;
    let tested = invoke(bin, &test_args(&provider_id, channel.model), &envs)?;
    if tested.status != 0 {
        return Err(failure("测试连接", &tested));
    }
    connection_verdict(&tested.stdout)
}

/// `provider test --json` answers `{success, status:{state, lastErrorCode?,
/// lastErrorMessage?}}` and exits 0 even when the probe failed, so the verdict is
/// read from the document rather than the exit code.
fn connection_verdict(stdout: &str) -> Result<Value, String> {
    let document: Value = serde_json::from_str(stdout.trim())
        .map_err(|error| format!("测试输出无法解析：{error}"))?;
    let ok = document
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let status = document.get("status").cloned().unwrap_or(Value::Null);
    let text = |key: &str| {
        status
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let recorded_state = text("state");
    let state = if !recorded_state.is_empty() {
        recorded_state
    } else if ok {
        "available".to_string()
    } else {
        "failed".to_string()
    };
    Ok(serde_json::json!({
        "ok": ok,
        "state": state,
        "errorCode": text("lastErrorCode"),
        "errorMessage": text("lastErrorMessage"),
    }))
}

/// Command failures are surfaced to the dialog. The CLI's own messages are safe
/// to show; the key is only ever in our child env, so it cannot appear here.
fn failure(action: &str, invocation: &Invocation) -> String {
    let detail = invocation.stderr.trim().lines().next().unwrap_or_default();
    let detail = if detail.is_empty() {
        invocation.stdout.trim().lines().next().unwrap_or_default()
    } else {
        detail
    };
    format!(
        "{action} 失败（退出码 {}）：{}",
        invocation.status,
        if detail.is_empty() {
            "CLI 未给出原因"
        } else {
            detail
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_argv_carries_no_secret() {
        let channel = MrChannel {
            name: "My Relay",
            base_url: "https://relay.example/v1",
            api_key: "sk-secret-value",
            model: "gpt-x",
            api_format: "openai-completions",
        };
        let joined = add_args(&channel).join(" ");
        assert!(!joined.contains("sk-secret-value"), "key must never be argv");
        assert!(joined.contains("--api-key-env MCODE_PROVIDER_API_KEY"));
        assert!(joined.contains("--api-format openai-completions"));
    }

    #[test]
    fn json_shape_defaults_to_openai_completions() {
        let json = serde_json::json!({
            "name": "Relay",
            "baseUrl": "https://relay.example/v1",
            "apiKey": "sk-x",
            "model": "m1"
        });
        let channel = channel_from_json(&json).expect("flat channel");
        assert_eq!(channel.api_format, "openai-completions");
        assert_eq!(channel.model, "m1");
    }

    #[test]
    fn json_shape_keeps_an_explicit_protocol_and_rejects_gaps() {
        let json = serde_json::json!({
            "name": "Relay", "baseUrl": "https://a", "apiKey": "k",
            "model": "m", "apiFormat": "anthropic-messages"
        });
        assert_eq!(channel_from_json(&json).unwrap().api_format, "anthropic-messages");
        let missing = serde_json::json!({ "name": "Relay", "baseUrl": "https://a", "model": "m" });
        let error = match channel_from_json(&missing) {
            Ok(_) => panic!("a channel without a key must be rejected"),
            Err(error) => error,
        };
        assert!(error.contains("apiKey"), "{error}");
    }

    #[test]
    fn provider_id_is_read_back_from_the_cli_not_guessed() {
        let document = serde_json::json!({
            "providers": [
                { "providerId": "minimax_oauth", "kind": "minimax-oauth", "name": "MiniMax" },
                { "providerId": "custom_provider:my-relay", "kind": "custom", "name": "My Relay" }
            ]
        });
        assert_eq!(
            provider_id_for_name(&document.to_string(), "My Relay").as_deref(),
            Some("custom_provider:my-relay")
        );
        assert_eq!(provider_id_for_name(&document.to_string(), "Gone"), None);
        assert_eq!(provider_id_for_name("not json", "My Relay"), None);
    }

    #[test]
    fn failure_message_reports_exit_code_without_leaking_the_key() {
        let invocation = Invocation {
            status: 1,
            stdout: String::new(),
            stderr: "Provider connection test failed.".into(),
        };
        let message = failure("保存渠道", &invocation);
        assert!(message.contains("退出码 1"), "{message}");
        assert!(message.contains("connection test"), "{message}");
    }

    /// Runs the real child-process path against a stub binary that records how
    /// it was invoked, so "the key travels only as an environment variable" is
    /// measured rather than asserted from reading the argv builder.
    #[cfg(unix)]
    #[test]
    fn stub_binary_receives_the_key_only_through_its_environment() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("mr-providers-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let log = dir.join("calls.log");
        let log_path = log.display().to_string();
        let stub = dir.join("mr");
        let script = format!(
            r#"#!/bin/sh
printf '%s\n' "ARGV:$*" "ENV:${{MCODE_PROVIDER_API_KEY:-unset}}" >> '{log_path}'
case "$*" in
  *provider*list*)
    printf '%s\n' '{{"providers":[{{"providerId":"custom_provider:my-relay","name":"My Relay"}}]}}' ;;
  *)
    printf '%s\n' 'ok' ;;
esac
exit 0
"#
        );
        std::fs::write(&stub, script).expect("write stub");
        let mut permissions = std::fs::metadata(&stub).expect("metadata").permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&stub, permissions).expect("chmod");
        std::fs::write(&log, "").expect("clear log");

        let channel = MrChannel {
            name: "My Relay",
            base_url: "https://relay.example/v1",
            api_key: "sk-secret-value",
            model: "gpt-x",
            api_format: "openai-completions",
        };
        if let Err(error) = upsert_and_select(stub.to_str().expect("stub path"), &channel) {
            let recorded = std::fs::read_to_string(&log).unwrap_or_default();
            panic!("stub provider flow failed: {error}\nstub saw:\n{recorded}");
        }

        let recorded = std::fs::read_to_string(&log).expect("read log");
        std::fs::remove_dir_all(&dir).ok();

        for line in recorded.lines().filter(|line| line.starts_with("ARGV:")) {
            assert!(
                !line.contains("sk-secret-value"),
                "the key leaked into argv: {line}"
            );
        }
        assert!(
            recorded.contains("ENV:sk-secret-value"),
            "the CLI never received the key via env:\n{recorded}"
        );
        assert!(recorded.contains("--api-key-env MCODE_PROVIDER_API_KEY"));
        assert!(
            recorded.contains("provider select custom_provider:my-relay/gpt-x"),
            "selection never used the id the CLI reported back:\n{recorded}"
        );
    }

    #[test]
    fn test_argv_carries_no_secret() {
        let joined = test_args("custom_provider:my-relay", "gpt-x").join(" ");
        assert!(joined.contains("provider test custom_provider:my-relay"));
        assert!(joined.contains("--model gpt-x"));
        assert!(joined.contains("--json"));
    }

    #[test]
    fn verdict_reads_the_document_not_the_exit_code() {
        let available = connection_verdict(
            r#"{"success":true,"status":{"state":"available","lastTestedAt":1}}"#,
        )
        .expect("available verdict");
        assert_eq!(available["ok"], serde_json::json!(true));
        assert_eq!(available["state"], serde_json::json!("available"));

        let rejected = connection_verdict(
            r#"{"success":false,"status":{"state":"failed","lastErrorCode":"unauthorized","lastErrorMessage":"Authentication failed (HTTP 401)"}}"#,
        )
        .expect("failed verdict");
        assert_eq!(rejected["ok"], serde_json::json!(false));
        assert_eq!(rejected["errorCode"], serde_json::json!("unauthorized"));
        assert_eq!(
            rejected["errorMessage"],
            serde_json::json!("Authentication failed (HTTP 401)")
        );

        // A provider answer the CLI could not classify still has to reach the
        // dialog as a failure instead of an empty success.
        let shapeless = connection_verdict("{}").expect("missing fields still parse");
        assert_eq!(shapeless["ok"], serde_json::json!(false));
        assert!(connection_verdict("not json").is_err());
    }

    /// The draft test must be hermetic: a scratch data directory for every CLI
    /// call, the key only in the child env, and the directory gone afterwards.
    #[cfg(unix)]
    #[test]
    fn draft_test_runs_in_a_scratch_profile_and_cleans_up() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("mr-draft-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let log = dir.join("calls.log");
        let log_path = log.display().to_string();
        let stub = dir.join("mr");
        let script = format!(
            r#"#!/bin/sh
printf '%s\n' "ARGV:$*" "KEY:${{MCODE_PROVIDER_API_KEY:-unset}}" "DIR:${{MINIMAX_DATA_DIR:-unset}}:${{MAVIS_DATA_DIR:-unset}}" >> '{log_path}'
case "$*" in
  *provider*list*)
    printf '%s\n' '{{"providers":[{{"providerId":"custom_provider:my-relay","name":"My Relay"}}]}}' ;;
  *provider*test*)
    printf '%s\n' '{{"success":false,"status":{{"state":"failed","lastErrorCode":"unauthorized","lastErrorMessage":"Authentication failed (HTTP 401)"}}}}' ;;
  *)
    printf '%s\n' 'ok' ;;
esac
exit 0
"#
        );
        std::fs::write(&stub, script).expect("write stub");
        let mut permissions = std::fs::metadata(&stub).expect("metadata").permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&stub, permissions).expect("chmod");
        std::fs::write(&log, "").expect("clear log");

        let channel = MrChannel {
            name: "My Relay",
            base_url: "https://relay.example/v1",
            api_key: "sk-secret-value",
            model: "gpt-x",
            api_format: "openai-completions",
        };
        let verdict = match test_draft(stub.to_str().expect("stub path"), &channel) {
            Ok(verdict) => verdict,
            Err(error) => {
                let recorded = std::fs::read_to_string(&log).unwrap_or_default();
                panic!("draft test failed: {error}\nstub saw:\n{recorded}");
            }
        };

        let recorded = std::fs::read_to_string(&log).expect("read log");
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(verdict["ok"], serde_json::json!(false));
        assert_eq!(verdict["errorCode"], serde_json::json!("unauthorized"));
        assert!(
            !verdict.to_string().contains("sk-secret-value"),
            "the key reached the answer shown in the dialog: {verdict}"
        );

        for line in recorded.lines().filter(|line| line.starts_with("KEY:")) {
            assert_eq!(line, "KEY:sk-secret-value");
        }
        let scratch_dirs: Vec<&str> = recorded
            .lines()
            .filter_map(|line| line.strip_prefix("DIR:"))
            .collect();
        assert_eq!(scratch_dirs.len(), 3, "add, list and test all run in it");
        for both in &scratch_dirs {
            let (minimax, mavis) = both.split_once(':').expect("both vars recorded");
            let name = std::path::Path::new(minimax)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            assert!(name.starts_with("mr-provider-test-"), "{minimax}");
            assert_eq!(minimax, mavis, "the CLI honors either name; send both");
            assert!(
                !std::path::Path::new(minimax).exists(),
                "the scratch profile survived the test: {minimax}"
            );
        }
        for line in recorded.lines().filter(|line| line.starts_with("ARGV:")) {
            assert!(!line.contains("sk-secret-value"), "key in argv: {line}");
        }
        assert!(
            recorded.contains("provider test custom_provider:my-relay --model gpt-x --json"),
            "the CLI's own tester never ran:\n{recorded}"
        );
    }

    /// The scratch profile briefly holds the user's key in a config file, so the
    /// directory is created owner-only rather than at the ambient umask default.
    #[cfg(unix)]
    #[test]
    fn scratch_profile_directory_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("mr-private-dir-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        create_private_dir(&dir).expect("created");
        let mode = std::fs::metadata(&dir).expect("metadata").permissions().mode() & 0o777;
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(mode, 0o700, "other accounts could read the stored key");
    }

}
