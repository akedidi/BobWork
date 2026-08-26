#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <AudioToolbox/AudioToolbox.h>
#import <stdatomic.h>
#import <math.h>
#import <stdint.h>
#import <string.h>

typedef void (*BWAudioCallback)(const char *result, const char *error, void *context);

static _Atomic(float) BWCurrentAudioLevel = 0.0f;

@class BWSystemAudioRecorder;
static BWSystemAudioRecorder *BWActiveRecorder = nil;

static NSString *BWErrorMessage(NSError *error, NSString *fallback) {
    if (error.localizedDescription.length > 0) return error.localizedDescription;
    return fallback;
}

static AVMutableMetadataItem *BWTrackTitle(NSString *value) {
    AVMutableMetadataItem *item = [AVMutableMetadataItem metadataItem];
    item.identifier = AVMetadataCommonIdentifierTitle;
    item.value = value;
    item.extendedLanguageTag = @"und";
    return item;
}

static NSString *BWTitleForTrack(AVAssetTrack *track) {
    for (AVMetadataItem *item in track.commonMetadata) {
        if ([item.identifier isEqual:AVMetadataCommonIdentifierTitle]) {
            return item.stringValue;
        }
    }
    return nil;
}

static float BWLevelForSampleBuffer(CMSampleBufferRef sampleBuffer) {
    CMAudioFormatDescriptionRef format = (CMAudioFormatDescriptionRef)CMSampleBufferGetFormatDescription(sampleBuffer);
    const AudioStreamBasicDescription *description = format ? CMAudioFormatDescriptionGetStreamBasicDescription(format) : NULL;
    if (!description) return 0.0f;

    UInt32 channels = MAX((UInt32)1, description->mChannelsPerFrame);
    size_t listSize = offsetof(AudioBufferList, mBuffers) + sizeof(AudioBuffer) * channels;
    AudioBufferList *bufferList = calloc(1, listSize);
    if (!bufferList) return 0.0f;

    CMBlockBufferRef retainedBlock = NULL;
    OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        NULL,
        bufferList,
        listSize,
        NULL,
        NULL,
        kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
        &retainedBlock
    );
    if (status != noErr) {
        free(bufferList);
        return 0.0f;
    }

    double energy = 0.0;
    size_t sampleCount = 0;
    BOOL isFloat = (description->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    UInt32 bits = description->mBitsPerChannel;
    for (UInt32 index = 0; index < bufferList->mNumberBuffers; index += 1) {
        AudioBuffer buffer = bufferList->mBuffers[index];
        if (!buffer.mData || buffer.mDataByteSize == 0) continue;
        if (isFloat && bits == 32) {
            const float *values = (const float *)buffer.mData;
            size_t count = buffer.mDataByteSize / sizeof(float);
            for (size_t valueIndex = 0; valueIndex < count; valueIndex += 1) {
                double value = values[valueIndex];
                energy += value * value;
            }
            sampleCount += count;
        } else if (!isFloat && bits == 16) {
            const int16_t *values = (const int16_t *)buffer.mData;
            size_t count = buffer.mDataByteSize / sizeof(int16_t);
            for (size_t valueIndex = 0; valueIndex < count; valueIndex += 1) {
                double value = values[valueIndex] / 32768.0;
                energy += value * value;
            }
            sampleCount += count;
        } else if (!isFloat && bits == 32) {
            const int32_t *values = (const int32_t *)buffer.mData;
            size_t count = buffer.mDataByteSize / sizeof(int32_t);
            for (size_t valueIndex = 0; valueIndex < count; valueIndex += 1) {
                double value = values[valueIndex] / 2147483648.0;
                energy += value * value;
            }
            sampleCount += count;
        }
    }

    if (retainedBlock) CFRelease(retainedBlock);
    free(bufferList);
    if (sampleCount == 0) return 0.0f;
    return (float)MIN(1.0, sqrt(energy / (double)sampleCount) * 4.0);
}

