//! The model call behind a Standup Post: one HTTP request to an
//! OpenAI-compatible endpoint, and every way it can come back as one of the
//! few lines the section can say. The API Key never enters the webview — the
//! command that calls this reads it from the Keychain and hands it straight
//! to the request's Authorization header; see
//! docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md.
//! That header is only ever attached to a transport that may carry it —
//! https, or plaintext to this machine's own loopback — see
//! `transport_allows`.
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
    /// No Base URL, no Model, or no API Key — or a Base URL that is not a
    /// URL at all: the call was refused before it could spend anything, and
    /// the section links to Settings.
    ModelAccess,
    /// The Base URL would carry the API Key and a day of journal content
    /// over plaintext: not https, and not an endpoint on this machine's own
    /// loopback — `localhost`, any of `127.0.0.0/8`, or `::1`. The call is
    /// refused before the Key is ever attached — see `transport_allows` —
    /// and Settings is where the URL is fixed.
    HttpsRequired,
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
        // A redirect is another request, so the transport rule holds at every
        // hop: following an endpoint that points the Key or the content back
        // down to plaintext would undo the gate below. Stopped rather than
        // followed — the 3xx answer is the refusal — and capped at the same
        // ten hops the default allows, which a custom policy would otherwise
        // not count for us.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 10 {
                attempt.error("too many redirects")
            } else if transport_allows(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
    {
        Ok(client) => client,
        // A client that cannot be built cannot reach anything.
        Err(_) => return failed(StandupFailure::Offline),
    };

    let url = match chat_url(&request.base_url) {
        Ok(url) => url,
        // Not a URL at all, or a URL the Key must not travel on: refused
        // before the request, and Settings is where the Base URL is fixed.
        // Enforced here rather than in the view, so a settings file edited
        // by hand gets the same answer.
        Err(failure) => return failed(failure),
    };
    let body = completion_body(&request);

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

/// The URL the call would go to, or why the call is refused before it can:
/// a Base URL that is not a URL at all is a configuration problem like an
/// empty one (`ModelAccess`), and a URL the Key must not travel on is the
/// `HttpsRequired` refusal. A Base URL that ends in a slash is still the
/// base: whatever the user typed, the endpoint's chat completions path is
/// one request away. The path is joined onto the parsed URL, so a query
/// string on the Base URL (an Azure-style `api-version`, a routing token)
/// rides through to the request and a fragment stays where it belongs
/// instead of swallowing the appended path.
fn chat_url(base_url: &str) -> Result<reqwest::Url, StandupFailure> {
    let mut url = match reqwest::Url::parse(base_url) {
        Ok(url) => url,
        Err(_) => return Err(StandupFailure::ModelAccess),
    };
    if !transport_allows(&url) {
        return Err(StandupFailure::HttpsRequired);
    }
    match url.path_segments_mut() {
        Ok(mut segments) => {
            segments.pop_if_empty().push("chat").push("completions");
        }
        Err(_) => return Err(StandupFailure::ModelAccess),
    }
    Ok(url)
}

/// Whether the API Key may be attached to a request to this URL: always
/// over https, or over plaintext only to this machine's own loopback — a
/// self-hosted Ollama-style endpoint on `localhost`, any of `127.0.0.0/8`,
/// or `::1`. Every other plaintext hop would put the Key and the post's
/// journal content on the wire for anyone on the way to read.
fn transport_allows(url: &reqwest::Url) -> bool {
    match url.scheme() {
        "https" => true,
        // The parsed host, not the typed one: `http://127.0.0.1.evil.com`
        // is one name with an attacker's in it, and is refused like any
        // other. The url crate has already folded odd spellings of an
        // address (`http://2130706433/`) into a real IP before this sees it.
        "http" => url.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                // `host_str` keeps the brackets the URL form serializes an
                // IPv6 address with, so an address parses only once they
                // are off; a domain never parses as an IP at all.
                || host
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        }),
        // Anything else — ftp, file, a bare word — is not a transport an
        // HTTP Authorization header belongs on.
        _ => false,
    }
}

