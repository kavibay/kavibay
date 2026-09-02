//! Static catalog of credential types — one entry per integration.
//!
//! Adding an integration means adding a `CredentialTypeDef` here plus the API
//! module that uses it. No new database, no new commands, no new settings UI.

use super::types::{
    AuthCodeDef, AuthKind, ClientSource, CredentialTypeDef, DeviceCodeDef, FieldDef, FieldKind,
    IdentityProbe, Injection, TestRequest, TokenAuth,
};

/// Type id constants — used by API modules and (later) extension manifests.
pub const GITHUB_PAT: &str = "githubPat";
pub const LINEAR_API: &str = "linearApi";
pub const TRELLO_API: &str = "trelloApi";
pub const NOTION_API: &str = "notionApi";
pub const N8N_API: &str = "n8nApi";
pub const SPOTIFY_OAUTH2: &str = "spotifyOAuth2";
pub const FITBIT_OAUTH2: &str = "fitbitOAuth2";
pub const CLOUDFLARE_WORKERS_AI: &str = "cloudflareWorkersAi";
pub const ANTHROPIC_API: &str = "anthropicApi";
pub const OPENAI_API: &str = "openaiApi";
pub const GOOGLE_CALENDAR_OAUTH2: &str = "googleCalendarOAuth2";
pub const TADO_OAUTH2: &str = "tadoOAuth2";
/// GitHub personal access token (single secret field).
const GITHUB: CredentialTypeDef = CredentialTypeDef {
    id: GITHUB_PAT,
    display_name: "GitHub Personal Access Token",
    description: "Fine-grained or classic PAT with read access to Actions of the repositories you want to watch.",
    docs_url: Some("https://github.com/settings/tokens"),
    fields: &[FieldDef {
        key: "token",
        label: "Personal Access Token",
        kind: FieldKind::Password,
        required: true,
        placeholder: Some("ghp_… / github_pat_…"),
        help: Some("Needs `repo` (classic) or Actions: Read-only (fine-grained)."),
        env: None,
    }],
    auth: AuthKind::Static,
    inject: Injection::Bearer {
        value: "{{token}}",
        extra_headers: &[],
    },
    test: Some(TestRequest {
        url: "https://api.github.com/user",
        headers: &[
            ("Accept", "application/vnd.github+json"),
            ("X-GitHub-Api-Version", "2022-11-28"),
        ],
        success: "Token accepted by GitHub.",
        body: None,
    }),
    instance_url_field: None,
};