API_AVAILABLE(macos(15.0))
@interface BWSystemAudioRecorder : NSObject <SCStreamDelegate, SCStreamOutput>
@property(nonatomic, strong) SCStream *stream;
@property(nonatomic, strong) AVAssetWriter *writer;
@property(nonatomic, strong) AVAssetWriterInput *systemAudioInput;
@property(nonatomic, strong) AVAssetWriterInput *microphoneInput;
@property(nonatomic, strong) NSURL *temporaryURL;
@property(nonatomic, strong) NSURL *outputURL;
@property(nonatomic, strong) NSURL *microphoneURL;
@property(nonatomic, strong) NSURL *systemAudioURL;
@property(nonatomic, strong) dispatch_queue_t sampleQueue;
@property(nonatomic, assign) BWAudioCallback startCallback;
@property(nonatomic, assign) void *startContext;
@property(nonatomic, assign) BWAudioCallback stopCallback;
@property(nonatomic, assign) void *stopContext;
@property(nonatomic, assign) BOOL finishing;
@property(nonatomic, assign) BOOL writerStarted;
- (instancetype)initWithOutputURL:(NSURL *)outputURL;
- (void)start:(BWAudioCallback)callback context:(void *)context;
- (void)stop:(BWAudioCallback)callback context:(void *)context;
@end

@implementation BWSystemAudioRecorder

