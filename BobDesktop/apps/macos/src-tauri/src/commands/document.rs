//! Structured native conversion API backed exclusively by shared document runtimes.
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::services::runtime_manager::{ControlledProcessRequest, RuntimeManager};
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertDocumentInput {
    pub source_path: String,
    pub output_path: String,
}

fn validate_output(path: &std::path::Path) -> AppResult<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(
        extension.as_str(),
        "pdf" | "docx" | "odt" | "epub" | "html" | "md" | "tex" | "txt" | "rtf"
    ) {
        return Err(AppError::ValidationFailed(
            "Unsupported document output format".into(),
        ));
    }
    Ok(extension)
}

#[tauri::command]
pub async fn convert_document(
    input: ConvertDocumentInput,
    db: State<'_, Database>,
    manager: State<'_, RuntimeManager>,
) -> AppResult<String> {
    let source = PathBuf::from(&input.source_path).canonicalize()?;
    let destination = PathBuf::from(&input.output_path);
    let extension = validate_output(&destination)?;
    if !source.is_file() || !destination.is_absolute() || destination.exists() {
        return Err(AppError::ValidationFailed(
            "Choose an existing source and a new absolute output path".into(),
        ));
    }
    let parent = destination
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| AppError::ValidationFailed("Output directory does not exist".into()))?;
    let staging = tempfile::tempdir_in(parent)?;
    let latex_source = source
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("tex"));
    let native_latex = latex_source && extension == "pdf";
    let handle = manager.resolve_platform_capability(
        &db,
        "bob-work.document-conversion",
        if native_latex {
            "latex"
        } else {
            "document.convert"
        },
    )?;
    let executable = handle
        .executable
        .ok_or_else(|| AppError::NotFound("Document runtime executable".into()))?;
    let staged_output;
    let mut args;
    if native_latex {
        staged_output = staging
            .path()
            .join(source.file_stem().unwrap())
            .with_extension("pdf");
        args = vec![
            "-X".into(),
            "compile".into(),
            "--untrusted".into(),
            "--outdir".into(),
            staging.path().to_string_lossy().into_owned(),
            source.to_string_lossy().into_owned(),
        ];
    } else {
        staged_output = staging.path().join(format!("document.{extension}"));
        args = vec![
            source.to_string_lossy().into_owned(),
            "--standalone".into(),
            "--output".into(),
            staged_output.to_string_lossy().into_owned(),
        ];
        if extension == "pdf" {
            let latex = manager.resolve_platform_capability(
                &db,
                "bob-work.document-conversion",
                "latex",
            )?;
            args.push(format!(
                "--pdf-engine={}",
                latex
                    .executable
                    .ok_or_else(|| AppError::NotFound("LaTeX executable".into()))?
            ));
        }
        if extension == "txt" {
            args.extend(["--to".into(), "plain".into()]);
        }
    }
    let result = manager
        .execute_controlled(
            &serde_json::json!({"permissions":["command.execute"]}),
            ControlledProcessRequest {
                plugin_id: "bob-work.document-conversion".into(),
                runtime_id: handle.runtime_id,
                executable: executable.into(),
                args,
                working_directory: source.parent().unwrap().to_path_buf(),
                environment: handle.environment,
                timeout: Duration::from_secs(180),
            },
        )
        .await?;
    if result.exit_code != Some(0)
        || result.timed_out
        || result.cancelled
        || !staged_output.is_file()
    {
        return Err(AppError::Io(format!(
            "Document conversion failed: {}",
            result.stderr.chars().take(4000).collect::<String>()
        )));
    }
    // Atomic no-clobber publication, including a concurrent creator of the target.
    std::fs::hard_link(&staged_output, &destination)?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_conversion_formats() {
        assert_eq!(
            validate_output(std::path::Path::new("/tmp/out.PDF")).unwrap(),
            "pdf"
        );
        assert!(validate_output(std::path::Path::new("/tmp/out.exe")).is_err());
    }
}
