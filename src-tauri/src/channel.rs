//! 引擎渠道的一次性 HTTP 调用（无状态、不落库）。
//!
//! 渠道字段的解析复用 provider_files 的 env 映射，模型默认由调用方
//! （当前会话的模型）给出。两个使用方共用这一份管线：记忆复盘（memory::review）
//! 和会话标题一次性补全（history::auto_titles）——请求形状、URL 候选、
//! 响应解析只该有一个实现。
//!
//! API key 只出现在请求头里，不进日志、不进 argv。

use serde_json::{json, Value};
use std::time::Duration;

/// 一次渠道调用需要的全部字段（已从 provider JSON / env 映射解析出来）。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Wire {
    /// `anthropic` | `openai` | `openai-responses`
    pub kind: &'static str,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// 从渠道配置解析调用参数。`model` 是当前会话的模型（优先），渠道里配置的
/// 模型兜底；两者都拿不到就无法调用，报错误原因给界面。
pub(crate) fn resolve_wire(
    engine: &str,
    provider: &Value,
    session_model: Option<&str>,
) -> Result<Wire, String> {
    let env = crate::provider_files::channel_env(engine, provider)
        .map_err(|e| format!("channel env: {e}"))?;
    let from_env = |key: &str| non_empty(env.get(key).map(String::as_str));
    let from_json = |key: &str| non_empty(provider.get(key).and_then(Value::as_str));
    let pick = |keys: &[&str]| keys.iter().find_map(|key| from_env(key).or_else(|| from_json(key)));

    // codex 的渠道把 wire_api 写进 configToml；responses 走 /responses，
    // 其余（relay 预设默认）走 chat/completions。
    let responses = engine == "codex"
        && provider
            .get("configToml")
            .and_then(Value::as_str)
            .is_some_and(|toml| toml.replace(' ', "").contains("wire_api=\"responses\""));

    let kind = if engine == "claude" {
        "anthropic"
    } else if responses {
        "openai-responses"
    } else {
        "openai"
    };
    let base_url = pick(&[
        "ANTHROPIC_BASE_URL",
        "OPENAI_BASE_URL",
        "KIMI_BASE_URL",
        "XAI_API_BASE_URL",
        "baseUrl",
    ])
    .ok_or_else(|| "channel has no base URL".to_string())?;
    let api_key = pick(&[
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "KIMI_API_KEY",
        "XAI_API_KEY",
        "apiKey",
    ])
    .ok_or_else(|| "channel has no API key".to_string())?;
    // Claude 渠道的会话模型常是别名（opus/sonnet/…），直接拿它发 HTTP 会被
    // 渠道当成未知模型；复用 spawn 的解析（槽位映射 + `[1m]` 去掉——那是 CLI
    // 的 beta 约定，不是模型 id）。
    // "default" 是界面上的「渠道默认」，不是模型 id。
    let session_model = non_empty(session_model).filter(|model| model != "default");
    let model = if engine == "claude" {
        crate::engine::resolve_claude_channel_model(
            session_model.as_deref(),
            provider,
            &env,
        )
        .or_else(|| from_env("ANTHROPIC_DEFAULT_SONNET_MODEL"))
        .or_else(|| from_env("ANTHROPIC_DEFAULT_HAIKU_MODEL"))
        .or_else(|| from_json("model"))
    } else {
        session_model
            .or_else(|| from_json("model"))
            .or_else(|| from_env("ANTHROPIC_MODEL"))
            .or_else(|| from_env("KIMI_MODEL_NAME"))
    }
    .map(|model| model.strip_suffix("[1m]").unwrap_or(&model).to_string())
    .ok_or_else(|| "channel has no model".to_string())?;
    Ok(Wire {
        kind,
        base_url,
        api_key,
        model,
    })
}

/// POST 的候选 URL：渠道的 base 可能是 origin、带 `/v1`，或厂商自定义前缀。
/// base 已经带版本段时不再拼 `/v1`（`…/v1/v1/chat/completions` 只会浪费一次
/// 请求）；没带版本段的两种拼法都试。
fn request_urls(wire: &Wire) -> Vec<String> {
    let base = wire.base_url.trim().trim_end_matches('/').to_string();
    let versioned = base
        .rsplit('/')
        .next()
        .is_some_and(|segment| {
            segment.len() > 1
                && segment.starts_with('v')
                && segment[1..].chars().all(|c| c.is_ascii_digit())
        });
    fn push_unique(urls: &mut Vec<String>, url: String) {
        if !urls.contains(&url) {
            urls.push(url);
        }
    }
    let suffix = match wire.kind {
        "anthropic" => "/messages",
        "openai-responses" => "/responses",
        _ => "/chat/completions",
    };
    let mut urls: Vec<String> = Vec::new();
    if versioned {
        push_unique(&mut urls, format!("{base}{suffix}"));
    } else if wire.kind == "anthropic" {
        // Anthropic 路由惯例是 /v1/messages；没带版本段的 base 先试它。
        push_unique(&mut urls, format!("{base}/v1{suffix}"));
        push_unique(&mut urls, format!("{base}{suffix}"));
    } else {
        push_unique(&mut urls, format!("{base}{suffix}"));
        push_unique(&mut urls, format!("{base}/v1{suffix}"));
    }
    urls
}