- (instancetype)initWithOutputURL:(NSURL *)outputURL {
    self = [super init];
    if (self) {
        _outputURL = outputURL;
        NSString *temporaryName = [NSString stringWithFormat:@".%@.audio.m4a", outputURL.lastPathComponent];
        _temporaryURL = [[outputURL URLByDeletingLastPathComponent] URLByAppendingPathComponent:temporaryName];
        NSString *stem = outputURL.URLByDeletingPathExtension.lastPathComponent;
        NSURL *directory = outputURL.URLByDeletingLastPathComponent;
        _microphoneURL = [directory URLByAppendingPathComponent:[stem stringByAppendingString:@".microphone.m4a"]];
        _systemAudioURL = [directory URLByAppendingPathComponent:[stem stringByAppendingString:@".system_audio.m4a"]];
        _sampleQueue = dispatch_queue_create("com.bobwork.audio-capture", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (void)completeStartWithError:(NSString *)message {
    BWAudioCallback callback = self.startCallback;
    void *context = self.startContext;
    self.startCallback = NULL;
    self.startContext = NULL;
    if (!callback) return;
    if (message.length > 0) {
        BWActiveRecorder = nil;
        callback(NULL, message.UTF8String, context);
    }
    else callback("started", NULL, context);
}

- (void)completeStopWithPath:(NSString *)path error:(NSString *)message {
    if (self.finishing) return;
    self.finishing = YES;
    atomic_store(&BWCurrentAudioLevel, 0.0f);
    BWAudioCallback callback = self.stopCallback;
    void *context = self.stopContext;
    self.stopCallback = NULL;
    self.stopContext = NULL;
    BWActiveRecorder = nil;
    if (!callback) return;
    if (message.length > 0) callback(NULL, message.UTF8String, context);
    else callback(path.fileSystemRepresentation, NULL, context);
}

- (void)start:(BWAudioCallback)callback context:(void *)context {
    self.startCallback = callback;
    self.startContext = context;
    [[NSFileManager defaultManager] removeItemAtURL:self.temporaryURL error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:self.outputURL error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:self.microphoneURL error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:self.systemAudioURL error:nil];

    NSError *writerError = nil;
    self.writer = [[AVAssetWriter alloc] initWithURL:self.temporaryURL fileType:AVFileTypeAppleM4A error:&writerError];
    if (!self.writer) {
        [self completeStartWithError:BWErrorMessage(writerError, @"Impossible de préparer le fichier audio.")];
        return;
    }
    NSDictionary *audioSettings = @{
        AVFormatIDKey: @(kAudioFormatMPEG4AAC),
        AVSampleRateKey: @48000,
        AVNumberOfChannelsKey: @2,
        AVEncoderBitRateKey: @128000,
    };
    self.systemAudioInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:audioSettings];
    self.microphoneInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:audioSettings];
    self.systemAudioInput.metadata = @[BWTrackTitle(@"system_audio")];
    self.microphoneInput.metadata = @[BWTrackTitle(@"microphone")];
    self.systemAudioInput.expectsMediaDataInRealTime = YES;
    self.microphoneInput.expectsMediaDataInRealTime = YES;
    if (![self.writer canAddInput:self.systemAudioInput] || ![self.writer canAddInput:self.microphoneInput]) {
        [self completeStartWithError:@"Impossible de préparer les pistes du microphone et de l’audio du Mac."];
        return;
    }
    [self.writer addInput:self.systemAudioInput];
    [self.writer addInput:self.microphoneInput];

    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO completionHandler:^(SCShareableContent *content, NSError *contentError) {
        if (contentError || content.displays.count == 0) {
            NSString *message = BWErrorMessage(contentError, @"Aucun écran disponible pour initialiser la capture audio du Mac.");
            [self completeStartWithError:message];
            return;
        }

        SCDisplay *display = content.displays.firstObject;
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
        SCStreamConfiguration *configuration = [SCStreamConfiguration new];
        configuration.showsCursor = NO;
        configuration.capturesAudio = YES;
        configuration.excludesCurrentProcessAudio = YES;
        configuration.sampleRate = 48000;
        configuration.channelCount = 2;
        configuration.captureMicrophone = YES;

        self.stream = [[SCStream alloc] initWithFilter:filter configuration:configuration delegate:self];
        NSError *streamError = nil;
        if (![self.stream addStreamOutput:self type:SCStreamOutputTypeAudio sampleHandlerQueue:self.sampleQueue error:&streamError]) {
            [self completeStartWithError:BWErrorMessage(streamError, @"Impossible de lire l’audio du Mac.")];
            return;
        }
        if (![self.stream addStreamOutput:self type:SCStreamOutputTypeMicrophone sampleHandlerQueue:self.sampleQueue error:&streamError]) {
            [self completeStartWithError:BWErrorMessage(streamError, @"Impossible de lire le microphone.")];
            return;
        }

        [self.stream startCaptureWithCompletionHandler:^(NSError *startError) {
            if (startError) {
                [self completeStartWithError:BWErrorMessage(startError, @"Impossible de démarrer la capture audio du Mac.")];
                return;
            }
            [self completeStartWithError:nil];
        }];
    }];
}

