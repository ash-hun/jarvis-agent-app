import Speech
import Capacitor

private let NO_SPEECH_DOMAIN = "kAFAssistantErrorDomain"
private let NO_SPEECH_CODE = 1110

// 앱이 녹음한 WAV 를 Apple 음성 인식기로 받아 적는다. 마이크는 웹 쪽 하나만 쓰고 여기서는 파일만 읽는다
// (webkitSpeechRecognition 은 마이크를 따로 잡아 웨이크워드 캡처와 부딪힌다)
@objc(SpeechPlugin)
class SpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SpeechPlugin"
    let jsName = "Speech"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "transcribe", returnType: CAPPluginReturnPromise)
    ]

    private var task: SFSpeechRecognitionTask?

    @objc func transcribe(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let wav = Data(base64Encoded: b64) else {
            return call.reject("no audio")
        }
        let lang = call.getString("lang") ?? "ko-KR"
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else { return call.reject("speech recognition not authorized") }
                self.recognize(wav, lang: lang, call: call)
            }
        }
    }

    private func recognize(_ wav: Data, lang: String, call: CAPPluginCall) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)), recognizer.isAvailable else {
            return call.reject("recognizer unavailable")
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("stt.wav")
        do { try wav.write(to: url) } catch { return call.reject(error.localizedDescription) }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        request.addsPunctuation = true
        task?.cancel()
        task = recognizer.recognitionTask(with: request) { result, error in
            if let error = error as NSError? {
                // 말이 없었다. 빈 글로 돌려줘 서버 whisper 로 넘어가지 않게 한다(조용한 녹음에서 말을 지어낸다)
                if error.domain == NO_SPEECH_DOMAIN && error.code == NO_SPEECH_CODE { return call.resolve(["text": ""]) }
                return call.reject(error.localizedDescription)
            }
            guard let result = result, result.isFinal else { return }
            call.resolve(["text": result.bestTranscription.formattedString])
        }
    }
}

class BridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SpeechPlugin())
    }
}
