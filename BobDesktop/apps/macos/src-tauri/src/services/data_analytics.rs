//! Controlled local executor for the Data Analytics Built-in.
//!
//! The agent supplies a typed operation, not arbitrary Python. The worker is
//! platform-owned, runs through Shared Python and is confined to one workspace.

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::data_analytics::{DatasetAnalysisRequest, DatasetAnalysisResult};
use crate::services::runtime_manager::{ControlledProcessRequest, RuntimeManager};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

const DATA_ANALYTICS_PLUGIN_ID: &str = "builtin-data-analytics";
const DATA_ANALYTICS_WORKER: &str = r#"
import base64, csv, json, os, sys
try:
    import pandas as pd
except ModuleNotFoundError:
    pd = None

payload = json.loads(base64.urlsafe_b64decode(sys.argv[1] + '=' * (-len(sys.argv[1]) % 4)))
source = payload['source']
operation = payload['operation']
extension = os.path.splitext(source)[1].lower()
if pd is None:
    if extension not in ('.csv', '.tsv', '.json', '.jsonl'):
        raise RuntimeError('This format requires the optional shared pandas/spreadsheet capability')
    if extension in ('.csv', '.tsv'):
        with open(source, newline='', encoding='utf-8-sig') as handle:
            rows = list(csv.DictReader(handle, delimiter='\t' if extension == '.tsv' else ','))
    elif extension == '.jsonl':
        with open(source, encoding='utf-8') as handle: rows = [json.loads(line) for line in handle if line.strip()]
    else:
        with open(source, encoding='utf-8') as handle:
            raw = json.load(handle); rows = raw if isinstance(raw, list) else [raw]
    columns = list(dict.fromkeys(key for row in rows for key in row.keys()))
    missing = [{'column': key, 'count': sum(1 for row in rows if row.get(key) in (None, ''))} for key in columns]
    result = {'operation': operation, 'sourceFile': os.path.basename(source), 'rowCount': len(rows),
      'columns': [{'name': key, 'inferredType': 'string'} for key in columns],
      'missingValues': [item for item in missing if item['count']],
      'duplicateRows': len(rows) - len({json.dumps(row, sort_keys=True) for row in rows}),
      'sample': rows[:20], 'aggregates': [], 'visualization': None}
    if operation == 'aggregate': raise RuntimeError('Aggregation requires the optional shared pandas/dataframe capability')
    print(json.dumps(result, separators=(',', ':'))); sys.exit(0)
if extension == '.csv': frame = pd.read_csv(source)
elif extension == '.tsv': frame = pd.read_csv(source, sep='\t')
elif extension in ('.json', '.jsonl'):
    frame = pd.read_json(source, lines=(extension == '.jsonl'))
elif extension in ('.xlsx', '.xls'):
    frame = pd.read_excel(source)
else: raise ValueError('Unsupported data format')

def value(v):
    if pd.isna(v): return None
    if hasattr(v, 'isoformat'): return v.isoformat()
    return v.item() if hasattr(v, 'item') else v

columns = [{'name': str(name), 'inferredType': str(dtype)} for name, dtype in frame.dtypes.items()]
missing = [{'column': str(name), 'count': int(count)} for name, count in frame.isna().sum().items() if int(count)]
result = {
  'operation': operation, 'sourceFile': os.path.basename(source), 'rowCount': int(len(frame)),
  'columns': columns, 'missingValues': missing, 'duplicateRows': int(frame.duplicated().sum()),
  'sample': [{str(k): value(v) for k, v in row.items()} for row in frame.head(20).to_dict(orient='records')],
  'aggregates': [], 'visualization': None,
}
if operation == 'aggregate':
    groups = payload.get('groupBy', [])
    measures = payload.get('measures', [])
    for name in groups + measures:
        if name not in frame.columns: raise ValueError('Unknown column: ' + name)
    if not groups or not measures: raise ValueError('Aggregate requires groupBy and measures')
    numeric = frame[measures].apply(pd.to_numeric, errors='coerce')
    grouped = pd.concat([frame[groups], numeric], axis=1).groupby(groups, dropna=False)[measures].sum().reset_index()
    result['aggregates'] = [{str(k): value(v) for k, v in row.items()} for row in grouped.to_dict(orient='records')]
    result['visualization'] = {
      'schemaVersion': 1, 'kind': 'business_chart', 'title': 'Data aggregation',
      'dimensions': groups, 'series': measures, 'interactive': True,
      'responsive': {
        'conversation': {'layout': 'summary', 'maxKpis': 4, 'secondaryViews': 'tabs', 'pageScroll': False},
        'desktop': {}, 'tablet': {}, 'mobile': {'legend': 'collapsible'}
      },
      'rendererPreference': 'echarts'
    }
print(json.dumps(result, separators=(',', ':')))
"#;

pub struct DataAnalyticsService;

