//! The reviewed, draft-only MCP authoring surface.
//!
//! This module deliberately uses typed Serde DTOs at the boundary and calls
//! the existing host services underneath. It never accepts paths, credentials,
//! grants or arbitrary Tauri commands from an MCP client.

// The Windows test runner on this host cannot load the desktop-only Wry
// imports pulled in by the real AppHandle-backed dispatch. Test builds use
// the transport placeholder, while production builds compile the full tools.
#![cfg_attr(test, allow(dead_code))]

use std::{sync::Arc, time::Instant};

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, ErrorCode, ErrorData, Implementation,
        ListResourcesResult, ListToolsResult, PaginatedRequestParams, ReadResourceRequestParams,
        ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, ServerCapabilities,
        ServerConfig, Tool, ToolAnnotations,
    },
    service::{RequestContext, RoleServer},
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Map, Value};
#[cfg(not(test))]
use tauri::{AppHandle, Manager};

#[cfg(not(test))]
use super::presence;
use super::{INSTRUCTIONS, SERVER_NAME, SERVER_VERSION};
#[cfg(not(test))]
use crate::runtime_extensions::{self, PackageOrigin};
use crate::{
    runtime_extensions::{drafts, PackageFormat},
    wizard::prompt,
};

const RUNTIME_RESOURCE: &str = "kavibay://authoring/runtime-package";
const CONTRACT_RESOURCE: &str = "kavibay://authoring/contract-package";
const PROVIDER_RESOURCE: &str = "kavibay://authoring/provider-schema";