fn request_body(wire: &Wire, prompt: &str, max_tokens: u32) -> Value {
    match wire.kind {
        "anthropic" => json!({
            "model": wire.model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "messages": [{ "role": "user", "content": prompt }],
        }),
        "openai-responses" => json!({
            "model": wire.model,
            "max_output_tokens": max_tokens,
            "input": prompt,
        }),
        _ => json!({
            "model": wire.model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "stream": false,
            "messages": [{ "role": "user", "content": prompt }],
        }),
    }
}

/// 从响应体里取出模型的文本回复。Anthropic 是 `content[].text`，OpenAI chat
/// 是 `choices[0].message.content`（个别渠道给数组），Responses 是
/// `output[].content[].text`。
fn reply_text(wire: &Wire, body: &Value) -> Option<String> {
    match wire.kind {
        "anthropic" => {
            let mut out = String::new();
            for block in body.get("content")?.as_array()? {
                if block.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        out.push_str(text);
                    }
                }
            }
            (!out.trim().is_empty()).then_some(out)
        }
        "openai-responses" => {
            let mut out = String::new();
            for item in body.get("output")?.as_array()? {
                let Some(content) = item.get("content").and_then(Value::as_array) else {
                    continue;
                };
                for block in content {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        out.push_str(text);
                    }
                }
            }
            (!out.trim().is_empty()).then_some(out)
        }
        _ => match body.pointer("/choices/0/message/content") {
            Some(Value::String(text)) => (!text.trim().is_empty()).then(|| text.clone()),
            Some(Value::Array(blocks)) => {
                let mut out = String::new();
                for block in blocks {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        out.push_str(text);
                    }
                }
                (!out.trim().is_empty()).then_some(out)
            }
            _ => None,
        },
    }
}

/// 出错时截取渠道返回的正文首段，让界面能说清为什么失败（401、模型不存在…）。
fn error_excerpt(status: u16, body: &str) -> String {
    let excerpt: String = body.trim().chars().take(300).collect();
    if excerpt.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {excerpt}")
    }
}

