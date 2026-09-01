//! The model call behind a Standup Post: one HTTP request to an
//! OpenAI-compatible endpoint, and every way it can come back as one of the
//! few lines the section can say. The API Key never enters the webview — the
//! command that calls this reads it from the Keychain and hands it straight
//! to the request's Authorization header; see
//! docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md.
//!
//! Waiting, not streaming: a post cannot be acted on until it is complete, so
//! there is one response shape and one 60-second timeout, and nothing else.
//! No retry is attempted here or anywhere else — a model call is billable,
//! and a silent retry would spend the user's money twice for one click.
//!
//! The wire shapes below are a two-sided contract: the tests at the bottom of
//! this file pin the exact JSON, and `src/platform/desktop-rust.test.ts` pins
//! the same names against the TypeScript side it rides in on.

use reqwest::StatusCode;
use serde::Serialize;

/// What the webview asks for. The API Key is deliberately not among these
/// fields: it is supplied by the command, from the Keychain. Must match
/// `StandupPostRequest` in `src/platform/desktop.ts`, as
/// `src/platform/desktop-rust.test.ts` checks.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StandupPostRequest {
    /// Any OpenAI-compatible endpoint, exactly as the user typed it.
    pub base_url: String,
    /// Which model to ask, in the endpoint's own words.
    pub model: String,
    /// The system prompt the post is written under.
    pub system_prompt: String,
    /// The rendered Digest and Task lists the model hears.
    pub user_content: String,
}

/// Why there is no post, as one of the few lines the section can say. Must
/// match `StandupFailure` in `src/platform/desktop.ts`, as
/// `src/platform/desktop-rust.test.ts` checks — the tags are deliberately
/// kebab-case on both sides.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StandupFailure {
    /// No Base URL, no Model, or no API Key: the call was refused before it
    /// could spend anything, and the section links to Settings.
    ModelAccess,
    /// The Keychain would not give up the key — locked, or a prompt refused.
    Keychain,
    /// The network could not be reached at all.
    Offline,
    /// The endpoint answered 401: it does not accept the Key it was sent.
    Unauthorized,
    /// The endpoint answered 429.
    RateLimited,
    /// No answer within the 60-second timeout.
    Timeout,
    /// Any other non-2xx status, named so the line can say which one. A
    /// struct variant rather than a tuple one: an internally tagged enum
    /// cannot tag a bare integer, so this shape is what serde can serialize.
    Other {
        status: u16,
    },
    /// The model said nothing — an empty answer, or one that was not an
    /// answer at all.
    EmptyResponse,
}

/// The command's answer, as the webview reads it: one shape, success or
/// failure, so a failure is an answer like any other. Must match
/// `StandupPostResponse` in `src/platform/desktop.ts`, as
/// `src/platform/desktop-rust.test.ts` checks.
#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum StandupPostResponse {
    Generated {
        markdown: String,
    },
    Failed {
        failure: StandupFailure,
    },
}

/// Asks one OpenAI-compatible endpoint for a post, and answers with the one
/// shape the webview reads.
pub async fn generate(request: StandupPostRequest, api_key: &str) -> StandupPostResponse {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
    {
        Ok(client) => client,
        // A client that cannot be built cannot reach anything.
        Err(_) => return failed(StandupFailure::Offline),
    };

    // A Base URL that ends in a slash is still the base: whatever the user
    // typed, the endpoint's chat completions path is one request away.
    let url = format!(
        "{}/chat/completions",
        request.base_url.trim_end_matches('/')
    );
    let body = serde_json::json!({
        "model": request.model,
        "messages": [
            { "role": "system", "content": request.system_prompt },
            { "role": "user", "content": request.user_content },
        ],
        // Waiting, not streaming: nothing can be acted on until the post is
        // complete, so the answer is asked for whole.
        "stream": false,
    });

    let response = match client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return failed(classify(error)),
    };

    let status = response.status();
    // The two statuses the app has its own words for, before the catch-all.
    if status == StatusCode::UNAUTHORIZED {
        return failed(StandupFailure::Unauthorized);
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return failed(StandupFailure::RateLimited);
    }
    if !status.is_success() {
        return failed(StandupFailure::Other {
            status: status.as_u16(),
        });
    }

    // A 2xx that is not a chat completion is the endpoint not speaking for a
    // model, which is the closest thing there is to an empty answer.
    let value = match response.json::<serde_json::Value>().await {
        Ok(value) => value,
        Err(_) => return failed(StandupFailure::EmptyResponse),
    };

    let content = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("");
    if content.trim().is_empty() {
        return failed(StandupFailure::EmptyResponse);
    }

    StandupPostResponse::Generated {
        markdown: content.to_string(),
    }
}

fn failed(failure: StandupFailure) -> StandupPostResponse {
    StandupPostResponse::Failed { failure }
}

/// A request that never became a response, told apart by what went wrong.
fn classify(error: reqwest::Error) -> StandupFailure {
    if error.is_timeout() {
        StandupFailure::Timeout
    } else if error.is_connect() {
        StandupFailure::Offline
    } else if error.is_builder() {
        // A Base URL that is not a URL at all is a configuration problem, and
        // Settings is where it is fixed.
        StandupFailure::ModelAccess
    } else {
        // TLS, redirects, a body that could not be sent: anything else a
        // reachable network can still refuse. Offline is the closest of the
        // few lines there is.
        StandupFailure::Offline
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The wire tags, pinned as serde actually writes them. This is what the
    /// webview matches on — a rename here that TypeScript does not hear about
    /// is a failure that renders as a blank line, which is why the exact
    /// strings are asserted rather than derived.
    #[test]
    fn every_failure_kind_serializes_as_the_webview_declares_it() {
        let pairs = [
            (
                StandupFailure::ModelAccess,
                r#"{"kind":"model-access"}"#,
            ),
            (StandupFailure::Keychain, r#"{"kind":"keychain"}"#),
            (StandupFailure::Offline, r#"{"kind":"offline"}"#),
            (
                StandupFailure::Unauthorized,
                r#"{"kind":"unauthorized"}"#,
            ),
            (
                StandupFailure::RateLimited,
                r#"{"kind":"rate-limited"}"#,
            ),
            (StandupFailure::Timeout, r#"{"kind":"timeout"}"#),
            (
                StandupFailure::Other { status: 502 },
                r#"{"kind":"other","status":502}"#,
            ),
            (
                StandupFailure::EmptyResponse,
                r#"{"kind":"empty-response"}"#,
            ),
        ];

        for (failure, expected) in pairs {
            assert_eq!(serde_json::to_string(&failure).unwrap(), expected);
        }
    }

    /// The two states, and where a failure rides inside one: the shape the
    /// webview's `state` tag and `failure` field are named for.
    #[test]
    fn the_response_serializes_the_way_the_webview_reads_it() {
        assert_eq!(
            serde_json::to_string(&StandupPostResponse::Generated {
                markdown: "hi".to_string(),
            })
            .unwrap(),
            r#"{"state":"generated","markdown":"hi"}"#
        );
        assert_eq!(
            serde_json::to_string(&StandupPostResponse::Failed {
                failure: StandupFailure::Timeout,
            })
            .unwrap(),
            r#"{"state":"failed","failure":{"kind":"timeout"}}"#
        );
    }
}