#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <stdbool.h>
#import <math.h>
#import <string.h>

typedef void (*BWTranscriptionCallback)(const char *result, const char *error, void *context);

@interface BWLocalAudioTranscription : NSObject
@property(nonatomic, strong) SFSpeechRecognizer *recognizer;
@property(nonatomic, strong) SFSpeechRecognitionTask *task;
@property(nonatomic, copy) NSString *localeIdentifier;
@property(nonatomic, assign) BWTranscriptionCallback callback;
@property(nonatomic, assign) void *context;
@property(nonatomic, assign) BOOL completed;
- (instancetype)initWithPath:(NSString *)path
                      locale:(NSString *)localeIdentifier
                    callback:(BWTranscriptionCallback)callback
                     context:(void *)context;
- (void)startWithPath:(NSString *)path;
@end

static NSMutableSet<BWLocalAudioTranscription *> *BWActiveTranscriptions;

@implementation BWLocalAudioTranscription

- (instancetype)initWithPath:(NSString *)path
                      locale:(NSString *)localeIdentifier
                    callback:(BWTranscriptionCallback)callback
                     context:(void *)context {
    self = [super init];
    if (self) {
        _callback = callback;
        _context = context;
        NSString *preferredIdentifier = localeIdentifier;
        if (preferredIdentifier.length == 0) {
            preferredIdentifier = [NSLocale preferredLanguages].firstObject;
        }
        NSLocale *locale = preferredIdentifier.length > 0
            ? [[NSLocale alloc] initWithLocaleIdentifier:preferredIdentifier]
            : [NSLocale currentLocale];
        _localeIdentifier = locale.localeIdentifier ?: @"";
        _recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
    }
    return self;
}

- (void)completeWithText:(NSString *)text error:(NSString *)message {
    if (self.completed) return;
    self.completed = YES;
    BWTranscriptionCallback callback = self.callback;
    void *context = self.context;
    self.callback = NULL;
    self.context = NULL;
    [self.task cancel];
    self.task = nil;
    [BWActiveTranscriptions removeObject:self];
    if (!callback) return;
    if (message.length > 0) callback(NULL, message.UTF8String, context);
    else callback(text.UTF8String, NULL, context);
}

- (void)startWithPath:(NSString *)path {
    if (!self.recognizer) {
        [self completeWithText:nil error:@"La langue de transcription n’est pas prise en charge par macOS."];
        return;
    }
    NSURL *url = [NSURL fileURLWithPath:path];
    if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
        [self completeWithText:nil error:@"Le fichier audio à transcrire est introuvable."];
        return;
    }

    SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:url];
    request.requiresOnDeviceRecognition = YES;
    request.shouldReportPartialResults = NO;
    __weak BWLocalAudioTranscription *weakSelf = self;
    self.task = [self.recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
        BWLocalAudioTranscription *strongSelf = weakSelf;
        if (!strongSelf || strongSelf.completed) return;
        if (result.isFinal) {
            NSString *text = result.bestTranscription.formattedString ?: @"";
            if (text.length == 0) {
                [strongSelf completeWithText:nil error:@"Aucune parole intelligible n’a été détectée dans l’enregistrement."];
            } else {
                NSMutableArray<NSDictionary *> *segments = [NSMutableArray array];
                for (SFTranscriptionSegment *segment in result.bestTranscription.segments) {
                    NSString *segmentText = [segment.substring stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
                    if (segmentText.length == 0) continue;
                    [segments addObject:@{
                        @"startMs": @((long long)llround(MAX(0, segment.timestamp) * 1000.0)),
                        @"durationMs": @((long long)llround(MAX(0, segment.duration) * 1000.0)),
                        @"text": segmentText,
                    }];
                }
                if (segments.count == 0) {
                    [segments addObject:@{ @"startMs": @0, @"durationMs": @0, @"text": text }];
                }
                NSDictionary *payload = @{
                    @"locale": strongSelf.localeIdentifier ?: @"",
                    @"segments": segments,
                };
                NSError *jsonError = nil;
                NSData *json = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&jsonError];
                NSString *encoded = json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : nil;
                if (!encoded) {
                    [strongSelf completeWithText:nil error:(jsonError.localizedDescription ?: @"Impossible de structurer la transcription Apple.")];
                } else {
                    [strongSelf completeWithText:encoded error:nil];
                }
            }
            return;
        }
        if (error) {
            NSString *message = error.localizedDescription.length > 0
                ? error.localizedDescription
                : @"La transcription locale Apple a échoué.";
            [strongSelf completeWithText:nil error:message];
        }
    }];
}

@end

void bw_transcribe_audio_file_legacy(
    const char *audioPath,
    const char *localeIdentifier,
    BWTranscriptionCallback callback,
    void *context
) {
    if (!audioPath || strlen(audioPath) == 0) {
        callback(NULL, "Chemin audio manquant.", context);
        return;
    }
    NSString *path = [[NSFileManager defaultManager]
        stringWithFileSystemRepresentation:audioPath
        length:strlen(audioPath)];
    NSString *locale = localeIdentifier && strlen(localeIdentifier) > 0
        ? [NSString stringWithUTF8String:localeIdentifier]
        : @"";
    dispatch_async(dispatch_get_main_queue(), ^{
        static dispatch_once_t onceToken;
        dispatch_once(&onceToken, ^{
            BWActiveTranscriptions = [NSMutableSet set];
        });
        if ([SFSpeechRecognizer authorizationStatus] != SFSpeechRecognizerAuthorizationStatusAuthorized) {
            callback(NULL, "La reconnaissance vocale n’est pas autorisée pour Bob Work.", context);
            return;
        }
        BWLocalAudioTranscription *transcription = [[BWLocalAudioTranscription alloc]
            initWithPath:path
            locale:locale
            callback:callback
            context:context];
        [BWActiveTranscriptions addObject:transcription];
        [transcription startWithPath:path];
    });
}
