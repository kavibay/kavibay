//! Embedded MCP transport and lifecycle boundary.
//!
//! Product tools remain adapters over host services; this module owns only the
//! loopback transport, its lifecycle and the backend-owned global setting.

pub mod presence;
pub mod server;
pub mod settings;
pub mod tools;

#[allow(dead_code)]
pub const SERVER_NAME: &str = "kavibay-authoring";
#[allow(dead_code)]
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Keep the workflow and capability boundary in the initialization response.
#[allow(dead_code)]
pub const INSTRUCTIONS: &str = "Read the authoring guide before writing. write_draft takes complete file sets only; omitted files are removed. Read a draft once and pass the revision your copy is from as expectedRevision. Change or add files of an existing draft with edit_draft (exact text replacements; an empty oldString creates a file); write_draft is for creating a draft or replacing most of it. Revisions are checked per file: edit_draft and checkout_custom_widget return changedFiles, every file that differs from your revision with its current contents, so update your copy from it instead of reading the whole draft again. Validate after every write. Saving in the Wizard removes the draft: to edit a saved widget, check it out with the last revision you hold of it, or none if you have read nothing; if the checkout returns draft_exists, read that draft and continue from it rather than retrying. list_widget_providers names providers; get_authoring_guide with providerIds holds their schemas. Every draft carries lastWriter, lastClient, lastClientName and updatedAt, which say whether a person is editing the same draft in the Wizard right now; clientInfo names are advisory. MCP cannot save, enable, delete, grant access, call widget endpoints or access credentials; ask the person to review and Save in Kavibay's Widget Wizard.";

#[cfg(test)]
mod tests {
    use std::{future::Future, sync::Arc};

    use axum::{
        body::{to_bytes, Body},
        http::{header, Method, Request},
    };
    use rmcp::{
        handler::server::ServerHandler,
        model::{
            Implementation, ListToolsResult, PaginatedRequestParams, ServerCapabilities,
            ServerConfig, Tool, ToolAnnotations,
        },
        service::{RequestContext, RoleServer},
        transport::{
            streamable_http_server::{
                session::local::LocalSessionManager, StreamableHttpServerConfig,
            },
            StreamableHttpService,
        },
    };
    use serde_json::{json, Map};

    use super::{INSTRUCTIONS, SERVER_NAME, SERVER_VERSION};

    #[derive(Clone, Copy, Debug, Default)]
    struct PlaceholderServer;

    impl ServerHandler for PlaceholderServer {
        fn get_info(&self) -> ServerConfig {
            ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
                .with_server_info(Implementation::new(SERVER_NAME, SERVER_VERSION))
                .with_instructions(INSTRUCTIONS)
        }

        fn list_tools(
            &self,
            _request: Option<PaginatedRequestParams>,
            _context: RequestContext<RoleServer>,
        ) -> impl Future<Output = Result<ListToolsResult, rmcp::ErrorData>> + Send + '_ {
            let schema = Arc::new(Map::new());
            let tool = Tool::new(
                "placeholder_read_only",
                "M0 protocol placeholder; no product behavior is wired yet.",
                schema,
            )
            .with_annotations(ToolAnnotations::new().read_only(true));
            std::future::ready(Ok(ListToolsResult::with_all_items(vec![tool])))
        }
    }

    fn post_request(message: serde_json::Value) -> Request<Body> {
        Request::builder()
            .method(Method::POST)
            .uri("/mcp")
            .header(header::HOST, "127.0.0.1")
            .header(header::ACCEPT, "application/json, text/event-stream")
            .header(header::CONTENT_TYPE, "application/json")
            .header("MCP-Protocol-Version", "2025-03-26")
            .body(Body::from(message.to_string()))
            .expect("valid MCP test request")
    }

    async fn response_json(
        service: &StreamableHttpService<PlaceholderServer, LocalSessionManager>,
        message: serde_json::Value,
    ) -> serde_json::Value {
        let response = service.handle(post_request(message)).await;
        assert_eq!(response.status(), 200);
        let bytes = to_bytes(Body::new(response.into_body()), 64 * 1024)
            .await
            .expect("MCP response body is readable");
        serde_json::from_slice(&bytes).expect("MCP response is JSON")
    }

    #[test]
    fn streamable_http_initializes_and_lists_placeholder_tool() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime builds")
            .block_on(async {
                let service = StreamableHttpService::new(
                    || Ok(PlaceholderServer),
                    Arc::new(LocalSessionManager::default()),
                    StreamableHttpServerConfig::default()
                        .with_legacy_session_mode(false)
                        .with_json_response(true),
                );

                let initialize = response_json(
                    &service,
                    json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2025-03-26",
                            "capabilities": {},
                            "clientInfo": {"name": "m0-test", "version": "0.1.0"}
                        }
                    }),
                )
                .await;
                assert_eq!(initialize["result"]["serverInfo"]["name"], SERVER_NAME);
                assert_eq!(initialize["result"]["instructions"], INSTRUCTIONS);

                let tools = response_json(
                    &service,
                    json!({
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/list",
                        "params": {}
                    }),
                )
                .await;
                assert_eq!(tools["result"]["tools"].as_array().map(Vec::len), Some(1));
                assert_eq!(tools["result"]["tools"][0]["name"], "placeholder_read_only");
                assert_eq!(
                    tools["result"]["tools"][0]["annotations"]["readOnlyHint"],
                    true
                );
            });
    }
}
