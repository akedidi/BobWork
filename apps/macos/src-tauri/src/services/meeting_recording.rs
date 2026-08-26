use crate::error::AppError;
use crate::services::local_audio_transcription::AppleTranscription;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const RECORDING_FORMAT: &str = "m4a/aac";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingRecording {
    pub id: String,
    pub created_at: String,
    pub format: String,
    pub recording_path: String,
    pub microphone_path: Option<String>,
    pub system_audio_path: Option<String>,
    pub manifest_path: String,
    pub transcript_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub speaker: String,
    pub source: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTranscript {
    pub recording_id: String,
    pub created_at: String,
    pub engine: String,
    pub locale: String,
    pub speaker_strategy: String,
    pub segments: Vec<MeetingTranscriptSegment>,
    pub text: String,
}

pub fn create_recording_manifest(recording_path: &Path) -> Result<MeetingRecording, AppError> {
    ensure_non_empty_file(recording_path)?;
    let stem = recording_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::ValidationFailed("Nom d’enregistrement invalide.".into()))?;
    let directory = recording_path
        .parent()
        .ok_or_else(|| AppError::ValidationFailed("Dossier d’enregistrement invalide.".into()))?;
    let microphone_path = directory.join(format!("{stem}.microphone.m4a"));
    let system_audio_path = directory.join(format!("{stem}.system_audio.m4a"));
    let manifest_path = manifest_path_for(recording_path);
    let recording = MeetingRecording {
        id: stem
            .strip_prefix("bob-work-recording-")
            .unwrap_or(stem)
            .to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        format: RECORDING_FORMAT.into(),
        recording_path: recording_path.to_string_lossy().to_string(),
        microphone_path: non_empty_file(&microphone_path)
            .then(|| microphone_path.to_string_lossy().to_string()),
        system_audio_path: non_empty_file(&system_audio_path)
            .then(|| system_audio_path.to_string_lossy().to_string()),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        transcript_path: None,
    };
    write_recording_manifest(&recording)?;
    Ok(recording)
}