pub(crate) async fn call_channel(
    wire: &Wire,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("build http client: {e}"))?;
    let mut last_error: Option<String> = None;
    for url in request_urls(wire) {
        let mut request = client
            .post(&url)
            .json(&request_body(wire, prompt, max_tokens));
        if wire.kind == "anthropic" {
            request = request
                .header("x-api-key", wire.api_key.as_str())
                .header("anthropic-version", "2023-06-01")
                .header("authorization", format!("Bearer {}", wire.api_key));
        } else {
            request = request.header("authorization", format!("Bearer {}", wire.api_key));
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(e) => {
                last_error = Some(format!("{url}: {e}"));
                continue;
            }
        };
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            last_error = Some(format!("{url}: {}", error_excerpt(status.as_u16(), &body)));
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&body) else {
            last_error = Some(format!("{url}: reply was not JSON"));
            continue;
        };
        match reply_text(wire, &value) {
            Some(text) => return Ok(text),
            None => last_error = Some(format!("{url}: reply carried no text")),
        }
    }
    Err(last_error.unwrap_or_else(|| "no candidate endpoint succeeded".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolve_wire_uses_the_channel_fields_per_engine() {
        let claude = json!({
            "settingsConfig": { "env": {
                "ANTHROPIC_BASE_URL": "https://relay.example/anthropic",
                "ANTHROPIC_AUTH_TOKEN": "sk-claude",
                "ANTHROPIC_MODEL": "claude-sonnet-4-6",
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-relay"
            } }
        });
        let wire = resolve_wire("claude", &claude, Some("claude-opus")).unwrap();
        assert_eq!(wire.kind, "anthropic");
        assert_eq!(wire.base_url, "https://relay.example/anthropic");
        assert_eq!(wire.api_key, "sk-claude");
        // 具体模型名原样用。
        assert_eq!(wire.model, "claude-opus");
        // 会话里的槽位别名要走 spawn 同一套映射（不然渠道认不出来）。
        assert_eq!(
            resolve_wire("claude", &claude, Some("opus")).unwrap().model,
            "claude-opus-4-relay"
        );
        // CLI 的 1m beta 后缀不是模型 id，发 HTTP 前去掉。
        assert_eq!(
            resolve_wire("claude", &claude, Some("claude-opus[1m]"))
                .unwrap()
                .model,
            "claude-opus"
        );

        let codex_chat = json!({
            "baseUrl": "https://relay.example/v1",
            "apiKey": "sk-codex",
            "model": "gpt-5.1-codex",
            "configToml": "model_provider = \"relay\"\n[model_providers.relay]\nwire_api = \"chat\"\n"
        });
        let wire = resolve_wire("codex", &codex_chat, None).unwrap();
        assert_eq!(wire.kind, "openai");
        assert_eq!(wire.model, "gpt-5.1-codex");

        let codex_responses = json!({
            "baseUrl": "https://relay.example/v1",
            "apiKey": "sk-codex",
            "model": "gpt-5.1-codex",
            "configToml": "wire_api = \"responses\"\n"
        });
        assert_eq!(
            resolve_wire("codex", &codex_responses, None).unwrap().kind,
            "openai-responses"
        );

        let kimi = json!({
            "baseUrl": "https://api.moonshot.cn/v1",
            "apiKey": "sk-kimi",
            "model": "kimi-k3"
        });
        let wire = resolve_wire("kimi", &kimi, None).unwrap();
        assert_eq!(wire.kind, "openai");
        assert_eq!(wire.base_url, "https://api.moonshot.cn/v1");
        assert_eq!(wire.api_key, "sk-kimi");
    }

    #[test]
    fn resolve_wire_reports_what_the_channel_is_missing() {
        let no_key = json!({ "baseUrl": "https://relay.example/v1", "model": "m" });
        assert!(resolve_wire("codex", &no_key, None)
            .unwrap_err()
            .contains("API key"));
        let no_model = json!({ "baseUrl": "https://relay.example/v1", "apiKey": "k" });
        assert!(resolve_wire("codex", &no_model, None)
            .unwrap_err()
            .contains("model"));
        let empty = json!({});
        assert!(resolve_wire("codex", &empty, None).is_err());
    }

    #[test]
    fn request_urls_and_bodies_follow_the_wire() {
        let anthropic = Wire {
            kind: "anthropic",
            base_url: "https://relay.example/anthropic/".into(),
            api_key: "k".into(),
            model: "claude-sonnet-4-6".into(),
        };
        assert_eq!(
            request_urls(&anthropic),
            vec![
                "https://relay.example/anthropic/v1/messages",
                "https://relay.example/anthropic/messages",
            ]
        );
        let body = request_body(&anthropic, "整理对话", 2_048);
        assert_eq!(body["model"], "claude-sonnet-4-6");
        assert_eq!(body["messages"][0]["content"], "整理对话");
        // 调用方给的生成上限原样进请求。
        assert_eq!(body["max_tokens"], 2_048);

        let openai = Wire {
            kind: "openai",
            base_url: "https://api.moonshot.cn/v1".into(),
            api_key: "k".into(),
            model: "kimi-k3".into(),
        };
        assert_eq!(
            request_urls(&openai),
            vec![
                "https://api.moonshot.cn/v1/chat/completions",
            ]
        );
        let body = request_body(&openai, "x", 512);
        assert_eq!(body["temperature"], 0);
        assert_eq!(body["max_tokens"], 512);
    }

    #[test]
    fn reply_text_understands_all_three_shapes() {
        let anthropic = Wire {
            kind: "anthropic",
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        let openai = Wire {
            kind: "openai",
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        let responses = Wire {
            kind: "openai-responses",
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        assert_eq!(
            reply_text(
                &anthropic,
                &json!({"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]})
            )
            .as_deref(),
            Some("ab")
        );
        assert_eq!(
            reply_text(
                &openai,
                &json!({"choices":[{"message":{"content":"{\"memory_ops\":[]}"}}]})
            )
            .as_deref(),
            Some("{\"memory_ops\":[]}")
        );
        assert_eq!(
            reply_text(
                &responses,
                &json!({"output":[{"content":[{"type":"output_text","text":"ok"}]}]})
            )
            .as_deref(),
            Some("ok")
        );
        assert!(reply_text(&openai, &json!({"choices":[]})).is_none());
    }
}