/// Linear personal API key. GraphQL-only, and the key is the Authorization
/// header as-is — a Bearer prefix is rejected by Linear for this key type.
const LINEAR: CredentialTypeDef = CredentialTypeDef {
    id: LINEAR_API,
    display_name: "Linear API Key",
    description: "A personal API key from Linear with access to the issues you want to show.",
    docs_url: Some("https://linear.app/settings/account/security"),
    fields: &[FieldDef {
        key: "apiKey",
        label: "API Key",
        kind: FieldKind::Password,
        required: true,
        placeholder: Some("lin_api_…"),
        help: Some(
            "Settings → Account → Security & access. The key is sent without a Bearer prefix.",
        ),
        env: None,
    }],
    auth: AuthKind::Static,
    inject: Injection::Header {
        name: "Authorization",
        value: "{{apiKey}}",
    },
    test: Some(TestRequest {
        url: "https://api.linear.app/graphql",
        headers: &[("Content-Type", "application/json")],
        success: "Key accepted by Linear.",
        body: Some(r#"{"query":"{ viewer { id } }"}"#),
    }),
    instance_url_field: None,
};

/// Trello API key + user token. Auth is two query parameters, not a header —
/// Trello's REST API does not accept Bearer, and the key is considered public.
const TRELLO: CredentialTypeDef = CredentialTypeDef {
    id: TRELLO_API,
    display_name: "Trello",
    description: "An API key and a user token from trello.com/app-key, with read access to the boards you want to show.",
    docs_url: Some("https://trello.com/app-key"),
    fields: &[
        FieldDef {
            key: "apiKey",
            label: "API Key",
            kind: FieldKind::Text,
            required: true,
            placeholder: None,
            help: Some("trello.com/app-key. The key is public; the token below is the secret."),
            env: None,
        },
        FieldDef {
            key: "token",
            label: "Token",
            kind: FieldKind::Password,
            required: true,
            placeholder: None,
            help: Some("On the same page, generate a token with read access."),
            env: None,
        },
    ],
    auth: AuthKind::Static,
    inject: Injection::Query {
        params: &[("key", "{{apiKey}}"), ("token", "{{token}}")],
    },
    test: Some(TestRequest {
        url: "https://api.trello.com/1/members/me",
        headers: &[],
        success: "Key and token accepted by Trello.",
        body: None,
    }),
    instance_url_field: None,
};

/// Notion internal integration secret. Bearer plus a constant `Notion-Version`
/// header — the API refuses every request that omits the version.
const NOTION: CredentialTypeDef = CredentialTypeDef {
    id: NOTION_API,
    display_name: "Notion",
    description: "An internal integration secret with access to the pages and databases you share with it.",
    docs_url: Some("https://www.notion.so/my-integrations"),
    fields: &[FieldDef {
        key: "token",
        label: "Internal Integration Secret",
        kind: FieldKind::Password,
        required: true,
        placeholder: Some("ntn_… / secret_…"),
        help: Some(
            "notion.so/my-integrations. Share each page or database with the integration — a token without shares sees nothing.",
        ),
        env: None,
    }],
    auth: AuthKind::Static,
    inject: Injection::Bearer {
        value: "{{token}}",
        extra_headers: &[("Notion-Version", "2022-06-28")],
    },
    test: Some(TestRequest {
        url: "https://api.notion.com/v1/users/me",
        headers: &[],
        success: "Token accepted by Notion.",
        body: None,
    }),
    instance_url_field: None,
};

/// n8n Public API: instance URL + API key. Auth is `X-N8N-API-KEY`, and the
/// host is whatever origin the person typed — cloud or self-hosted.
const N8N: CredentialTypeDef = CredentialTypeDef {
    id: N8N_API,
    display_name: "n8n",
    description: "An n8n instance URL and an API key with access to the workflows you want to show.",
    docs_url: Some("https://docs.n8n.io/api/authentication/"),
    fields: &[
        FieldDef {
            key: "origin",
            label: "Instance URL",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("https://n8n.example.com"),
            help: Some(
                "Cloud or self-hosted origin. A path prefix is kept; /api/v1 is the API root and is stripped.",
            ),
            env: None,
        },
        FieldDef {
            key: "apiKey",
            label: "API Key",
            kind: FieldKind::Password,
            required: true,
            placeholder: None,
            help: Some("Settings → n8n API. Sent as X-N8N-API-KEY; this file never sees the value."),
            env: None,
        },
    ],
    auth: AuthKind::Static,
    inject: Injection::Header {
        name: "X-N8N-API-KEY",
        value: "{{apiKey}}",
    },
    test: Some(TestRequest {
        url: "{{origin}}/api/v1/workflows?limit=1",
        headers: &[],
        success: "Key accepted by this n8n instance.",
        body: None,
    }),
    instance_url_field: Some("origin"),
};

/// Spotify: user-registered OAuth public client + PKCE, no client secret.
const SPOTIFY: CredentialTypeDef = CredentialTypeDef {
    id: SPOTIFY_OAUTH2,
    display_name: "Spotify",
    description: "Your own Spotify Developer app (Client ID), then sign in to connect the account.",
    docs_url: Some("https://developer.spotify.com/dashboard"),
    fields: &[FieldDef {
        key: "clientId",
        label: "Client ID",
        kind: FieldKind::Text,
        required: true,
        placeholder: Some("32-character client id"),
        help: Some(
            "Redirect URI exactly http://127.0.0.1:17444/callback — HTTP is allowed only for 127.0.0.1, not localhost. PKCE — no client secret.",
        ),
        env: Some("KAVIBAY_SPOTIFY_CLIENT_ID"),
    }],
    auth: AuthKind::OAuth2AuthCode(AuthCodeDef {
        auth_url: "https://accounts.spotify.com/authorize",
        token_url: "https://accounts.spotify.com/api/token",
        // `user-read-playback-state` is what `/me/player/devices` needs, and it is
        // not implied by `user-modify-playback-state`: an account may control
        // playback without being allowed to see where it could play.
        //
        // A scope added here does NOT reach an account that is already
        // connected. Refreshing a token keeps the scopes it was issued with, so
        // the device list answers 403 until the person disconnects and connects
        // again — which is worth saying in the UI rather than debugging twice.
        scopes: "user-read-private user-read-playback-state user-read-currently-playing user-read-recently-played user-library-read user-top-read user-modify-playback-state playlist-read-private playlist-read-collaborative",
        client: ClientSource::Fields {
            id_key: "clientId",
            secret_key: None,
        },
        identity: Some(IdentityProbe {
            url: "https://api.spotify.com/v1/me",
            label_pointer: "/display_name",
            extras: &[],
        }),
        extra_auth_params: &[],
        token_auth: TokenAuth::Form,
        loopback_port: Some(17444),
        loopback_path: Some("/callback"),
    }),
    inject: Injection::Bearer {
        value: "{{accessToken}}",
        extra_headers: &[],
    },
    test: None,
    instance_url_field: None,
};

/// Fitbit: user-registered OAuth Personal/Server client. Token requests use
/// HTTP Basic (`client_id:client_secret`); the dashboard matches the redirect
/// URI including the port, so the loopback bind is fixed rather than ephemeral.
const FITBIT: CredentialTypeDef = CredentialTypeDef {
    id: FITBIT_OAUTH2,
    display_name: "Fitbit",
    description: "Your own Fitbit Web API app, then sign in to connect the account.",
    docs_url: Some("https://dev.fitbit.com/apps"),
    fields: &[
        FieldDef {
            key: "clientId",
            label: "Client ID",
            kind: FieldKind::Text,
            required: true,
            placeholder: None,
            help: Some(
                "dev.fitbit.com/apps. Redirect URI exactly http://127.0.0.1:17443/ (trailing slash).",
            ),
            env: Some("KAVIBAY_FITBIT_CLIENT_ID"),
        },
        FieldDef {
            key: "clientSecret",
            label: "Client Secret",
            kind: FieldKind::Password,
            required: true,
            placeholder: None,
            help: Some("Encrypted for this user; never shown again after saving."),
            env: Some("KAVIBAY_FITBIT_CLIENT_SECRET"),
        },
    ],
    auth: AuthKind::OAuth2AuthCode(AuthCodeDef {
        auth_url: "https://www.fitbit.com/oauth2/authorize",
        token_url: "https://api.fitbit.com/oauth2/token",
        scopes: "activity sleep profile",
        client: ClientSource::Fields {
            id_key: "clientId",
            secret_key: Some("clientSecret"),
        },
        identity: Some(IdentityProbe {
            url: "https://api.fitbit.com/1/user/-/profile.json",
            label_pointer: "/user/displayName",
            extras: &[],
        }),
        extra_auth_params: &[],
        token_auth: TokenAuth::Basic,
        loopback_port: Some(17443),
        loopback_path: None,
    }),
    inject: Injection::Bearer {
        value: "{{accessToken}}",
        extra_headers: &[],
    },
    test: None,
    instance_url_field: None,
};

/// Cloudflare Workers AI: public account id + secret API token.
const CLOUDFLARE: CredentialTypeDef = CredentialTypeDef {
    id: CLOUDFLARE_WORKERS_AI,
    display_name: "Cloudflare Workers AI",
    description: "Account ID and an API token with the Workers AI permission.",
    docs_url: Some("https://dash.cloudflare.com/profile/api-tokens"),
    fields: &[
        FieldDef {
            key: "accountId",
            label: "Account ID",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("32-character account id"),
            help: Some("Cloudflare dashboard → Workers & Pages → Account ID."),
            env: None,
        },
        FieldDef {
            key: "apiToken",
            label: "API Token",
            kind: FieldKind::Password,
            required: true,
            placeholder: None,
            help: Some("Create a token with the Workers AI: Read permission."),
            env: None,
        },
    ],
    auth: AuthKind::Static,
    inject: Injection::Bearer {
        value: "{{apiToken}}",
        extra_headers: &[],
    },
    test: Some(TestRequest {
        url: "https://api.cloudflare.com/client/v4/accounts/{{accountId}}",
        headers: &[],
        success: "Account and token accepted by Cloudflare.",
        body: None,
    }),
    instance_url_field: None,
};

/// Anthropic (Claude) API: one secret key, sent in `x-api-key`.
const ANTHROPIC: CredentialTypeDef = CredentialTypeDef {
    id: ANTHROPIC_API,
    display_name: "Anthropic (Claude) API",
    description: "An API key from the Anthropic Console with access to the Messages API.",
    docs_url: Some("https://console.anthropic.com/settings/keys"),
    fields: &[FieldDef {
        key: "apiKey",
        label: "API Key",
        kind: FieldKind::Password,
        required: true,
        placeholder: Some("sk-ant-…"),
        help: Some("Console → Settings → API keys. Billing must be enabled."),
        env: None,
    }],
    auth: AuthKind::Static,
    // Anthropic reads the key from x-api-key, not Authorization: Bearer.
    inject: Injection::Header {
        name: "x-api-key",
        value: "{{apiKey}}",
    },
    test: Some(TestRequest {
        url: "https://api.anthropic.com/v1/models",
        headers: &[("anthropic-version", "2023-06-01")],
        success: "Key accepted by Anthropic.",
        body: None,
    }),
    instance_url_field: None,
};

/// OpenAI API: one secret key, bearer auth.
const OPENAI: CredentialTypeDef = CredentialTypeDef {
    id: OPENAI_API,
    display_name: "OpenAI API",
    description: "An API key from the OpenAI platform with access to chat completions.",
    docs_url: Some("https://platform.openai.com/api-keys"),
    fields: &[FieldDef {
        key: "apiKey",
        label: "API Key",
        kind: FieldKind::Password,
        required: true,
        placeholder: Some("sk-…"),
        help: Some("Project keys work; the project needs a positive credit balance."),
        env: None,
    }],
    auth: AuthKind::Static,
    inject: Injection::Bearer {
        value: "{{apiKey}}",
        extra_headers: &[],
    },
    test: Some(TestRequest {
        url: "https://api.openai.com/v1/models",
        headers: &[],
        success: "Key accepted by OpenAI.",
        body: None,
    }),
    instance_url_field: None,
};

/// Google Calendar: user-registered OAuth Desktop client + consent flow.
const GOOGLE_CALENDAR: CredentialTypeDef = CredentialTypeDef {
    id: GOOGLE_CALENDAR_OAUTH2,
    display_name: "Google Calendar OAuth2",
    description: "Your own Google Cloud OAuth Desktop client, then sign in to connect the account.",
    docs_url: Some("https://console.cloud.google.com/apis/credentials"),
    fields: &[
        FieldDef {
            key: "clientId",
            label: "Client ID",
            kind: FieldKind::Text,
            required: true,
            placeholder: Some("…apps.googleusercontent.com"),
            help: None,
            env: Some("KAVIBAY_GOOGLE_CALENDAR_CLIENT_ID"),
        },
        FieldDef {
            key: "clientSecret",
            label: "Client Secret",
            kind: FieldKind::Password,
            required: true,
            placeholder: None,
            help: Some("Encrypted for this user; never shown again after saving."),
            env: Some("KAVIBAY_GOOGLE_CALENDAR_CLIENT_SECRET"),
        },
    ],
    auth: AuthKind::OAuth2AuthCode(AuthCodeDef {
        auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
        token_url: "https://oauth2.googleapis.com/token",
        scopes: "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email",
        client: ClientSource::Fields {
            id_key: "clientId",
            secret_key: Some("clientSecret"),
        },
        identity: Some(IdentityProbe {
            url: "https://www.googleapis.com/oauth2/v2/userinfo",
            label_pointer: "/email",
            extras: &[],
        }),
        // offline access + forced consent, so a refresh token is always issued.
        extra_auth_params: &[("access_type", "offline"), ("prompt", "consent")],
        token_auth: TokenAuth::Form,
        loopback_port: None,
        loopback_path: None,
    }),
    inject: Injection::Bearer {
        value: "{{accessToken}}",
        extra_headers: &[],
    },
    test: None,
    instance_url_field: None,
};

/// Tado: provider-published public client, device-code flow, no user fields.
const TADO: CredentialTypeDef = CredentialTypeDef {
    id: TADO_OAUTH2,
    display_name: "tado° Account",
    description: "Sign in at tado.com with the code shown here — no client registration needed.",
    docs_url: None,
    fields: &[],
    auth: AuthKind::OAuth2DeviceCode(DeviceCodeDef {
        device_url: "https://login.tado.com/oauth2/device_authorize",
        token_url: "https://login.tado.com/oauth2/token",
        scopes: "offline_access",
        client: ClientSource::BuiltIn {
            client_id: "1bb50063-6b0c-4d11-bd99-387f4a91cc46",
        },
        identity: Some(IdentityProbe {
            url: "https://my.tado.com/api/v2/me",
            label_pointer: "/email",
            // The zone API needs the home id; the UI shows the home name.
            extras: &[("homeId", "/homes/0/id"), ("homeName", "/homes/0/name")],
        }),
    }),
    inject: Injection::Bearer {
        value: "{{accessToken}}",
        extra_headers: &[],
    },
    test: None,
    instance_url_field: None,
};

/// Every known credential type, in display order.
pub const ALL: &[CredentialTypeDef] = &[
    GITHUB,
    LINEAR,
    TRELLO,
    NOTION,
    N8N,
    SPOTIFY,
    FITBIT,
    CLOUDFLARE,
    ANTHROPIC,
    OPENAI,
    GOOGLE_CALENDAR,
    TADO,
];

/// Looks up a type definition by id.
pub fn find(type_id: &str) -> Option<&'static CredentialTypeDef> {
    ALL.iter().find(|def| def.id == type_id)
}

