use crate::error::AppError;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;
use tokio::sync::oneshot;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechSegment {
    pub start_ms: i64,
    pub duration_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct NativeSpeechPayload {
    locale: String,
    segments: Vec<SpeechSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppleTranscription {
    pub engine: String,
    pub locale: String,
    pub segments: Vec<SpeechSegment>,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn bw_transcribe_audio_file_modern(
        audio_path: *const c_char,
        locale_identifier: *const c_char,
        callback: NativeTranscriptionCallback,
        context: *mut c_void,
    );
    fn bw_transcribe_audio_file_legacy(
        audio_path: *const c_char,
        locale_identifier: *const c_char,
        callback: NativeTranscriptionCallback,
        context: *mut c_void,
    );
}

type NativeTranscriptionCallback = extern "C" fn(*const c_char, *const c_char, *mut c_void);
type NativeTranscriptionSender = oneshot::Sender<Result<String, String>>;
const MODERN_SPEECH_UNAVAILABLE: &str = "BW_MODERN_SPEECH_UNAVAILABLE";

extern "C" fn native_transcription_callback(
    result: *const c_char,
    error: *const c_char,
    context: *mut c_void,
) {
    if context.is_null() {
        return;
    }
    let sender = unsafe { Box::from_raw(context.cast::<Option<NativeTranscriptionSender>>()) };
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
        Err("La transcription Apple n’a retourné aucun texte.".into())
    };
    let _ = sender.send(value);
}

/// Transcribe an audio file with Apple's on-device Speech framework and retain
/// source timestamps. Model/asset initialization happens here, never when the
/// recording starts.
/// No audio bytes leave the Mac and no API key is involved.
pub async fn transcribe_audio_file(
    path: &Path,
    locale: &str,
) -> Result<AppleTranscription, AppError> {
    if !path.is_file() {
        return Err(AppError::NotFound(format!(
            "Fichier audio introuvable : {}",
            path.display()
        )));
    }

    #[cfg(target_os = "macos")]
    {
        #[cfg(test)]
        let skip_permission_check =
            std::env::var_os("BOB_WORK_TEST_SKIP_SPEECH_PERMISSION_CHECK").is_some();
        #[cfg(not(test))]
        let skip_permission_check = false;

        if !skip_permission_check {
            let authorization = tokio::task::spawn_blocking(
                crate::macos_permissions::request_speech_recognition_access,
            )
            .await
            .map_err(|error| AppError::Io(error.to_string()))?
            .map_err(AppError::Io)?;
            if !matches!(
                authorization,
                crate::macos_permissions::SpeechRecognitionAuthorization::Authorized
            ) {
                return Err(AppError::PermissionDenied(
                    "La reconnaissance vocale n’est pas autorisée pour Bob Work.".into(),
                ));
            }
        }
        let modern = run_native_transcriber(path, locale, true).await;
        if modern
            .as_ref()
            .is_err_and(|error| error.contains(MODERN_SPEECH_UNAVAILABLE))
        {
            let payload = run_native_transcriber(path, locale, false)
                .await
                .map_err(AppError::Io)?;
            return decode_native_payload(payload, locale, "apple-speech-legacy");
        }
        let payload = modern.map_err(AppError::Io)?;
        return decode_native_payload(payload, locale, "apple-speech-transcriber");
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = locale;
        Err(AppError::ValidationFailed(
            "La transcription Apple locale est disponible uniquement sur macOS.".into(),
        ))
    }
}

fn decode_native_payload(
    payload: String,
    fallback_locale: &str,
    engine: &str,
) -> Result<AppleTranscription, AppError> {
    let decoded = serde_json::from_str::<NativeSpeechPayload>(&payload).unwrap_or_else(|_| {
        NativeSpeechPayload {
            locale: fallback_locale.to_string(),
            segments: vec![SpeechSegment {
                start_ms: 0,
                duration_ms: 0,
                text: payload.trim().to_string(),
            }],
        }
    });
    let segments = decoded
        .segments
        .into_iter()
        .filter_map(|mut segment| {
            segment.text = segment.text.trim().to_string();
            (!segment.text.is_empty()).then_some(segment)
        })
        .collect::<Vec<_>>();
    if segments.is_empty() {
        return Err(AppError::Io(
            "La transcription Apple n’a retourné aucun texte.".into(),
        ));
    }
    Ok(AppleTranscription {
        engine: engine.to_string(),
        locale: if decoded.locale.trim().is_empty() {
            fallback_locale.to_string()
        } else {
            decoded.locale
        },
        segments,
    })
}

#[cfg(target_os = "macos")]
async fn run_native_transcriber(path: &Path, locale: &str, modern: bool) -> Result<String, String> {
    let audio_path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| "Le chemin du fichier audio est invalide.".to_string())?;
    let locale_identifier =
        CString::new(locale).map_err(|_| "La langue de transcription est invalide.".to_string())?;
    let (sender, receiver) = oneshot::channel::<Result<String, String>>();
    let context = Box::into_raw(Box::new(Some(sender))).cast::<c_void>();
    unsafe {
        if modern {
            bw_transcribe_audio_file_modern(
                audio_path.as_ptr(),
                locale_identifier.as_ptr(),
                native_transcription_callback,
                context,
            );
        } else {
            bw_transcribe_audio_file_legacy(
                audio_path.as_ptr(),
                locale_identifier.as_ptr(),
                native_transcription_callback,
                context,
            );
        }
    }
    receiver
        .await
        .map_err(|_| "La transcription Apple a été interrompue.".to_string())?
}

pub fn is_transcribable_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "m4a" | "aac" | "caf" | "mp3" | "wav"
            )
        })
}

/// Candidate order only follows the UI preference; every supported Bob Work
/// language is still attempted because a meeting's language may differ from
/// the interface language.
pub fn transcription_locales(language: &str) -> [&'static str; 3] {
    match language.trim().to_ascii_lowercase().as_str() {
        "fr" => ["fr-FR", "en-US", "es-ES"],
        "es" => ["es-ES", "en-US", "fr-FR"],
        _ => ["en-US", "fr-FR", "es-ES"],
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_native_payload, is_transcribable_audio, transcription_locales};
    use std::path::Path;

    #[test]
    fn detects_supported_audio_without_treating_video_as_audio() {
        assert!(is_transcribable_audio(Path::new("meeting.M4A")));
        assert!(is_transcribable_audio(Path::new("voice.wav")));
        assert!(!is_transcribable_audio(Path::new("screen.mp4")));
        assert!(!is_transcribable_audio(Path::new("photo.png")));
    }

    #[test]
    fn keeps_all_audio_languages_available_regardless_of_ui_language() {
        assert_eq!(transcription_locales("fr"), ["fr-FR", "en-US", "es-ES"]);
        assert_eq!(transcription_locales("es"), ["es-ES", "en-US", "fr-FR"]);
        assert_eq!(transcription_locales("en"), ["en-US", "fr-FR", "es-ES"]);
        assert_eq!(transcription_locales("auto"), ["en-US", "fr-FR", "es-ES"]);
    }

    #[test]
    fn decodes_timestamped_native_payload() {
        let result = decode_native_payload(
            r#"{"locale":"fr-FR","segments":[{"startMs":1250,"durationMs":800,"text":" Bonjour "}]}"#.into(),
            "en-US",
            "apple-speech-transcriber",
        )
        .expect("payload");
        assert_eq!(result.locale, "fr-FR");
        assert_eq!(result.segments[0].start_ms, 1250);
        assert_eq!(result.segments[0].text, "Bonjour");
    }
}