/// The one request shape sent to the model. A Standup Post is a bounded
/// rewrite of already-structured material, so low reasoning keeps enough
/// room to reconcile Notes and Tasks without paying the latency and token
/// cost of GPT-5.6's medium default.
fn completion_body(request: &StandupPostRequest) -> serde_json::Value {
    serde_json::json!({
        "model": request.model,
        "messages": [
            { "role": "system", "content": request.system_prompt },
            { "role": "user", "content": request.user_content },
        ],
        "reasoning_effort": "low",
        // Waiting, not streaming: nothing can be acted on until the post is
        // complete, so the answer is asked for whole.
        "stream": false,
    })
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

    #[test]
    fn the_model_is_asked_with_low_reasoning_effort() {
        let body = completion_body(&StandupPostRequest {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-5.6-luna".to_string(),
            system_prompt: "Write a standup post.".to_string(),
            user_content: "## Still to do\n- [ ] Ship it".to_string(),
        });

        assert_eq!(body["reasoning_effort"], "low");
    }

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
            (
                StandupFailure::HttpsRequired,
                r#"{"kind":"https-required"}"#,
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

    /// The URL a call would go to, and the two ways a Base URL can be
    /// refused before the Key is ever attached. The settings file is edited
    /// by hand in exactly the way these cover: a plaintext endpoint, and a
    /// string that is not a URL at all.
    #[test]
    fn a_base_url_that_plaintexts_the_key_is_refused() {
        for refused in [
            "http://api.openai.com/v1",
            "http://example.com",
            // A name that merely *ends* in a loopback is still a name on the
            // open network, and a scheme uppercased is the same scheme.
            "http://127.0.0.1.evil.com",
            "http://localhost.evil.com",
            "HTTP://EXAMPLE.COM",
            "ftp://example.com",
        ] {
            assert!(matches!(
                chat_url(refused),
                Err(StandupFailure::HttpsRequired)
            ), "{refused} should be refused");
        }
    }

    #[test]
    fn a_loopback_endpoint_stays_usable_over_plaintext() {
        for allowed in [
            "https://api.openai.com/v1",
            "https://localhost/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434/v1",
            "http://127.0.0.1/v1/",
            // The rest of the loopback range and IPv6's ::1 are loopback
            // too, and the url crate folds these odd spellings of 127.0.0.1
            // into a real address before the check.
            "http://127.0.0.2/v1",
            "http://[::1]:11434/v1",
            "http://2130706433/v1",
            "http://0x7f.0.0.1/v1",
        ] {
            assert!(chat_url(allowed).is_ok(), "{allowed} should be allowed");
        }
    }

    #[test]
    fn a_base_url_that_is_not_a_url_is_refused_as_configuration() {
        for not_a_url in ["", "api.openai.com/v1"] {
            assert!(matches!(
                chat_url(not_a_url),
                Err(StandupFailure::ModelAccess)
            ), "{not_a_url:?} should be ModelAccess");
        }
    }

    /// The chat path is joined onto the parsed URL, so a query string or a
    /// fragment on the Base URL stays where it belongs instead of swallowing
    /// the appended path. A query (Azure-style `api-version`, routing
    /// tokens) rides through to the request.
    #[test]
    fn chat_path_is_appended_to_the_parsed_url() {
        for (base, expected) in [
            (
                "https://api.openai.com/v1",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "https://api.openai.com/v1/",
                "https://api.openai.com/v1/chat/completions",
            ),
            (
                "https://api.openai.com/v1?key=x",
                "https://api.openai.com/v1/chat/completions?key=x",
            ),
            (
                "https://api.openai.com/v1#frag",
                "https://api.openai.com/v1/chat/completions#frag",
            ),
        ] {
            assert_eq!(chat_url(base).unwrap().as_str(), expected, "{base}");
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
