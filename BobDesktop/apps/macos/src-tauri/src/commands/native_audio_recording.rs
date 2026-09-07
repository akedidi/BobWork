use crate::error::AppError;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use crate::services::meeting_recording::MeetingRecording;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn bw_audio_recording_start(
        output_path: *const c_char,
        callback: NativeAudioCallback,
        context: *mut c_void,
    );
    fn bw_audio_recording_stop(callback: NativeAudioCallback, context: *mut c_void);
    fn bw_audio_recording_level() -> f32;
}

type NativeAudioCallback = extern "C" fn(*const c_char, *const c_char, *mut c_void);
type NativeResultSender = oneshot::Sender<Result<String, String>>;

extern "C" fn native_audio_callback(
    result: *const c_char,
    error: *const c_char,
    context: *mut c_void,
) {
    if context.is_null() {
        return;
    }
    let sender = unsafe { Box::from_raw(context.cast::<Option<NativeResultSender>>()) };
    let Some(sender) = *sender else {
        return;
    };
    let value = if !error.is_null() {
        Err(unsafe { CStr::from_ptr(error) }
            .to_string_lossy()
            .into_owned())
    } else if !result.is_null() {
        Ok(unsafe { CStr::from_ptr(result) }
            .to_string_lossy()
            .into_owned())
    } else {
        Err("La capture audio native n’a retourné aucun résultat.".into())
    };
    let _ = sender.send(value);
}

#[cfg(target_os = "macos")]
async fn wait_for_native_callback(
    start: impl FnOnce(NativeAudioCallback, *mut c_void),
) -> Result<String, AppError> {
    let (sender, receiver) = oneshot::channel::<Result<String, String>>();
    let context = Box::into_raw(Box::new(Some(sender))).cast::<c_void>();
    start(native_audio_callback, context);
    receiver
        .await
        .map_err(|_| AppError::Io("La capture audio native a été interrompue.".into()))?
        .map_err(AppError::Io)
}

#[tauri::command]
pub async fn start_native_audio_recording(app: AppHandle) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let microphone =
            tokio::task::spawn_blocking(crate::macos_permissions::request_microphone_access)
                .await
                .map_err(|error| AppError::Io(error.to_string()))?
                .map_err(AppError::Io)?;
        if !microphone.is_authorized() {
            return Err(AppError::PermissionDenied(
                "Le microphone n’est pas autorisé pour Bob Work.".into(),
            ));
        }

        let recordings_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| AppError::Io(error.to_string()))?
            .join("recordings");
        std::fs::create_dir_all(&recordings_dir)?;
        let output_path =
            recordings_dir.join(format!("bob-work-recording-{}.m4a", uuid::Uuid::new_v4()));
        let output = CString::new(output_path.to_string_lossy().as_bytes())
            .map_err(|_| AppError::ValidationFailed("Chemin d’enregistrement invalide.".into()))?;
        wait_for_native_callback(|callback, context| unsafe {
            bw_audio_recording_start(output.as_ptr(), callback, context)
        })
        .await?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(AppError::ValidationFailed(
            "L’enregistrement du microphone et de l’audio système est disponible uniquement sur macOS."
                .into(),
        ))
    }
}

#[tauri::command]
pub async fn stop_native_audio_recording(app: AppHandle) -> Result<MeetingRecording, AppError> {
    #[cfg(target_os = "macos")]
    {
        let path = wait_for_native_callback(|callback, context| unsafe {
            bw_audio_recording_stop(callback, context)
        })
        .await?;
        let recording =
            crate::services::meeting_recording::create_recording_manifest(Path::new(&path))?;
        let mut paths = vec![
            recording.recording_path.as_str(),
            recording.manifest_path.as_str(),
        ];
        paths.extend(recording.microphone_path.as_deref());
        paths.extend(recording.system_audio_path.as_deref());
        for path in paths {
            app.asset_protocol_scope()
                .allow_file(path)
                .map_err(|error| {
                    AppError::Security(format!("Enregistrement audio refusé : {error}"))
                })?;
        }
        Ok(recording)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err(AppError::ValidationFailed(
            "Aucun enregistrement audio natif n’est actif.".into(),
        ))
    }
}

#[tauri::command]
pub fn native_audio_recording_level() -> f32 {
    #[cfg(target_os = "macos")]
    {
        unsafe { bw_audio_recording_level() }.clamp(0.0, 1.0)
    }
    #[cfg(not(target_os = "macos"))]
    {
        0.0
    }
}