/// Looks up a type definition, or reports an unknown id (fail closed).
pub fn require(type_id: &str) -> Result<&'static CredentialTypeDef, String> {
    find(type_id).ok_or_else(|| format!("unknown credential type: {type_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn type_ids_are_unique() {
        let mut seen = HashSet::new();
        for def in ALL {
            assert!(
                seen.insert(def.id),
                "duplicate credential type id: {}",
                def.id
            );
        }
    }

    #[test]
    fn field_keys_are_unique_within_a_type() {
        for def in ALL {
            let mut seen = HashSet::new();
            for field in def.fields {
                assert!(
                    seen.insert(field.key),
                    "duplicate field key {} in {}",
                    field.key,
                    def.id
                );
            }
        }
    }

    /// The OAuth client must reference fields the type actually declares —
    /// otherwise a flow would fail only at connect time, in front of the user.
    #[test]
    fn oauth_client_sources_reference_declared_fields() {
        for def in ALL {
            let client = match &def.auth {
                AuthKind::Static => continue,
                AuthKind::OAuth2AuthCode(auth) => auth.client,
                AuthKind::OAuth2DeviceCode(device) => device.client,
            };
            if let ClientSource::Fields { id_key, secret_key } = client {
                assert!(
                    def.field(id_key).is_some(),
                    "{}: {id_key} not declared",
                    def.id
                );
                if let Some(secret_key) = secret_key {
                    assert!(
                        def.field(secret_key).is_some(),
                        "{}: {secret_key} not declared",
                        def.id
                    );
                }
            }
        }
    }

    /// Injection templates may only reference declared fields or the synthetic
    /// `accessToken` (OAuth types only).
    #[test]
    fn injection_templates_reference_known_keys() {
        for def in ALL {
            for template in def.inject.templates() {
                // Which header or query param the template lands in does not
                // change which keys it may name.
                super::super::types::render_template(template, |key| {
                    if key == "accessToken" {
                        assert!(
                            def.auth.is_oauth(),
                            "{}: accessToken used by a non-OAuth type",
                            def.id
                        );
                        return Some(String::new());
                    }
                    assert!(def.field(key).is_some(), "{}: unknown key {key}", def.id);
                    Some(String::new())
                })
                .unwrap_or_else(|error| panic!("{}: {error}", def.id));
            }
        }
    }

    /// Test-request URLs may only reference declared fields (they run before a
    /// token exists for OAuth types).
    #[test]
    fn test_request_urls_reference_declared_fields() {
        for def in ALL {
            let Some(test) = def.test else { continue };
            super::super::types::render_template(test.url, |key| {
                assert!(def.field(key).is_some(), "{}: unknown key {key}", def.id);
                Some(String::new())
            })
            .unwrap_or_else(|error| panic!("{}: {error}", def.id));
        }
    }

    /// Same rule as the URL: a POST body may only name declared fields.
    #[test]
    fn test_request_bodies_reference_declared_fields() {
        for def in ALL {
            let Some(test) = def.test else { continue };
            let Some(body) = test.body else { continue };
            super::super::types::render_template(body, |key| {
                assert!(def.field(key).is_some(), "{}: unknown key {key}", def.id);
                Some(String::new())
            })
            .unwrap_or_else(|error| panic!("{}: {error}", def.id));
        }
    }

    /// Linear personal API keys fail if sent as `Authorization: Bearer …`.
    #[test]
    fn linear_personal_keys_are_not_bearer() {
        match require(LINEAR_API).unwrap().inject {
            Injection::Header { name, value } => {
                assert_eq!(name, "Authorization");
                assert_eq!(value, "{{apiKey}}");
            }
            Injection::Bearer { .. } => {
                panic!("Linear personal API keys reject the Bearer prefix")
            }
            Injection::Query { .. } => {
                panic!("Linear personal API keys are a header, not query params")
            }
        }
        let test = require(LINEAR_API)
            .unwrap()
            .test
            .expect("Linear has a connection test");
        assert!(
            test.body.is_some(),
            "Linear GraphQL cannot be probed with GET"
        );
    }

    /// Trello authenticates with `?key=&token=`, not a header.
    #[test]
    fn trello_auth_is_query_params() {
        match require(TRELLO_API).unwrap().inject {
            Injection::Query { params } => {
                assert_eq!(params, &[("key", "{{apiKey}}"), ("token", "{{token}}")]);
            }
            Injection::Bearer { .. } | Injection::Header { .. } => {
                panic!("Trello REST rejects Bearer and does not use a custom header")
            }
        }
        let test = require(TRELLO_API)
            .unwrap()
            .test
            .expect("Trello has a connection test");
        assert!(test.body.is_none(), "Trello is probed with GET /members/me");
    }

    /// Notion refuses every request without `Notion-Version`.
    #[test]
    fn notion_sends_bearer_and_version_header() {
        match require(NOTION_API).unwrap().inject {
            Injection::Bearer {
                value,
                extra_headers,
            } => {
                assert_eq!(value, "{{token}}");
                assert_eq!(extra_headers, &[("Notion-Version", "2022-06-28")]);
            }
            Injection::Header { .. } | Injection::Query { .. } => {
                panic!("Notion is Bearer plus Notion-Version, not a custom header or query")
            }
        }
        let test = require(NOTION_API)
            .unwrap()
            .test
            .expect("Notion has a connection test");
        assert!(
            test.body.is_none(),
            "Notion is probed with GET /v1/users/me"
        );
    }

    /// n8n authenticates with `X-N8N-API-KEY` and an instance URL, not Bearer.
    #[test]
    fn n8n_auth_is_api_key_header() {
        match require(N8N_API).unwrap().inject {
            Injection::Header { name, value } => {
                assert_eq!(name, "X-N8N-API-KEY");
                assert_eq!(value, "{{apiKey}}");
            }
            Injection::Bearer { .. } | Injection::Query { .. } => {
                panic!("n8n rejects Bearer and does not put the key in the query")
            }
        }
        let def = require(N8N_API).unwrap();
        assert_eq!(def.instance_url_field, Some("origin"));
        let test = def.test.expect("n8n has a connection test");
        assert!(
            test.url.starts_with("{{origin}}/api/v1/"),
            "the probe hits the typed instance, not a compiled host"
        );
    }

    /// Spotify is a public PKCE client: auth-code, no secret, Bearer access token.
    #[test]
    fn spotify_is_auth_code_pkce_without_secret() {
        let def = require(SPOTIFY_OAUTH2).unwrap();
        match def.auth {
            AuthKind::OAuth2AuthCode(auth) => {
                assert_eq!(auth.auth_url, "https://accounts.spotify.com/authorize");
                assert_eq!(auth.token_url, "https://accounts.spotify.com/api/token");
                match auth.client {
                    ClientSource::Fields {
                        id_key,
                        secret_key: None,
                    } => assert_eq!(id_key, "clientId"),
                    _ => panic!("Spotify must be a public client (no secret_key)"),
                }
                let identity = auth.identity.expect("Spotify names the connected account");
                assert_eq!(identity.url, "https://api.spotify.com/v1/me");
                assert_eq!(identity.label_pointer, "/display_name");
                assert!(
                    auth.scopes.contains("user-read-currently-playing")
                        && auth.scopes.contains("user-read-recently-played")
                        && auth.scopes.contains("user-library-read")
                        && auth.scopes.contains("user-top-read")
                        && auth.scopes.contains("user-modify-playback-state"),
                    "library and top-list scopes ship with the type, not as a later add-on"
                );
                assert_eq!(auth.loopback_port, Some(17444));
                assert_eq!(auth.loopback_path, Some("/callback"));
            }
            AuthKind::Static | AuthKind::OAuth2DeviceCode(_) => {
                panic!("Spotify must use the authorization-code flow")
            }
        }
        match def.inject {
            Injection::Bearer {
                value,
                extra_headers: _,
            } => assert_eq!(value, "{{accessToken}}"),
            Injection::Header { .. } | Injection::Query { .. } => {
                panic!("Spotify Web API is Bearer")
            }
        }
        assert!(
            def.test.is_none(),
            "OAuth types probe identity, not a static test"
        );
        assert!(def.instance_url_field.is_none());
        let help = def.fields[0]
            .help
            .expect("Spotify tells the user the redirect URI");
        assert!(
            help.contains("http://127.0.0.1:17444/callback"),
            "the help URI must match the pinned loopback, or the dashboard entry will not"
        );
    }

    /// Fitbit Personal/Server apps authenticate the token endpoint with Basic,
    /// and the dashboard matches the redirect URI including the port.
    #[test]
    fn fitbit_is_auth_code_basic_with_fixed_loopback() {
        let def = require(FITBIT_OAUTH2).unwrap();
        match def.auth {
            AuthKind::OAuth2AuthCode(auth) => {
                assert_eq!(auth.auth_url, "https://www.fitbit.com/oauth2/authorize");
                assert_eq!(auth.token_url, "https://api.fitbit.com/oauth2/token");
                assert_eq!(auth.token_auth, TokenAuth::Basic);
                assert_eq!(auth.loopback_port, Some(17443));
                match auth.client {
                    ClientSource::Fields {
                        id_key,
                        secret_key: Some(secret_key),
                    } => {
                        assert_eq!(id_key, "clientId");
                        assert_eq!(secret_key, "clientSecret");
                    }
                    _ => panic!("Fitbit Personal/Server apps have a client secret"),
                }
                let identity = auth.identity.expect("Fitbit names the connected account");
                assert_eq!(identity.url, "https://api.fitbit.com/1/user/-/profile.json");
                assert_eq!(identity.label_pointer, "/user/displayName");
                assert!(
                    auth.scopes.contains("activity") && auth.scopes.contains("sleep"),
                    "activity and sleep are declared scopes, not later add-ons"
                );
            }
            AuthKind::Static | AuthKind::OAuth2DeviceCode(_) => {
                panic!("Fitbit must use the authorization-code flow")
            }
        }
        match def.inject {
            Injection::Bearer {
                value,
                extra_headers: _,
            } => assert_eq!(value, "{{accessToken}}"),
            Injection::Header { .. } | Injection::Query { .. } => {
                panic!("Fitbit Web API is Bearer")
            }
        }
        assert!(def.test.is_none());
    }

    /// Basic token auth without a client secret would send an empty password.
    #[test]
    fn basic_token_auth_requires_a_client_secret() {
        for def in ALL {
            let AuthKind::OAuth2AuthCode(auth) = def.auth else {
                continue;
            };
            if auth.token_auth != TokenAuth::Basic {
                continue;
            }
            match auth.client {
                ClientSource::Fields {
                    secret_key: Some(_),
                    ..
                } => {}
                _ => panic!(
                    "{} uses Basic token auth without a client secret field",
                    def.id
                ),
            }
        }
    }

    #[test]
    fn oauth_types_declare_their_endpoints() {
        for def in ALL {
            match &def.auth {
                AuthKind::Static => {}
                AuthKind::OAuth2AuthCode(auth) => {
                    assert!(auth.auth_url.starts_with("https://"), "{}", def.id);
                    assert!(auth.token_url.starts_with("https://"), "{}", def.id);
                }
                AuthKind::OAuth2DeviceCode(device) => {
                    assert!(device.device_url.starts_with("https://"), "{}", def.id);
                    assert!(device.token_url.starts_with("https://"), "{}", def.id);
                }
            }
        }
    }

    #[test]
    fn require_rejects_unknown_ids() {
        assert!(require(GITHUB_PAT).is_ok());
        assert!(require("nope").is_err());
    }
}