- (void)stop:(BWAudioCallback)callback context:(void *)context {
    self.stopCallback = callback;
    self.stopContext = context;
    if (!self.stream) {
        [self completeStopWithPath:nil error:@"Aucun enregistrement audio n’est actif."];
        return;
    }
    [self.stream stopCaptureWithCompletionHandler:^(NSError *stopError) {
        if (stopError) {
            [self completeStopWithPath:nil error:BWErrorMessage(stopError, @"Impossible d’arrêter la capture audio.")];
            return;
        }
        dispatch_async(self.sampleQueue, ^{
            if (!self.writerStarted) {
                [self completeStopWithPath:nil error:@"Aucun son n’a été capté."];
                return;
            }
            [self.systemAudioInput markAsFinished];
            [self.microphoneInput markAsFinished];
            [self.writer finishWritingWithCompletionHandler:^{
                if (self.writer.status == AVAssetWriterStatusCompleted) {
                    [self exportRecordingFiles];
                } else {
                    [self completeStopWithPath:nil error:BWErrorMessage(self.writer.error, @"Impossible de finaliser les pistes audio.")];
                }
            }];
        });
    }];
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    if (self.startCallback) [self completeStartWithError:BWErrorMessage(error, @"La capture audio a été interrompue.")];
    else if (self.stopCallback) [self completeStopWithPath:nil error:BWErrorMessage(error, @"La capture audio a été interrompue.")];
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeAudio && type != SCStreamOutputTypeMicrophone) return;
    if (!CMSampleBufferDataIsReady(sampleBuffer)) return;
    float measured = BWLevelForSampleBuffer(sampleBuffer);
    float previous = atomic_load(&BWCurrentAudioLevel);
    atomic_store(&BWCurrentAudioLevel, MAX(measured, previous * 0.72f));

    if (!self.writerStarted) {
        if (![self.writer startWriting]) {
            [self completeStopWithPath:nil error:BWErrorMessage(self.writer.error, @"Impossible de démarrer l’écriture audio.")];
            return;
        }
        [self.writer startSessionAtSourceTime:CMSampleBufferGetPresentationTimeStamp(sampleBuffer)];
        self.writerStarted = YES;
    }
    AVAssetWriterInput *input = type == SCStreamOutputTypeMicrophone ? self.microphoneInput : self.systemAudioInput;
    if (input.readyForMoreMediaData && ![input appendSampleBuffer:sampleBuffer]) {
        [self completeStopWithPath:nil error:BWErrorMessage(self.writer.error, @"Impossible d’écrire l’audio capté.")];
    }
}

- (AVAssetExportSession *)exportTracks:(NSArray<AVAssetTrack *> *)tracks
                                  toURL:(NSURL *)outputURL
                                    mix:(BOOL)mixTracks {
    if (tracks.count == 0) return nil;
    AVMutableComposition *composition = [AVMutableComposition composition];
    NSMutableArray<AVMutableCompositionTrack *> *compositionTracks = [NSMutableArray array];
    for (AVAssetTrack *track in tracks) {
        AVMutableCompositionTrack *compositionTrack = [composition addMutableTrackWithMediaType:AVMediaTypeAudio preferredTrackID:kCMPersistentTrackID_Invalid];
        NSError *insertError = nil;
        if (![compositionTrack insertTimeRange:track.timeRange ofTrack:track atTime:kCMTimeZero error:&insertError]) {
            return nil;
        }
        [compositionTracks addObject:compositionTrack];
    }

    AVAssetExportSession *exporter = [[AVAssetExportSession alloc] initWithAsset:composition presetName:AVAssetExportPresetAppleM4A];
    if (!exporter) return nil;
    if (mixTracks && compositionTracks.count > 1) {
        NSMutableArray<AVAudioMixInputParameters *> *parameters = [NSMutableArray array];
        for (AVMutableCompositionTrack *track in compositionTracks) {
            AVMutableAudioMixInputParameters *input = [AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:track];
            [input setVolume:0.8f atTime:kCMTimeZero];
            [parameters addObject:input];
        }
        AVMutableAudioMix *mix = [AVMutableAudioMix audioMix];
        mix.inputParameters = parameters;
        exporter.audioMix = mix;
    }
    exporter.outputURL = outputURL;
    exporter.outputFileType = AVFileTypeAppleM4A;
    return exporter;
}

