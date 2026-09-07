import AVFoundation
import Foundation
import NaturalLanguage
import Speech

public typealias BWTranscriptionCallback = @convention(c) (
    UnsafePointer<CChar>?,
    UnsafePointer<CChar>?,
    UnsafeMutableRawPointer?
) -> Void

private struct BWCallbackBox: @unchecked Sendable {
    let callback: BWTranscriptionCallback
    let context: UnsafeMutableRawPointer?

    func succeed(_ text: String) {
        text.withCString { pointer in
            callback(pointer, nil, context)
        }
    }

    func fail(_ message: String) {
        message.withCString { pointer in
            callback(nil, pointer, context)
        }
    }
}

private enum BWModernSpeechError: LocalizedError {
    case unavailable
    case unsupportedLocale(String)
    case noInstalledLocale
    case noSpeech

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "BW_MODERN_SPEECH_UNAVAILABLE"
        case .unsupportedLocale(let identifier):
            return "La langue \(identifier) n’est pas prise en charge par la reconnaissance vocale Apple."
        case .noInstalledLocale:
            return "Aucun modèle de reconnaissance vocale Apple compatible n’est disponible."
        case .noSpeech:
            return "Aucune parole intelligible n’a été détectée dans l’enregistrement."
        }
    }
}

private let bwMeetingLocaleIdentifiers = ["en-US", "fr-FR", "es-ES"]

private struct BWSpeechSegment: Codable {
    let startMs: Int64
    let durationMs: Int64
    let text: String
}

private struct BWSpeechPayload: Codable {
    let locale: String
    let segments: [BWSpeechSegment]
}

private func normalizedLocaleIdentifier(_ identifier: String) -> String {
    identifier.replacingOccurrences(of: "_", with: "-").lowercased()
}

private func languageCode(for locale: Locale) -> String? {
    (locale as NSLocale).object(forKey: .languageCode)
        .flatMap { $0 as? String }?
        .lowercased()
}

@available(macOS 26.0, *)
private func supportedLocale(equivalentTo locale: Locale) async throws -> Locale {
    guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
        throw BWModernSpeechError.unsupportedLocale(locale.identifier)
    }
    return supported
}

@available(macOS 26.0, *)
private func installedMeetingLocale(preferredLocale: Locale) async -> Locale? {
    let installed = await SpeechTranscriber.installedLocales
    let preferredLanguage = languageCode(for: preferredLocale)
    if let exact = installed.first(where: {
        normalizedLocaleIdentifier($0.identifier)
            == normalizedLocaleIdentifier(preferredLocale.identifier)
    }) {
        return exact
    }
    if let sameLanguage = installed.first(where: {
        languageCode(for: $0) == preferredLanguage
    }) {
        return sameLanguage
    }
    let supportedLanguages = Set(
        bwMeetingLocaleIdentifiers.compactMap { languageCode(for: Locale(identifier: $0)) }
    )
    return installed.first(where: {
        guard let code = languageCode(for: $0) else { return false }
        return supportedLanguages.contains(code)
    })
}

@available(macOS 26.0, *)
private func ensureSpeechAssets(for locale: Locale) async throws -> Locale {
    let selectedLocale = try await supportedLocale(equivalentTo: locale)
    let installed = await SpeechTranscriber.installedLocales
    let isInstalled = installed.contains(where: {
        normalizedLocaleIdentifier($0.identifier)
            == normalizedLocaleIdentifier(selectedLocale.identifier)
    })
    if !isInstalled {
        let transcriber = SpeechTranscriber(locale: selectedLocale, preset: .transcription)
        guard let request = try await AssetInventory.assetInstallationRequest(
            supporting: [transcriber]
        ) else {
            throw BWModernSpeechError.noInstalledLocale
        }
        try await request.downloadAndInstall()
    }
    // Reservation keeps the locally downloaded language available between
    // meetings. Failure is non-fatal when macOS has reached its reservation cap.
    _ = try? await AssetInventory.reserve(locale: selectedLocale)
    return selectedLocale
}