const TOOL_NAMES: [&str; 10] = [
    "get_authoring_guide",
    "list_widget_providers",
    "list_drafts",
    "read_draft",
    "write_draft",
    "edit_draft",
    "validate_draft",
    "list_custom_widgets",
    "read_custom_widget",
    "checkout_custom_widget",
];

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthoringFormat {
    Runtime,
    Contract,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetAuthoringGuideInput {
    format: AuthoringFormat,
    #[serde(default)]
    provider_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdInput {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CheckoutCustomWidgetInput {
    id: String,
    expected_revision: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpDraftFile {
    path: String,
    contents: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpDraftEdit {
    path: String,
    old_string: String,
    new_string: String,
    #[serde(default)]
    replace_all: bool,
}

impl From<McpDraftEdit> for drafts::DraftEdit {
    fn from(edit: McpDraftEdit) -> Self {
        Self {
            path: edit.path,
            old_string: edit.old_string,
            new_string: edit.new_string,
            replace_all: edit.replace_all,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditDraftInput {
    id: String,
    expected_revision: String,
    edits: Vec<McpDraftEdit>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WriteDraftInput {
    id: String,
    expected_revision: Option<String>,
    files: Vec<McpDraftFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthoringGuideOutput {
    format: AuthoringFormat,
    provider_ids: Vec<String>,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetProvidersOutput {
    providers: Vec<prompt::ProviderSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DraftsOutput {
    drafts: Vec<drafts::DraftSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomWidgetOutput {
    id: String,
    name: String,
    format: PackageFormat,
    status: String,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomWidgetsOutput {
    widgets: Vec<CustomWidgetOutput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomWidgetSnapshotOutput {
    id: String,
    files: Vec<drafts::DraftFile>,
    revision: String,
}

/// One server handler per MCP session. The app handle is the only capability
/// this adapter receives; all filesystem access remains in the host services.
#[derive(Clone)]
pub struct McpAuthoringServer {
    #[cfg(not(test))]
    app: Option<AppHandle>,
}

impl McpAuthoringServer {
    #[cfg(not(test))]
    pub fn new(app: AppHandle) -> Self {
        Self { app: Some(app) }
    }

    #[cfg(test)]
    pub fn placeholder() -> Self {
        Self {}
    }

    #[cfg(not(test))]
    pub fn placeholder() -> Self {
        Self { app: None }
    }

    #[cfg(not(test))]
    pub fn new_optional(app: Option<AppHandle>) -> Self {
        app.map(Self::new).unwrap_or_else(Self::placeholder)
    }

    #[cfg(not(test))]
    fn app(&self) -> Result<&AppHandle, CallToolResult> {
        self.app.as_ref().ok_or_else(|| {
            tool_error(
                "server_unavailable",
                "Authoring services are unavailable in this server instance.",
                None,
            )
        })
    }
}

impl ServerHandler for McpAuthoringServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_resources()
                .enable_tools()
                .build(),
        )
        .with_server_info(Implementation::new(SERVER_NAME, SERVER_VERSION))
        .with_instructions(INSTRUCTIONS)
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListResourcesResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListResourcesResult::with_all_items(vec![
            Resource::new(RUNTIME_RESOURCE, "runtime-package")
                .with_title("Runtime package authoring guide")
                .with_description("Rules for Kavibay runtime packages")
                .with_mime_type("text/markdown"),
            Resource::new(CONTRACT_RESOURCE, "contract-package")
                .with_title("Contract package authoring guide")
                .with_description("Rules for Kavibay provider-backed packages")
                .with_mime_type("text/markdown"),
            Resource::new(PROVIDER_RESOURCE, "provider-schema")
                .with_title("Widget provider schemas")
                .with_description("Read-only provider query schemas")
                .with_mime_type("application/json"),
        ])))
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ReadResourceResponse, ErrorData>> + Send + '_
    {
        let result = resource_source(&request.uri).map(|(contents, mime_type)| {
            ReadResourceResult::new(vec![
                ResourceContents::text(contents, request.uri.clone()).with_mime_type(mime_type)
            ])
            .into()
        });
        std::future::ready(result)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult::with_all_items({
            #[cfg(test)]
            {
                vec![placeholder_tool()]
            }
            #[cfg(not(test))]
            {
                if self.app.is_some() {
                    tool_definitions()
                } else {
                    vec![placeholder_tool()]
                }
            }
        })))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        #[cfg(test)]
        {
            (name == "placeholder_read_only").then(placeholder_tool)
        }
        #[cfg(not(test))]
        {
            if self.app.is_none() {
                return (name == "placeholder_read_only").then(placeholder_tool);
            }
            tool_definitions()
                .into_iter()
                .find(|tool| tool.name == name)
        }
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<rmcp::model::CallToolResponse, ErrorData>> + Send + '_
    {
        let name = request.name.to_string();
        let draft_id = request
            .arguments
            .as_ref()
            .and_then(|arguments| arguments.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let client_name = context
            .client_info()
            .and_then(|info| drafts::sanitize_client_name(&info.name));
        let client = client_name
            .as_deref()
            .and_then(drafts::McpClientKind::from_name);
        let started = Instant::now();
        #[cfg(test)]
        let result: Result<CallToolResult, ErrorData> = Err(ErrorData::new(
            ErrorCode::METHOD_NOT_FOUND,
            "Authoring tool dispatch is unavailable in the protocol-only test build.",
            None,
        ));
        #[cfg(not(test))]
        let result = if name == "placeholder_read_only" && self.app.is_none() {
            Ok(CallToolResult::structured(json!({
                "ok": true,
                "message": "MCP transport is alive; product tools are enabled when Kavibay is running."
            })))
        } else if !TOOL_NAMES.contains(&name.as_str()) {
            Err(ErrorData::new(
                ErrorCode::METHOD_NOT_FOUND,
                "Unknown MCP tool.",
                Some(json!({ "code": "tool_not_found", "tool": name })),
            ))
        } else {
            match self.app() {
                Ok(app) => {
                    let _presence = draft_id
                        .as_deref()
                        .filter(|_| tracks_draft_presence(&name))
                        .map(|id| {
                            let state = app.state::<presence::McpPresenceState>();
                            presence::begin(
                                app,
                                state.inner(),
                                id,
                                &name,
                                client,
                                client_name.as_deref(),
                            )
                        });
                    dispatch_tool(
                        app,
                        &name,
                        request.arguments,
                        client,
                        client_name.as_deref(),
                    )
                }
                Err(error) => Ok(error),
            }
        };
        let outcome = result
            .as_ref()
            .map(|value| {
                if value.is_error == Some(true) {
                    value
                        .structured_content
                        .as_ref()
                        .and_then(|content| content.get("code"))
                        .and_then(Value::as_str)
                        .unwrap_or("error")
                } else {
                    "ok"
                }
            })
            .unwrap_or("protocol_error");
        eprintln!(
            "[mcp] client={} client_name={:?} tool={name} draft_id={} duration_ms={} outcome={outcome}",
            client.map_or("mcp", drafts::McpClientKind::label),
            client_name.as_deref().unwrap_or("-"),
            draft_id.as_deref().unwrap_or("-"),
            started.elapsed().as_millis()
        );
        std::future::ready(result.map(Into::into))
    }
}

#[cfg(not(test))]
fn tracks_draft_presence(name: &str) -> bool {
    matches!(
        name,
        "read_draft"
            | "write_draft"
            | "validate_draft"
            | "read_custom_widget"
            | "checkout_custom_widget"
    )
}

fn resource_source(uri: &str) -> Result<(String, &'static str), ErrorData> {
    match uri {
        RUNTIME_RESOURCE => Ok((prompt::system_prompt(), "text/markdown")),
        CONTRACT_RESOURCE => Ok((prompt::contract_system_prompt(&[]), "text/markdown")),
        PROVIDER_RESOURCE => Ok((prompt::provider_schema_document(), "application/json")),
        uri => Err(ErrorData::resource_not_found(
            "Unknown authoring resource.",
            Some(json!({ "code": "resource_not_found", "uri": uri })),
        )),
    }
}

#[cfg(not(test))]
fn dispatch_tool(
    app: &AppHandle,
    name: &str,
    arguments: Option<Map<String, Value>>,
    client: Option<drafts::McpClientKind>,
    client_name: Option<&str>,
) -> Result<CallToolResult, ErrorData> {
    match name {
        "get_authoring_guide" => parse_input(arguments).and_then(get_authoring_guide),
        "list_widget_providers" => {
            parse_input(arguments).map(|_: EmptyInput| success(widget_providers()))
        }
        "list_drafts" => parse_input(arguments).and_then(|_: EmptyInput| {
            service_call(drafts::list_drafts(app).map(|drafts| DraftsOutput { drafts }))
        }),
        "read_draft" => parse_input(arguments)
            .and_then(|input: IdInput| service_call(drafts::read_draft(app, &input.id))),
        "write_draft" => parse_input(arguments).and_then(|input: WriteDraftInput| {
            let files = input
                .files
                .into_iter()
                .map(|file| drafts::DraftFile {
                    path: file.path,
                    contents: file.contents,
                })
                .collect::<Vec<_>>();
            service_call(drafts::write_draft_with_client(
                app,
                &input.id,
                &files,
                create_sentinel_as_none(input.expected_revision.as_deref()),
                drafts::DraftWriteOrigin::Mcp,
                client,
                client_name,
            ))
        }),
        "edit_draft" => parse_input(arguments).map(|input: EditDraftInput| {
            // The revision check is per file and lives with the write, in
            // `drafts::edit_draft_with_client`: an oldString must not be
            // applied to a file that changed under it.
            let edits: Vec<drafts::DraftEdit> = input.edits.into_iter().map(Into::into).collect();
            edit_reply(drafts::edit_draft_with_client(
                app,
                &input.id,
                &input.expected_revision,
                &edits,
                drafts::DraftWriteOrigin::Mcp,
                client,
                client_name,
            ))
        }),
        "validate_draft" => parse_input(arguments)
            .and_then(|input: IdInput| service_call(drafts::validate_draft(app, &input.id))),
        "list_custom_widgets" => parse_input(arguments).and_then(|_: EmptyInput| {
            service_call(runtime_extensions::scan_all(app).map(|rows| {
                let widgets = rows
                    .into_iter()
                    .filter(|row| {
                        row.origin == PackageOrigin::Custom && drafts::is_valid_package_id(&row.id)
                    })
                    .map(|row| CustomWidgetOutput {
                        id: row.id,
                        name: row.name,
                        format: row.format,
                        status: row.status,
                        error: row.error,
                    })
                    .collect();
                CustomWidgetsOutput { widgets }
            }))
        }),
        "read_custom_widget" => parse_input(arguments).and_then(|input: IdInput| {
            service_call(
                drafts::read_custom_package_with_revision(app, &input.id).map(
                    |(files, revision)| CustomWidgetSnapshotOutput {
                        id: input.id,
                        files,
                        revision,
                    },
                ),
            )
        }),
        "checkout_custom_widget" => {
            parse_input(arguments).and_then(|input: CheckoutCustomWidgetInput| {
                service_call(drafts::checkout_custom_widget_since(
                    app,
                    &input.id,
                    create_sentinel_as_none(input.expected_revision.as_deref()),
                    drafts::DraftWriteOrigin::Mcp,
                    client,
                    client_name,
                ))
            })
        }
        _ => Err(ErrorData::new(
            ErrorCode::METHOD_NOT_FOUND,
            "Unknown MCP tool.",
            Some(json!({ "code": "tool_not_found" })),
        )),
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyInput {}

fn parse_input<T: DeserializeOwned>(arguments: Option<Map<String, Value>>) -> Result<T, ErrorData> {
    let value = Value::Object(arguments.unwrap_or_default());
    serde_json::from_value(value).map_err(|error| {
        ErrorData::invalid_params(
            "Tool arguments do not match the reviewed schema.",
            Some(json!({ "code": "invalid_arguments", "detail": error.to_string() })),
        )
    })
}

fn get_authoring_guide(input: GetAuthoringGuideInput) -> Result<CallToolResult, ErrorData> {
    for provider in &input.provider_ids {
        if prompt::provider_block(Some(provider)).is_none() {
            return Ok(tool_error(
                "unknown_provider",
                "The requested provider is not available in this Kavibay build.",
                Some(json!({ "providerId": provider })),
            ));
        }
    }
    if input.format == AuthoringFormat::Runtime && !input.provider_ids.is_empty() {
        return Ok(tool_error(
            "providers_require_contract_format",
            "Provider ids are supported only for the contract authoring guide.",
            None,
        ));
    }
    let content = match input.format {
        AuthoringFormat::Runtime => prompt::system_prompt(),
        AuthoringFormat::Contract => prompt::contract_system_prompt(&input.provider_ids),
    };
    Ok(success(AuthoringGuideOutput {
        format: input.format,
        provider_ids: input.provider_ids,
        content,
    }))
}

/// Names only; `get_authoring_guide` with `providerIds` holds the schemas.
fn widget_providers() -> WidgetProvidersOutput {
    WidgetProvidersOutput {
        providers: prompt::provider_summaries(),
    }
}

fn edit_reply(result: Result<drafts::DraftDelta, drafts::EditError>) -> CallToolResult {
    match result {
        Ok(delta) => success(delta),
        Err(drafts::EditError::Conflict {
            current_revision,
            changed_files,
        }) => tool_error(
            "draft_conflict",
            "A file these edits touch changed since expectedRevision. changedFiles holds every file that differs from it, as it is now: redo the edits against currentRevision without reading the draft again.",
            Some(json!({
                "currentRevision": current_revision,
                "changedFiles": changed_files,
            })),
        ),
        Err(drafts::EditError::Failed(error)) => tool_service_error(error),
    }
}

fn success<T: Serialize>(value: T) -> CallToolResult {
    CallToolResult::structured(serde_json::to_value(value).unwrap_or_else(|_| json!({})))
}

fn service_call<T: Serialize>(result: Result<T, String>) -> Result<CallToolResult, ErrorData> {
    Ok(match result {
        Ok(value) => success(value),
        Err(error) => tool_service_error(error),
    })
}

fn tool_error(code: &str, message: &str, extra: Option<Value>) -> CallToolResult {
    let mut value = Map::new();
    value.insert("code".into(), Value::String(code.into()));
    value.insert("message".into(), Value::String(message.into()));
    if let Some(Value::Object(extra)) = extra {
        value.extend(extra);
    }
    CallToolResult::structured_error(Value::Object(value))
}

fn tool_service_error(error: String) -> CallToolResult {
    let (code, detail) = error
        .split_once(':')
        .map_or((error.as_str(), None), |(code, detail)| {
            (code, Some(detail))
        });
    let message = match code {
        "draft_conflict" => "The draft changed; read the latest revision before writing again.",
        "draft_not_found" => {
            "No draft has this id. Saving a draft in the Wizard removes it: checkout_custom_widget with the last revision you hold continues from the saved widget."
        }
        "package_not_found" => "The requested package or draft does not exist.",
        "invalid_package_id" => {
            "Use a simple package id containing only letters, digits, '-' or '_'."
        }
        "unsafe_path" | "path_absolute" | "path_traversal" => {
            "Files must use package-relative safe paths."
        }
        "not_text" => "MCP can read and write text files only.",
        "draft_exists" => {
            "Another draft already uses that name. Rename it or pick a different one."
        }
        "custom_conflict" => "The saved widget changed while it was being checked out; check it out again.",
        "edit_file_not_found" => {
            "No file at that path in the draft. To create one, pass an empty oldString and the contents as newString."
        }
        "edit_file_exists" => {
            "An empty oldString creates a file, and that path already exists. Copy the text to replace instead."
        }
        "edit_not_found" => {
            "oldString does not occur in that file. Read the draft and copy the exact text, whitespace included."
        }
        "edit_ambiguous" => {
            "oldString occurs more than once. Include more surrounding text, or set replaceAll."
        }
        "edit_empty" => "At least one edit is required.",
        "missing_manifest" | "no_files" => {
            "A complete draft must include manifest.json and at least one file."
        }
        _ => "The host rejected this authoring operation.",
    };
    let extra = match code {
        "draft_conflict" => detail.map(|current| json!({ "currentRevision": current })),
        "custom_conflict" => detail.map(|current| json!({ "currentWidgetRevision": current })),
        "draft_exists" => detail.map(|current| json!({ "currentDraftRevision": current })),
        "edit_file_not_found" | "edit_file_exists" | "edit_not_found" | "edit_ambiguous" => {
            detail.map(|path| json!({ "path": path }))
        }
        _ => None,
    };
    tool_error(code, message, extra)
}

fn placeholder_tool() -> Tool {
    Tool::new(
        "placeholder_read_only",
        "M0/M2 transport placeholder; product tools are enabled by the running app.",
        Arc::new(Map::new()),
    )
    .with_annotations(ToolAnnotations::new().read_only(true))
}

/// "Create this draft", however a client managed to say it.
///
/// Models reach for `null` even when the field is optional, and some clients
/// turn that into the text "null"; the model then tries "missing", the value
/// the conflict error just reported for a draft that does not exist. A real
/// revision is a SHA-256 hex digest, so none of these can be one — reading
/// them as "no draft expected" is the only meaning they can have.
fn create_sentinel_as_none(expected: Option<&str>) -> Option<&str> {
    expected.filter(|value| !matches!(value.trim(), "" | "null" | "missing"))
}

fn object_schema(properties: Value, required: &[&str]) -> Arc<Map<String, Value>> {
    Arc::new(
        json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        })
        .as_object()
        .expect("tool schema is an object")
        .clone(),
    )
}

fn tool(
    name: &'static str,
    description: &'static str,
    schema: Arc<Map<String, Value>>,
    read_only: bool,
) -> Tool {
    Tool::new(name, description, schema).with_annotations(
        ToolAnnotations::new()
            .read_only(read_only)
            .destructive(false)
            .open_world(false),
    )
}

fn tool_definitions() -> Vec<Tool> {
    let no_args = object_schema(json!({}), &[]);
    vec![
        tool(
            "get_authoring_guide",
            "Read the authoring guide Kavibay's own Widget Wizard gives its model: the package format, the house style and, for contract packages, the schema of each provider named in providerIds — the one place a provider's arguments and returned fields are listed. A package written from it passes the same validation as one the Wizard writes. Read it once per format before writing or editing a draft. A runtime package runs sandboxed and reaches the network only through endpoints it declares in api.json; a contract package reads the person's connected accounts through providers.",
            object_schema(
                json!({
                    "format": {
                        "type": "string",
                        "enum": ["runtime", "contract"],
                        "description": "Which package format the guide describes."
                    },
                    "providerIds": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Contract format only: provider ids from list_widget_providers whose full schemas (arguments and returned fields of every query and action) are appended. Any id with the runtime format returns providers_require_contract_format; an unknown id returns unknown_provider."
                    }
                }),
                &["format"],
            ),
            true,
        ),
        tool(
            "list_widget_providers",
            "List every provider a contract package can name in requires.providers: id, displayName, a one-line description and the names of its queries and actions. Their arguments and returned fields are not listed here; get_authoring_guide with format contract and providerIds appends them for the providers you pick. Write each provider as an entry { id, queries, actions }: every action the widget calls must be in actions or the host refuses it, and every query it reads belongs in queries, which is what the person is shown when approving it. It says nothing about which accounts the person has connected; the host asks for those when the widget is enabled.",
            no_args.clone(),
            true,
        ),
        tool(
            "list_drafts",
            "List the drafts in Kavibay's custom authoring workspace: id, file paths, revision, validation error, and who wrote each last (lastWriter, lastClient, lastClientName, updatedAt), which says whether the person is editing one in the Widget Wizard right now. Saved widgets are not drafts; list_custom_widgets lists those.",
            no_args.clone(),
            true,
        ),
        tool(
            "read_draft",
            "Read every text file of one draft and its current revision. Pass that revision as expectedRevision on the next write_draft or edit_draft. One read per draft is usually enough: edit_draft and checkout_custom_widget hand back every file that changed under you. A draft_not_found error means no draft has this id; saving a draft in the Wizard removes it, and checkout_custom_widget continues from the saved widget.",
            object_schema(
                json!({ "id": { "type": "string", "description": "Draft id as list_drafts reports it." } }),
                &["id"],
            ),
            true,
        ),
        tool(
            "write_draft",
            "Write a complete text file set to a draft using optimistic revision checking; omitted files are removed. The manifest names the package: writing a different name (`name` for a contract package, `id` for a runtime one) renames the draft, and the reply's `id` and `renamedFrom` say where it moved. A package holds at most 32 files, 512 KB per file and 2 MB in total, and must include manifest.json. The reply is the draft summary validate_draft returns, validation error included.",
            object_schema(
                json!({
                    "id": {
                        "type": "string",
                        "description": "Draft id: letters, digits, '-' and '_', starting with a letter or digit, at most 64 characters."
                    },
                    // Optional rather than a required `["string", "null"]`: some
                    // clients drop a union type and then send null as the text
                    // "null", which reads as a revision and made creation fail
                    // with draft_conflict:missing. Leaving the field out cannot
                    // be mangled. JSON null still means the same thing.
                    "expectedRevision": {
                        "type": "string",
                        "description": "Leave this out to create a new draft; that fails with draft_conflict if one exists. To update, pass the revision read_draft or the last write returned. A stale revision fails with draft_conflict and the current one."
                    },
                    "files": {
                        "type": "array",
                        "description": "The complete file set. Files not listed here are removed from the draft.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": {
                                    "type": "string",
                                    "description": "Package-relative path with forward slashes, e.g. ui/index.html; absolute paths and '..' are refused."
                                },
                                "contents": { "type": "string", "description": "Full file contents as text." }
                            },
                            "required": ["path", "contents"],
                            "additionalProperties": false
                        }
                    }
                }),
                &["id", "files"],
            ),
            false,
        ),
        tool(
            "edit_draft",
            "Change an existing draft by exact text replacement instead of rewriting it: use this for every change that touches part of a file or adds a file, and write_draft only to create a draft or rewrite most of it. Each oldString must occur exactly once in its file (set replaceAll to change every occurrence); copy it from what you read, whitespace included. An empty oldString creates a file at a path that does not exist yet, with newString as its contents. All edits apply or none do, then the draft is validated. The revision check is per file: only a change since expectedRevision to a file these edits touch fails, with draft_conflict, currentRevision and changedFiles. Files changed elsewhere, such as the manifest.json a resize in the Wizard rewrites, do not block the edit. Either way changedFiles holds every file that differs from expectedRevision with its current contents (null when removed): update your copy from it instead of reading the draft again. The reply is the draft summary write_draft returns plus changedFiles.",
            object_schema(
                json!({
                    "id": { "type": "string", "description": "Draft id as list_drafts reports it." },
                    "expectedRevision": {
                        "type": "string",
                        "description": "The revision your copy of the draft is from: what read_draft, checkout_custom_widget or your last write returned."
                    },
                    "edits": {
                        "type": "array",
                        "description": "Applied in order; a later edit sees the result of an earlier one.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "path": { "type": "string", "description": "Package-relative path of the file to change, or of a new file to create, with forward slashes." },
                                "oldString": { "type": "string", "description": "Exact text to find, unique in the file unless replaceAll is set. Empty creates the file, which must not exist yet." },
                                "newString": { "type": "string", "description": "Replacement text, or the new file's contents; empty deletes oldString." },
                                "replaceAll": { "type": "boolean", "description": "Replace every occurrence. Defaults to false." }
                            },
                            "required": ["path", "oldString", "newString"],
                            "additionalProperties": false
                        }
                    }
                }),
                &["id", "expectedRevision", "edits"],
            ),
            false,
        ),
        tool(
            "validate_draft",
            "Validate a draft as it is on disk now and return its summary: the error field holds a stable error code, or null when the package is valid. write_draft already returns this for what it wrote; call this when the draft may have changed since, for example after the person edited it in the Wizard. A draft that fails validation cannot be saved.",
            object_schema(
                json!({ "id": { "type": "string", "description": "Draft id as list_drafts reports it." } }),
                &["id"],
            ),
            true,
        ),
        tool(
            "list_custom_widgets",
            "List the saved widgets in the custom root (written with the Wizard or through MCP): id, name, format, status and validation error. Installed third-party packages are not listed and cannot be read through MCP.",
            no_args.clone(),
            true,
        ),
        tool(
            "read_custom_widget",
            "Read a saved custom widget's text files and its content revision. Reading creates no draft; to change the widget, check it out instead, which returns the files as well.",
            object_schema(
                json!({ "id": { "type": "string", "description": "Widget id as list_custom_widgets reports it." } }),
                &["id"],
            ),
            true,
        ),
        tool(
            "checkout_custom_widget",
            "Copy a saved custom widget into a new draft for editing; never replaces an existing draft. The reply is the draft summary plus changedFiles: every file that differs from expectedRevision, with its contents, so afterwards you know the draft exactly and can edit_draft against its revision. draft_exists means a draft already holds the widget: read that draft and continue it instead of retrying.",
            object_schema(
                json!({
                    "id": { "type": "string", "description": "Widget id as list_custom_widgets reports it." },
                    // Optional because the reply carries whatever the caller
                    // has not seen: leaving it out costs one copy of every
                    // file, never an edit against text nobody read.
                    "expectedRevision": {
                        "type": "string",
                        "description": "The last revision you hold of this widget: from read_custom_widget, or of its draft before the person saved it. Leave it out if you have read neither; changedFiles then holds every file."
                    }
                }),
                &["id"],
            ),
            false,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tool_list_is_the_reviewed_allowlist() {
        let names: Vec<_> = tool_definitions()
            .into_iter()
            .map(|tool| tool.name.into_owned())
            .collect();
        assert_eq!(names, TOOL_NAMES);
    }

    #[test]
    fn handler_advertises_identity_instructions_and_resources() {
        let info = McpAuthoringServer::placeholder().get_info();
        assert_eq!(info.server_info.name, SERVER_NAME);
        assert_eq!(info.server_info.version, SERVER_VERSION);
        assert_eq!(info.instructions.as_deref(), Some(INSTRUCTIONS));
        assert!(info.capabilities.resources.is_some());
        assert!(info.capabilities.tools.is_some());
    }

    #[test]
    fn resources_use_the_embedded_prompt_sources() {
        let (runtime, runtime_mime) = resource_source(RUNTIME_RESOURCE).unwrap();
        assert_eq!(runtime, prompt::system_prompt());
        assert_eq!(runtime_mime, "text/markdown");
        let (contract, contract_mime) = resource_source(CONTRACT_RESOURCE).unwrap();
        assert_eq!(contract, prompt::contract_system_prompt(&[]));
        assert_eq!(contract_mime, "text/markdown");
        let (providers, provider_mime) = resource_source(PROVIDER_RESOURCE).unwrap();
        assert_eq!(providers, prompt::provider_schema_document());
        assert_eq!(provider_mime, "application/json");
        assert_eq!(
            resource_source("kavibay://authoring/unknown")
                .unwrap_err()
                .data
                .unwrap()["code"],
            "resource_not_found"
        );
    }

    #[test]
    fn guide_rejects_unknown_provider_and_runtime_provider_selection() {
        let unknown = get_authoring_guide(GetAuthoringGuideInput {
            format: AuthoringFormat::Contract,
            provider_ids: vec!["invented/provider".into()],
        })
        .unwrap();
        assert_eq!(
            unknown.structured_content.unwrap()["code"],
            "unknown_provider"
        );

        let runtime = get_authoring_guide(GetAuthoringGuideInput {
            format: AuthoringFormat::Runtime,
            provider_ids: vec!["kavibay.tado/tado".into()],
        })
        .unwrap();
        assert_eq!(
            runtime.structured_content.unwrap()["code"],
            "providers_require_contract_format"
        );
    }

    #[test]
    fn schemas_reject_unknown_fields_and_expose_write_revision_contract() {
        let write = tool_definitions()
            .into_iter()
            .find(|tool| tool.name == "write_draft")
            .unwrap();
        assert_eq!(write.input_schema["additionalProperties"], false);
        // Creation must not depend on a client sending JSON null correctly.
        assert_eq!(write.input_schema["required"], json!(["id", "files"]));
        assert_eq!(
            parse_input::<WriteDraftInput>(Some(Map::from_iter([
                ("id".into(), json!("x")),
                ("files".into(), json!([])),
            ])))
            .unwrap()
            .expected_revision,
            None
        );
        assert_eq!(write.annotations.unwrap().read_only_hint, Some(false));

        let parsed = parse_input::<IdInput>(Some(Map::from_iter([
            ("id".into(), json!("x")),
            ("extra".into(), json!(true)),
        ])));
        assert_eq!(
            parsed.unwrap_err().data.unwrap()["code"],
            "invalid_arguments"
        );

        let checkout = tool_definitions()
            .into_iter()
            .find(|tool| tool.name == "checkout_custom_widget")
            .unwrap();
        assert_eq!(checkout.input_schema["additionalProperties"], false);
        // A caller that has read nothing checks out without a revision; the
        // reply then carries every file, so it never edits text it has not seen.
        assert_eq!(checkout.input_schema["required"], json!(["id"]));
        assert_eq!(
            parse_input::<CheckoutCustomWidgetInput>(Some(Map::from_iter([(
                "id".into(),
                json!("x")
            )])))
            .unwrap()
            .expected_revision,
            None
        );
        assert_eq!(checkout.annotations.unwrap().read_only_hint, Some(false));

        let edit = tool_definitions()
            .into_iter()
            .find(|tool| tool.name == "edit_draft")
            .unwrap();
        assert_eq!(
            edit.input_schema["required"],
            json!(["id", "expectedRevision", "edits"])
        );
    }

    /// The listing names providers; the schemas live in the authoring guide.
    ///
    /// Every query and action named here must be one the guide's block for the
    /// same provider documents, or a client would pick from a list that the
    /// schema it then fetches does not match.
    #[test]
    fn providers_are_listed_by_name_and_their_schemas_left_to_the_guide() {
        let listed = widget_providers();
        let ids: Vec<_> = listed
            .providers
            .iter()
            .map(|provider| provider.id.clone())
            .collect();
        assert_eq!(ids, prompt::provider_ids());
        for provider in &listed.providers {
            assert!(!provider.display_name.is_empty(), "{}", provider.id);
            assert!(!provider.description.is_empty(), "{}", provider.id);
            assert!(!provider.queries.is_empty(), "{}", provider.id);
            let block = prompt::provider_block(Some(&provider.id)).unwrap();
            for name in provider.queries.iter().chain(&provider.actions) {
                assert!(
                    block.contains(&format!("`{name}`")),
                    "{}: {name}",
                    provider.id
                );
            }
        }
        let reply = serde_json::to_string(&listed).unwrap();
        assert!(
            !reply.contains("returns:"),
            "no result schemas in the listing"
        );
        assert!(
            reply.len() * 4 < prompt::provider_schema_document().len(),
            "the listing is {} bytes",
            reply.len()
        );
    }

    #[test]
    fn an_edit_reply_carries_the_files_that_changed_under_the_caller() {
        let changed = vec![
            drafts::ChangedFile {
                path: "manifest.json".into(),
                contents: Some("{}".into()),
            },
            drafts::ChangedFile {
                path: "old.txt".into(),
                contents: None,
            },
        ];
        let conflict = edit_reply(Err(drafts::EditError::Conflict {
            current_revision: "abc123".into(),
            changed_files: changed.clone(),
        }));
        assert_eq!(conflict.is_error, Some(true));
        let body = conflict.structured_content.unwrap();
        assert_eq!(body["code"], "draft_conflict");
        assert_eq!(body["currentRevision"], "abc123");
        assert_eq!(
            body["changedFiles"],
            json!([
                { "path": "manifest.json", "contents": "{}" },
                { "path": "old.txt", "contents": null }
            ])
        );

        let summary = drafts::DraftSummary {
            id: "counter".into(),
            files: vec!["manifest.json".into()],
            revision: "def456".into(),
            error: None,
            renamed_from: None,
            last_writer: Some(drafts::DraftWriteOrigin::Mcp),
            last_client: None,
            last_client_name: None,
            updated_at: Some(1),
        };
        let ok = edit_reply(Ok(drafts::DraftDelta {
            summary,
            changed_files: changed,
        }));
        let body = ok.structured_content.unwrap();
        assert_eq!(body["id"], "counter", "the summary is flattened in");
        assert_eq!(body["revision"], "def456");
        assert_eq!(body["changedFiles"][0]["path"], "manifest.json");

        let failed = edit_reply(Err(drafts::EditError::Failed(
            "edit_file_exists:api.json".into(),
        )));
        let body = failed.structured_content.unwrap();
        assert_eq!(body["code"], "edit_file_exists");
        assert_eq!(body["path"], "api.json");
    }

    #[test]
    fn create_sentinels_mean_no_draft_expected() {
        for sentinel in ["", "null", "missing", " null "] {
            assert_eq!(
                create_sentinel_as_none(Some(sentinel)),
                None,
                "{sentinel:?}"
            );
        }
        assert_eq!(create_sentinel_as_none(None), None);
        assert_eq!(create_sentinel_as_none(Some("ab12cd")), Some("ab12cd"));
    }

    #[test]
    fn service_errors_keep_machine_codes_and_conflict_revision() {
        let conflict = tool_service_error("draft_conflict:abc123".into());
        assert_eq!(conflict.is_error, Some(true));
        assert_eq!(
            conflict.structured_content.as_ref().unwrap()["code"],
            "draft_conflict"
        );
        assert_eq!(
            conflict.structured_content.as_ref().unwrap()["currentRevision"],
            "abc123"
        );

        let unsafe_path = tool_service_error("path_traversal".into());
        assert_eq!(
            unsafe_path.structured_content.as_ref().unwrap()["code"],
            "path_traversal"
        );

        let custom_conflict = tool_service_error("custom_conflict:def456".into());
        assert_eq!(
            custom_conflict.structured_content.as_ref().unwrap()["currentWidgetRevision"],
            "def456"
        );
        let draft_exists = tool_service_error("draft_exists:ghi789".into());
        assert_eq!(
            draft_exists.structured_content.as_ref().unwrap()["currentDraftRevision"],
            "ghi789"
        );
    }
}