impl DataAnalyticsService {
    pub async fn execute(
        &self,
        db: &Database,
        manager: &RuntimeManager,
        manifest: &Value,
        request: DatasetAnalysisRequest,
    ) -> AppResult<DatasetAnalysisResult> {
        let root = canonical_directory(&request.workspace_root)?;
        let source = canonical_source(&root, &request.source_path)?;
        validate_format(&source)?;
        let handle =
            manager.resolve_capability(db, DATA_ANALYTICS_PLUGIN_ID, manifest, "python")?;
        let executable = handle
            .executable
            .map(PathBuf::from)
            .ok_or_else(|| AppError::NotFound("Shared Python Runtime is unavailable".into()))?;
        let payload = serde_json::json!({
            "source": source,
            "operation": request.operation,
            "groupBy": request.group_by,
            "measures": request.measures,
        });
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload)?);
        let output = manager
            .execute_controlled(
                manifest,
                ControlledProcessRequest {
                    plugin_id: DATA_ANALYTICS_PLUGIN_ID.into(),
                    runtime_id: handle.runtime_id,
                    executable,
                    args: vec!["-c".into(), DATA_ANALYTICS_WORKER.into(), encoded],
                    working_directory: root,
                    environment: handle.environment,
                    timeout: Duration::from_secs(90),
                },
            )
            .await?;
        if output.timed_out || output.cancelled || output.exit_code != Some(0) {
            return Err(AppError::Io(format!(
                "Data analysis failed: {}",
                output.stderr.trim()
            )));
        }
        serde_json::from_str(output.stdout.trim()).map_err(|error| {
            AppError::ValidationFailed(format!(
                "Data Analytics returned invalid structured output: {error}"
            ))
        })
    }
}

fn canonical_directory(value: &str) -> AppResult<PathBuf> {
    let path = std::fs::canonicalize(value)?;
    if !path.is_dir() {
        return Err(AppError::ValidationFailed(
            "Analysis workspace must be a directory".into(),
        ));
    }
    Ok(path)
}

fn canonical_source(root: &Path, value: &str) -> AppResult<PathBuf> {
    let source = std::fs::canonicalize(value)?;
    if !source.is_file() || !source.starts_with(root) {
        return Err(AppError::PermissionDenied(
            "Data source must be a file inside the authorized workspace".into(),
        ));
    }
    Ok(source)
}

fn validate_format(path: &Path) -> AppResult<()> {
    let extension = path
        .extension()
        .and_then(|item| item.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "csv" | "tsv" | "xlsx" | "xls" | "json" | "jsonl"
    ) {
        return Err(AppError::ValidationFailed(
            "Supported formats: CSV, TSV, XLSX, XLS, JSON and JSONL".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::data_analytics::AnalysisOperation;
    use crate::models::rendering::{route_visualization, VisualizationRenderer, VisualizationSpec};
    #[test]
    fn source_cannot_escape_workspace() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        assert!(canonical_source(root.path(), outside.path().to_str().unwrap()).is_err());
    }
    #[test]
    fn supported_formats_are_explicit() {
        assert!(validate_format(Path::new("sales.csv")).is_ok());
        assert!(validate_format(Path::new("sales.parquet")).is_err());
    }

    #[tokio::test]
    async fn shared_python_profiles_csv_without_a_private_runtime() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("sales.csv");
        std::fs::write(&source, "region,revenue\nFrance,10\nFrance,15\nSpain,8\n").unwrap();
        let db = Database::new_in_memory().unwrap();
        db.run_migrations().unwrap();
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        manager.seed_registry(&db).unwrap();
        let manifest = serde_json::json!({
            "sharedCapabilities":["python","dataframe","spreadsheet","statistics","visualization","artifact"],
            "permissions":[{"type":"command.execute"}]
        });
        let result = DataAnalyticsService
            .execute(
                &db,
                &manager,
                &manifest,
                DatasetAnalysisRequest {
                    workspace_root: root.path().to_string_lossy().into_owned(),
                    source_path: source.to_string_lossy().into_owned(),
                    operation: AnalysisOperation::Aggregate,
                    group_by: vec!["region".into()],
                    measures: vec!["revenue".into()],
                },
            )
            .await
            .unwrap();
        assert_eq!(result.row_count, 3);
        assert_eq!(result.columns.len(), 2);
        assert_eq!(result.aggregates.len(), 2);
        assert_eq!(
            result
                .visualization
                .as_ref()
                .and_then(|value| value.get("rendererPreference"))
                .and_then(|value| value.as_str()),
            Some("echarts")
        );
        assert_eq!(
            manager
                .get(&db, "shared.python")
                .unwrap()
                .unwrap()
                .runtime_type
                .as_str(),
            "shared"
        );
    }

    #[tokio::test]
    async fn aggregate_visual_spec_routes_through_visualize_to_shared_echarts() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("sales.csv");
        std::fs::write(&source, "month,revenue\n2026-01,120\n2026-02,180\n").unwrap();
        let db = Database::new_in_memory().unwrap();
        db.run_migrations().unwrap();
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        manager.seed_registry(&db).unwrap();
        let manifest = serde_json::json!({
            "sharedCapabilities":["python","dataframe","spreadsheet","statistics","visualization","artifact"],
            "permissions":[{"type":"command.execute"}]
        });
        let result = DataAnalyticsService
            .execute(
                &db,
                &manager,
                &manifest,
                DatasetAnalysisRequest {
                    workspace_root: root.path().to_string_lossy().into_owned(),
                    source_path: source.to_string_lossy().into_owned(),
                    operation: AnalysisOperation::Aggregate,
                    group_by: vec!["month".into()],
                    measures: vec!["revenue".into()],
                },
            )
            .await
            .unwrap();
        let spec: VisualizationSpec =
            serde_json::from_value(result.visualization.unwrap()).unwrap();
        assert_eq!(
            route_visualization(&spec).unwrap(),
            VisualizationRenderer::Echarts
        );
        assert!(spec.interactive);
        assert_eq!(
            spec.responsive
                .conversation
                .get("pageScroll")
                .and_then(|value| value.as_bool()),
            Some(false)
        );
        assert_eq!(
            spec.responsive
                .mobile
                .get("legend")
                .and_then(|value| value.as_str()),
            Some("collapsible")
        );
    }
}