@available(macOS 26.0, *)
private func transcribeAudioFile(at url: URL, locale: Locale) async throws -> [BWSpeechSegment] {
    let transcriber = SpeechTranscriber(
        locale: locale,
        transcriptionOptions: [],
        reportingOptions: [],
        attributeOptions: [.audioTimeRange]
    )
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let audioFile = try AVAudioFile(forReading: url)
    let resultsTask = Task { () throws -> [BWSpeechSegment] in
        var chunks: [BWSpeechSegment] = []
        for try await result in transcriber.results where result.isFinal {
            let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                let start = max(0, CMTimeGetSeconds(result.range.start))
                let duration = max(0, CMTimeGetSeconds(result.range.duration))
                chunks.append(BWSpeechSegment(
                    startMs: Int64((start * 1_000).rounded()),
                    durationMs: Int64((duration * 1_000).rounded()),
                    text: text
                ))
            }
        }
        return chunks
    }

    do {
        if let finalTime = try await analyzer.analyzeSequence(from: audioFile) {
            try await analyzer.finalizeAndFinish(through: finalTime)
        } else {
            try await analyzer.finalizeAndFinishThroughEndOfInput()
        }
        let segments = try await resultsTask.value
        guard !segments.isEmpty else {
            throw BWModernSpeechError.noSpeech
        }
        return segments
    } catch {
        resultsTask.cancel()
        throw error
    }
}

private func detectedMeetingLocale(from transcript: String) -> Locale? {
    guard transcript.count >= 40 else { return nil }
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(transcript)
    guard let dominant = recognizer.dominantLanguage else { return nil }
    let confidence = recognizer.languageHypotheses(withMaximum: 1)[dominant] ?? 0
    guard confidence >= 0.65 else { return nil }
    switch dominant {
    case .english:
        return Locale(identifier: "en-US")
    case .french:
        return Locale(identifier: "fr-FR")
    case .spanish:
        return Locale(identifier: "es-ES")
    default:
        return nil
    }
}

@available(macOS 26.0, *)
private func transcribeMeeting(
    audioPath: String,
    preferredLocaleIdentifier: String
) async throws -> BWSpeechPayload {
    let preferred = Locale(
        identifier: preferredLocaleIdentifier.isEmpty ? Locale.current.identifier : preferredLocaleIdentifier
    )
    let initialLocale: Locale
    if let installed = await installedMeetingLocale(preferredLocale: preferred) {
        initialLocale = try await supportedLocale(equivalentTo: installed)
    } else {
        initialLocale = try await ensureSpeechAssets(for: preferred)
    }

    let audioURL = URL(fileURLWithPath: audioPath)
    let initialSegments = try await transcribeAudioFile(at: audioURL, locale: initialLocale)
    let initialTranscript = initialSegments.map(\.text).joined(separator: " ")
    guard let detectedLocale = detectedMeetingLocale(from: initialTranscript),
          languageCode(for: detectedLocale) != languageCode(for: initialLocale)
    else {
        return BWSpeechPayload(locale: initialLocale.identifier, segments: initialSegments)
    }

    let matchingLocale = try await ensureSpeechAssets(for: detectedLocale)
    let matchingSegments = try await transcribeAudioFile(at: audioURL, locale: matchingLocale)
    return BWSpeechPayload(locale: matchingLocale.identifier, segments: matchingSegments)
}

@_cdecl("bw_transcribe_audio_file_modern")
public func bwTranscribeAudioFileModern(
    _ audioPath: UnsafePointer<CChar>?,
    _ preferredLocaleIdentifier: UnsafePointer<CChar>?,
    _ callback: @escaping BWTranscriptionCallback,
    _ context: UnsafeMutableRawPointer?
) {
    let callbackBox = BWCallbackBox(callback: callback, context: context)
    guard #available(macOS 26.0, *) else {
        callbackBox.fail(BWModernSpeechError.unavailable.localizedDescription)
        return
    }
    guard let audioPath else {
        callbackBox.fail("Chemin audio manquant.")
        return
    }
    let path = String(cString: audioPath)
    let localeIdentifier = preferredLocaleIdentifier.map(String.init(cString:)) ?? ""
    Task.detached(priority: .userInitiated) {
        do {
            let transcript = try await transcribeMeeting(
                audioPath: path,
                preferredLocaleIdentifier: localeIdentifier
            )
            let data = try JSONEncoder().encode(transcript)
            guard let payload = String(data: data, encoding: .utf8) else {
                throw BWModernSpeechError.noSpeech
            }
            callbackBox.succeed(payload)
        } catch {
            let nsError = error as NSError
            let message = nsError.localizedDescription.isEmpty
                ? "La transcription locale Apple a échoué."
                : nsError.localizedDescription
            callbackBox.fail(
                "\(message) [\(nsError.domain):\(nsError.code)]"
            )
        }
    }
}