pub fn recording_for_audio(path: &Path) -> Option<MeetingRecording> {
    let manifest_path = manifest_path_for(path);
    let bytes = std::fs::read(manifest_path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub async fn get_or_create_transcript(
    recording: &mut MeetingRecording,
    language: &str,
) -> Result<(MeetingTranscript, bool), AppError> {
    if let Some(cached) = load_cached_transcript(recording) {
        return Ok((cached, true));
    }

    let preferred_locale =
        crate::services::local_audio_transcription::transcription_locales(language)[0];
    let mut segments = Vec::new();
    let mut engines = Vec::new();
    let mut locales = Vec::new();
    let mut source_errors = Vec::new();

    if let Some(path) = recording.microphone_path.as_deref() {
        match transcribe_source(path, preferred_locale, "Participant 1", "microphone").await {
            Ok((source_segments, engine, locale)) => {
                segments.extend(source_segments);
                engines.push(engine);
                locales.push(locale);
            }
            Err(error) => source_errors.push(format!("microphone: {error}")),
        }
    }
    if let Some(path) = recording.system_audio_path.as_deref() {
        match transcribe_source(path, preferred_locale, "Participant 2", "system_audio").await {
            Ok((source_segments, engine, locale)) => {
                segments.extend(source_segments);
                engines.push(engine);
                locales.push(locale);
            }
            Err(error) => source_errors.push(format!("audio système: {error}")),
        }
    }

    // Older or externally supplied recordings may not have separate tracks.
    // The mixed reference is also a safe fallback when both isolated tracks
    // contain no intelligible speech.
    if segments.is_empty() {
        let (source_segments, engine, locale) = transcribe_source(
            &recording.recording_path,
            preferred_locale,
            "Participant 1",
            "mixed",
        )
        .await
        .map_err(|error| {
            let details = if source_errors.is_empty() {
                String::new()
            } else {
                format!(" ({})", source_errors.join("; "))
            };
            AppError::Io(format!("{error}{details}"))
        })?;
        segments.extend(source_segments);
        engines.push(engine);
        locales.push(locale);
    }

    segments.sort_by_key(|segment| (segment.start_ms, speaker_order(&segment.speaker)));
    engines.sort();
    engines.dedup();
    let text = format_structured_transcript(&segments);
    let transcript = MeetingTranscript {
        recording_id: recording.id.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        engine: engines.join("+"),
        locale: locales
            .into_iter()
            .find(|value| !value.trim().is_empty())
            .unwrap_or_else(|| preferred_locale.to_string()),
        speaker_strategy: if recording.microphone_path.is_some()
            || recording.system_audio_path.is_some()
        {
            "source-separated; microphone=Participant 1; system audio=Participant 2; no synthetic remote-speaker diarization".into()
        } else {
            "single mixed source; no speaker diarization".into()
        },
        segments,
        text,
    };
    persist_transcript(recording, &transcript)?;
    Ok((transcript, false))
}

pub fn transcript_from_single_source(
    recording_id: &str,
    transcription: &AppleTranscription,
) -> MeetingTranscript {
    let segments = group_speech_segments(transcription, "Participant 1", "mixed");
    let text = format_structured_transcript(&segments);
    MeetingTranscript {
        recording_id: recording_id.into(),
        created_at: chrono::Utc::now().to_rfc3339(),
        engine: transcription.engine.clone(),
        locale: transcription.locale.clone(),
        speaker_strategy: "single mixed source; no speaker diarization".into(),
        segments,
        text,
    }
}

fn transcribe_source<'a>(
    path: &'a str,
    locale: &'a str,
    speaker: &'a str,
    source: &'a str,
) -> impl std::future::Future<
    Output = Result<(Vec<MeetingTranscriptSegment>, String, String), AppError>,
> + 'a {
    async move {
        let result = crate::services::local_audio_transcription::transcribe_audio_file(
            Path::new(path),
            locale,
        )
        .await?;
        let segments = group_speech_segments(&result, speaker, source);
        Ok((segments, result.engine, result.locale))
    }
}

fn group_speech_segments(
    transcription: &AppleTranscription,
    speaker: &str,
    source: &str,
) -> Vec<MeetingTranscriptSegment> {
    let mut input = transcription.segments.clone();
    input.sort_by_key(|segment| segment.start_ms);
    let mut output = Vec::new();
    let mut current: Option<MeetingTranscriptSegment> = None;
    for segment in input {
        let segment_end = segment.start_ms.saturating_add(segment.duration_ms.max(0));
        let should_flush = current.as_ref().is_some_and(|value| {
            let gap = segment.start_ms.saturating_sub(value.end_ms);
            gap > 1_200
                || value.end_ms.saturating_sub(value.start_ms) >= 15_000
                || ends_utterance(&value.text)
        });
        if should_flush {
            if let Some(value) = current.take() {
                output.push(value);
            }
        }
        match current.as_mut() {
            Some(value) => {
                append_token(&mut value.text, &segment.text);
                value.end_ms = value.end_ms.max(segment_end);
            }
            None => {
                current = Some(MeetingTranscriptSegment {
                    start_ms: segment.start_ms.max(0),
                    end_ms: segment_end.max(segment.start_ms),
                    speaker: speaker.into(),
                    source: source.into(),
                    text: segment.text.trim().to_string(),
                });
            }
        }
    }
    if let Some(value) = current {
        output.push(value);
    }
    output
}

fn append_token(text: &mut String, token: &str) {
    let token = token.trim();
    if token.is_empty() {
        return;
    }
    let no_leading_space = token
        .chars()
        .next()
        .is_some_and(|value| matches!(value, '.' | ',' | '?' | '!' | ':' | ';' | ')' | ']'));
    if !text.is_empty() && !no_leading_space && !text.ends_with(['\'', '’', '-', '—']) {
        text.push(' ');
    }
    text.push_str(token);
}