- (void)exportRecordingFiles {
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:self.temporaryURL options:nil];
    [asset loadTracksWithMediaType:AVMediaTypeAudio completionHandler:^(NSArray<AVAssetTrack *> *tracks, NSError *trackError) {
        if (trackError || tracks.count == 0) {
            [self completeStopWithPath:nil error:BWErrorMessage(trackError, @"Aucune piste audio n’a été enregistrée.")];
            return;
        }
        // Inputs are added system first, microphone second. Keep those sources
        // as separate reference files and also expose a mixed M4A for playback.
        AVAssetTrack *systemTrack = nil;
        AVAssetTrack *microphoneTrack = nil;
        for (AVAssetTrack *track in tracks) {
            NSString *title = BWTitleForTrack(track);
            if ([title isEqualToString:@"system_audio"]) systemTrack = track;
            else if ([title isEqualToString:@"microphone"]) microphoneTrack = track;
        }
        // Preserve compatibility if a macOS encoder drops common metadata.
        if (!systemTrack) systemTrack = tracks.firstObject;
        if (!microphoneTrack && tracks.count > 1) microphoneTrack = tracks[1];
        AVAssetExportSession *mixedExporter = [self exportTracks:tracks toURL:self.outputURL mix:YES];
        if (!mixedExporter) {
            [self completeStopWithPath:nil error:@"Impossible de créer le fichier audio final."];
            return;
        }

        dispatch_group_t group = dispatch_group_create();
        if (systemTrack) {
            AVAssetExportSession *systemExporter = [self exportTracks:@[systemTrack] toURL:self.systemAudioURL mix:NO];
            if (systemExporter) {
                dispatch_group_enter(group);
                [systemExporter exportAsynchronouslyWithCompletionHandler:^{
                    if (systemExporter.status != AVAssetExportSessionStatusCompleted) {
                        [[NSFileManager defaultManager] removeItemAtURL:self.systemAudioURL error:nil];
                    }
                    dispatch_group_leave(group);
                }];
            }
        }
        if (microphoneTrack) {
            AVAssetExportSession *microphoneExporter = [self exportTracks:@[microphoneTrack] toURL:self.microphoneURL mix:NO];
            if (microphoneExporter) {
                dispatch_group_enter(group);
                [microphoneExporter exportAsynchronouslyWithCompletionHandler:^{
                    if (microphoneExporter.status != AVAssetExportSessionStatusCompleted) {
                        [[NSFileManager defaultManager] removeItemAtURL:self.microphoneURL error:nil];
                    }
                    dispatch_group_leave(group);
                }];
            }
        }
        dispatch_group_enter(group);
        [mixedExporter exportAsynchronouslyWithCompletionHandler:^{
            dispatch_group_leave(group);
        }];
        dispatch_group_notify(group, self.sampleQueue, ^{
            [[NSFileManager defaultManager] removeItemAtURL:self.temporaryURL error:nil];
            if (mixedExporter.status == AVAssetExportSessionStatusCompleted) {
                // A separate source can be absent/silent on a microphone-only
                // or system-only recording. The mixed reference remains valid.
                [self completeStopWithPath:self.outputURL.path error:nil];
            } else {
                [self completeStopWithPath:nil error:BWErrorMessage(mixedExporter.error, @"Impossible de finaliser le fichier audio.")];
            }
        });
    }];
}

@end

void bw_audio_recording_start(const char *outputPath, BWAudioCallback callback, void *context) {
    if (@available(macOS 15.0, *)) {
        NSString *path = [[NSFileManager defaultManager] stringWithFileSystemRepresentation:outputPath length:strlen(outputPath)];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (BWActiveRecorder) {
                callback(NULL, "Un enregistrement audio est déjà actif.", context);
                return;
            }
            BWActiveRecorder = [[BWSystemAudioRecorder alloc] initWithOutputURL:[NSURL fileURLWithPath:path]];
            [BWActiveRecorder start:callback context:context];
        });
    } else {
        callback(NULL, "L’enregistrement du microphone et de l’audio du Mac nécessite macOS 15 ou une version ultérieure.", context);
    }
}

void bw_audio_recording_stop(BWAudioCallback callback, void *context) {
    if (@available(macOS 15.0, *)) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!BWActiveRecorder) {
                callback(NULL, "Aucun enregistrement audio n’est actif.", context);
                return;
            }
            [BWActiveRecorder stop:callback context:context];
        });
    } else {
        callback(NULL, "L’enregistrement audio natif est indisponible sur cette version de macOS.", context);
    }
}

float bw_audio_recording_level(void) {
    return atomic_load(&BWCurrentAudioLevel);
}
