import SwiftUI
import AVFoundation
import Core
import DesignSystem

@MainActor
final class ChatViewModel: ObservableObject {
    let jobId: String
    @Published var messages: [ChatMessage] = []
    @Published var draft: String = ""
    @Published var error: String?
    @Published var isRecording = false
    private var voiceRecorder: AVAudioRecorder?
    private var voiceURL: URL?
    private weak var container: AppContainer?

    init(jobId: String) { self.jobId = jobId }

    func bind(_ container: AppContainer) {
        self.container = container
        Task { await reload() }
    }

    func reload() async {
        guard let container else { return }
        messages = await container.chatRepository.cachedMessages(jobId: jobId)
        if let fresh = try? await container.chatRepository.refresh(jobId: jobId) {
            messages = fresh
        }
    }

    func sendDraft() async {
        guard let container else { return }
        let text = draft.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        draft = ""
        do {
            _ = try await container.chatRepository.send(jobId: jobId, kind: .text, body: text)
            messages = await container.chatRepository.cachedMessages(jobId: jobId)
            await container.syncEngine.drain()
            messages = await container.chatRepository.cachedMessages(jobId: jobId)
        } catch {
            self.error = String(describing: error)
        }
    }

    func sendQuickReply(_ text: String) async {
        guard let container else { return }
        do {
            _ = try await container.chatRepository.send(jobId: jobId, kind: .quickReply, body: text)
            messages = await container.chatRepository.cachedMessages(jobId: jobId)
            await container.syncEngine.drain()
        } catch {
            self.error = String(describing: error)
        }
    }

    func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .spokenAudio)
            try session.setActive(true)
            session.requestRecordPermission { _ in }
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 22050,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ]
            voiceRecorder = try AVAudioRecorder(url: url, settings: settings)
            voiceURL = url
            voiceRecorder?.record()
            isRecording = true
        } catch {
            self.error = String(describing: error)
        }
    }

    func stopRecordingAndSend() async {
        guard let recorder = voiceRecorder, let url = voiceURL else { return }
        let duration = Int(recorder.currentTime)
        recorder.stop()
        try? AVAudioSession.sharedInstance().setActive(false)
        isRecording = false
        guard let container else { return }
        do {
            _ = try await container.chatRepository.send(
                jobId: jobId, kind: .voice,
                attachmentUrl: url.absoluteString,
                durationSeconds: duration
            )
            messages = await container.chatRepository.cachedMessages(jobId: jobId)
            await container.syncEngine.drain()
        } catch {
            self.error = String(describing: error)
        }
    }
}

struct ChatScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm: ChatViewModel

    init(jobId: String) { _vm = StateObject(wrappedValue: ChatViewModel(jobId: jobId)) }

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(vm.messages) { msg in
                                bubble(msg)
                                    .id(msg.id)
                                    .frame(maxWidth: .infinity, alignment: msg.sender == .driver ? .trailing : .leading)
                            }
                        }
                        .padding(.horizontal, TCMetrics.standardPadding)
                        .padding(.vertical, TCMetrics.standardPadding)
                    }
                    .onChange(of: vm.messages.count) { _ in
                        if let last = vm.messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }
                quickReplies
                composer
            }
        }
        .navigationTitle("Chat")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { vm.bind(container) }
    }

    @ViewBuilder private func bubble(_ msg: ChatMessage) -> some View {
        let mine = msg.sender == .driver
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            HStack {
                if mine { Spacer() }
                VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                    if msg.kind == .voice {
                        Label(durationLabel(msg.durationSeconds), systemImage: "mic.fill")
                            .foregroundStyle(.white)
                            .font(TCFont.caption())
                    } else if let body = msg.body {
                        Text(body).foregroundStyle(.white).font(TCFont.body(15))
                    } else if msg.kind == .photo {
                        Image(systemName: "photo.fill").foregroundStyle(.white)
                    }
                }
                .padding(10)
                .background(mine ? TCColor.primary : TCColor.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                if !mine { Spacer() }
            }
            HStack(spacing: 4) {
                Text(msg.createdAt, style: .time).font(TCFont.caption(11)).foregroundStyle(TCColor.foregroundFaint)
                if mine { deliveryIcon(msg.deliveryState) }
            }
        }
    }

    private func deliveryIcon(_ state: ChatDeliveryState) -> some View {
        switch state {
        case .queued: return AnyView(Image(systemName: "clock").foregroundStyle(TCColor.foregroundFaint).font(.system(size: 10)))
        case .sent: return AnyView(Image(systemName: "checkmark").foregroundStyle(TCColor.foregroundFaint).font(.system(size: 10)))
        case .delivered: return AnyView(Image(systemName: "checkmark.circle").foregroundStyle(TCColor.success).font(.system(size: 10)))
        case .read: return AnyView(Image(systemName: "checkmark.circle.fill").foregroundStyle(TCColor.success).font(.system(size: 10)))
        case .failed: return AnyView(Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(TCColor.danger).font(.system(size: 10)))
        }
    }

    private func durationLabel(_ d: Int?) -> String {
        guard let d, d > 0 else { return "Voice memo" }
        let m = d / 60; let s = d % 60
        return String(format: "Voice memo %d:%02d", m, s)
    }

    private var quickReplies: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(ChatQuickReply.driverReplies, id: \.self) { reply in
                    Button(reply) {
                        Task { await vm.sendQuickReply(reply) }
                    }
                    .buttonStyle(.bordered)
                    .tint(TCColor.primary)
                }
            }
            .padding(.horizontal, TCMetrics.standardPadding)
        }
        .padding(.vertical, 6)
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Message", text: $vm.draft)
                .textFieldStyle(.roundedBorder)
            Button {
                if vm.isRecording {
                    Task { await vm.stopRecordingAndSend() }
                } else {
                    vm.startRecording()
                }
            } label: {
                Image(systemName: vm.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(vm.isRecording ? TCColor.danger : TCColor.primary)
            }
            .tcTapTarget()
            Button {
                Task { await vm.sendDraft() }
            } label: {
                Image(systemName: "paperplane.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(TCColor.primary)
            }
            .tcTapTarget()
            .disabled(vm.draft.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(.horizontal, TCMetrics.standardPadding)
        .padding(.vertical, 10)
        .background(TCColor.surfaceElevated)
    }
}
