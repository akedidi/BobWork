//! Renderer-independent, capability-based contracts for the Data Analytics Built-in.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AnalysisOperation {
    Inspect,
    Quality,
    Aggregate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatasetAnalysisRequest {
    /// Workspace boundary granted to this analysis. The source must be inside it.
    pub workspace_root: String,
    pub source_path: String,
    pub operation: AnalysisOperation,
    #[serde(default)]
    pub group_by: Vec<String>,
    #[serde(default)]
    pub measures: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatasetAnalysisResult {
    pub operation: AnalysisOperation,
    pub source_file: String,
    pub row_count: usize,
    pub columns: Vec<DatasetColumn>,
    pub missing_values: Vec<MissingValue>,
    pub duplicate_rows: usize,
    #[serde(default)]
    pub sample: Vec<serde_json::Value>,
    #[serde(default)]
    pub aggregates: Vec<serde_json::Value>,
    /// A semantic request for Visualize; never renderer JavaScript.
    #[serde(default)]
    pub visualization: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatasetColumn {
    pub name: String,
    pub inferred_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingValue {
    pub column: String,
    pub count: usize,
}