fn ends_utterance(text: &str) -> bool {
    text.trim_end()
        .chars()
        .last()
        .is_some_and(|value| matches!(value, '.' | '?' | '!'))
}

fn speaker_order(speaker: &str) -> u8 {
    if speaker == "Participant 1" {
        0
    } else {
        1
    }
}

pub fn format_structured_transcript(segments: &[MeetingTranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| {
            format!(
                "[{}] {}:\n{}",
                format_timestamp(segment.start_ms),
                segment.speaker,
                segment.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_timestamp(milliseconds: i64) -> String {
    let total_seconds = milliseconds.max(0) / 1_000;
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds % 3_600) / 60;
    let seconds = total_seconds % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

fn persist_transcript(
    recording: &mut MeetingRecording,
    transcript: &MeetingTranscript,
) -> Result<(), AppError> {
    let transcript_path = transcript_path_for(Path::new(&recording.recording_path));
    let text_path = transcript_text_path_for(Path::new(&recording.recording_path));
    let bytes = serde_json::to_vec_pretty(transcript).map_err(|error| {
        AppError::Io(format!("Impossible de sérialiser le transcript : {error}"))
    })?;
    std::fs::write(&transcript_path, bytes)?;
    std::fs::write(&text_path, &transcript.text)?;
    recording.transcript_path = Some(transcript_path.to_string_lossy().to_string());
    write_recording_manifest(recording)
}

fn load_cached_transcript(recording: &MeetingRecording) -> Option<MeetingTranscript> {
    let path = recording
        .transcript_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| transcript_path_for(Path::new(&recording.recording_path)));
    let bytes = std::fs::read(path).ok()?;
    let transcript = serde_json::from_slice::<MeetingTranscript>(&bytes).ok()?;
    (!transcript.text.trim().is_empty()).then_some(transcript)
}

fn write_recording_manifest(recording: &MeetingRecording) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(recording).map_err(|error| {
        AppError::Io(format!(
            "Impossible de sérialiser l’enregistrement : {error}"
        ))
    })?;
    std::fs::write(&recording.manifest_path, bytes)?;
    Ok(())
}

fn manifest_path_for(path: &Path) -> PathBuf {
    path.with_extension("recording.json")
}

fn transcript_path_for(path: &Path) -> PathBuf {
    path.with_extension("transcript.json")
}

pub fn transcript_text_path_for(path: &Path) -> PathBuf {
    path.with_extension("transcript.txt")
}

fn non_empty_file(path: &Path) -> bool {
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

fn ensure_non_empty_file(path: &Path) -> Result<(), AppError> {
    if non_empty_file(path) {
        Ok(())
    } else {
        Err(AppError::Io(format!(
            "Le fichier audio final est vide ou introuvable : {}",
            path.display()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::local_audio_transcription::SpeechSegment;

    /// Manual end-to-end regression test for a licensed real-world meeting fixture.
    ///
    /// Run with:
    /// `BOB_WORK_REAL_MEETING_AUDIO=/absolute/path/to/meeting.m4a cargo test \
    ///   services::meeting_recording::tests::transcribes_real_meeting_and_reuses_cache -- --ignored --nocapture`
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a real meeting audio fixture and macOS Speech permission"]
    async fn transcribes_real_meeting_and_reuses_cache() {
        let fixture = std::env::var_os("BOB_WORK_REAL_MEETING_AUDIO")
            .map(PathBuf::from)
            .expect("BOB_WORK_REAL_MEETING_AUDIO must point to an M4A fixture");
        assert!(
            fixture.is_file(),
            "fixture is missing: {}",
            fixture.display()
        );

        let directory = tempfile::tempdir().unwrap();
        let mixed = directory.path().join("bob-work-recording-real-meeting.m4a");
        let system = directory
            .path()
            .join("bob-work-recording-real-meeting.system_audio.m4a");
        std::fs::copy(&fixture, &mixed).unwrap();
        std::fs::copy(&fixture, &system).unwrap();

        let mut recording = create_recording_manifest(&mixed).unwrap();
        let (transcript, reused) = get_or_create_transcript(&mut recording, "en")
            .await
            .unwrap();
        assert!(!reused);
        assert!(!transcript.text.trim().is_empty());
        assert!(transcript
            .segments
            .iter()
            .all(|segment| segment.speaker == "Participant 2"));
        assert!(transcript
            .segments
            .iter()
            .all(|segment| segment.start_ms >= 0 && segment.end_ms >= segment.start_ms));
        println!("{}", serde_json::to_string_pretty(&transcript).unwrap());

        std::fs::remove_file(&mixed).unwrap();
        std::fs::remove_file(&system).unwrap();
        let (cached, reused) = get_or_create_transcript(&mut recording, "en")
            .await
            .unwrap();
        assert!(reused);
        assert_eq!(cached, transcript);
    }

    #[test]
    fn creates_manifest_for_mixed_and_separate_m4a_files() {
        let directory = tempfile::tempdir().unwrap();
        let mixed = directory.path().join("bob-work-recording-abc.m4a");
        std::fs::write(&mixed, b"mixed").unwrap();
        std::fs::write(
            directory
                .path()
                .join("bob-work-recording-abc.microphone.m4a"),
            b"mic",
        )
        .unwrap();
        std::fs::write(
            directory
                .path()
                .join("bob-work-recording-abc.system_audio.m4a"),
            b"system",
        )
        .unwrap();

        let recording = create_recording_manifest(&mixed).expect("manifest");
        assert_eq!(recording.id, "abc");
        assert!(recording.microphone_path.is_some());
        assert!(recording.system_audio_path.is_some());
        assert_eq!(
            recording_for_audio(&mixed).expect("saved manifest").format,
            RECORDING_FORMAT
        );
    }

    #[test]
    fn groups_words_and_formats_stable_participants() {
        let transcription = AppleTranscription {
            engine: "apple-speech-legacy".into(),
            locale: "fr-FR".into(),
            segments: vec![
                SpeechSegment {
                    start_ms: 3_100,
                    duration_ms: 300,
                    text: "Bonjour".into(),
                },
                SpeechSegment {
                    start_ms: 3_450,
                    duration_ms: 200,
                    text: ",".into(),
                },
                SpeechSegment {
                    start_ms: 3_700,
                    duration_ms: 500,
                    text: "vous m'entendez ?".into(),
                },
            ],
        };
        let segments = group_speech_segments(&transcription, "Participant 1", "microphone");
        let text = format_structured_transcript(&segments);
        assert!(text.contains("[00:00:03] Participant 1:"));
        assert!(text.contains("Bonjour, vous m'entendez ?"));
    }

    #[tokio::test]
    async fn reuses_persisted_transcript_without_reading_audio_again() {
        let directory = tempfile::tempdir().unwrap();
        let mixed = directory.path().join("bob-work-recording-cache.m4a");
        std::fs::write(&mixed, b"mixed").unwrap();
        let mut recording = create_recording_manifest(&mixed).expect("manifest");
        let expected = MeetingTranscript {
            recording_id: recording.id.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            engine: "apple-speech-transcriber".into(),
            locale: "fr-FR".into(),
            speaker_strategy: "source-separated".into(),
            segments: vec![MeetingTranscriptSegment {
                start_ms: 0,
                end_ms: 1_000,
                speaker: "Participant 1".into(),
                source: "microphone".into(),
                text: "Décision validée.".into(),
            }],
            text: "[00:00:00] Participant 1:\nDécision validée.".into(),
        };
        persist_transcript(&mut recording, &expected).expect("persist transcript");
        std::fs::remove_file(&mixed).unwrap();

        let (cached, reused) = get_or_create_transcript(&mut recording, "fr")
            .await
            .expect("cached transcript");
        assert!(reused);
        assert_eq!(cached, expected);
    }
}
