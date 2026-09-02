//! Serde DTOs shared with the Focus Tracker frontend (snake_case field names).

use serde::{Deserialize, Serialize};

/// Summary window: current calendar day, ISO week (Mon–Sun), or calendar month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusRange {
    Day,
    Week,
    Month,
}

/// How summary rows are grouped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupBy {
    App,
    Title,
}

/// One aggregated focus row for charts/lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusSummaryRow {
    pub key: String,
    pub app_name: String,
    pub window_title: String,
    pub duration_ms: i64,
}

/// Habit rule evaluation result for an app in the current range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusHabitHit {
    pub app_name: String,
    pub duration_ms: i64,
    pub limit_minutes: i64,
}

/// Full summary payload returned by Tauri commands (includes selected range).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusSummary {
    pub range: FocusRange,
    pub group_by: GroupBy,
    pub rows: Vec<FocusSummaryRow>,
    pub habits: Vec<FocusHabitHit>,
    pub total_ms: i64,
}

/// Aggregate result from `db::summary` (range filled by the command layer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusSummaryPayload {
    pub group_by: GroupBy,
    pub rows: Vec<FocusSummaryRow>,
    pub habits: Vec<FocusHabitHit>,
    pub total_ms: i64,
}

/// Live tracker process status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusTrackerStatus {
    pub available: bool,
    pub tracking: bool,
    pub idle: bool,
}

/// Stored habit limit rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HabitRule {
    pub id: i64,
    pub app_name: String,
    pub limit_minutes: i64,
}

/// Field an ignore rule applies to. Values are exact, case-insensitive matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IgnoreRuleKind {
    App,
    Title,
}

/// A persisted exclusion used by both tracking and historical summaries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IgnoreRule {
    pub id: i64,
    pub kind: IgnoreRuleKind,
    pub value: String,
}
