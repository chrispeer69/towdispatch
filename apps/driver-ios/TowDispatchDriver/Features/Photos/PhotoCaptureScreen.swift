import SwiftUI
import AVFoundation
import Core
import DesignSystem

@MainActor
final class PhotoCaptureViewModel: ObservableObject {
    @Published var capturedTags: Set<PhotoTag> = []
    @Published var lastError: String?
    @Published var isSaving = false

    private weak var container: AppContainer?
    let jobId: String

    init(jobId: String) { self.jobId = jobId }
    func bind(_ container: AppContainer) { self.container = container }

    func capture(tag: PhotoTag, imageData: Data, mimeType: String) async {
        guard let container else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let entry = try container.photoArchive.archive(
                jobId: jobId, data: imageData, mimeType: mimeType, tag: tag
            )
            let req = PhotoUploadRequest(
                fileName: entry.fileName,
                mimeType: entry.mimeType,
                contentBase64: imageData.base64EncodedString(),
                capturedAt: ISO8601DateFormatter().string(from: entry.capturedAt),
                lat: entry.lat,
                lng: entry.lng,
                tag: tag.rawValue
            )
            try await container.jobsRepository.queuePhoto(jobId: jobId, request: req)
            capturedTags.insert(tag)
            await container.syncEngine.drain()
        } catch {
            lastError = String(describing: error)
        }
    }

    var remainingPreTow: [PhotoTag] {
        PhotoSet.mandatoryPreTow.filter { !capturedTags.contains($0) }
    }
}

struct PhotoCaptureScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm: PhotoCaptureViewModel
    @State private var showingCamera = false
    @State private var pendingTag: PhotoTag?

    init(jobId: String) { _vm = StateObject(wrappedValue: PhotoCaptureViewModel(jobId: jobId)) }

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 12) {
                    section("Pre-Tow (mandatory)", tags: PhotoSet.mandatoryPreTow)
                    section("Post-Drop", tags: PhotoSet.mandatoryPostDrop)
                    section("Optional", tags: [.goa, .impound, .personalProperty])
                    if let err = vm.lastError {
                        Text(err).font(TCFont.caption()).foregroundStyle(TCColor.danger)
                    }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                .padding(.vertical, TCMetrics.standardPadding)
            }
        }
        .navigationTitle("Photos")
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { vm.bind(container) }
        .fullScreenCover(isPresented: $showingCamera) {
            if let tag = pendingTag {
                CameraCaptureView { data in
                    showingCamera = false
                    Task { await vm.capture(tag: tag, imageData: data, mimeType: "image/jpeg") }
                } onCancel: {
                    showingCamera = false
                }
            }
        }
    }

    @ViewBuilder private func section(_ title: String, tags: [PhotoTag]) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(title).font(TCFont.headline()).foregroundStyle(.white)
                ForEach(tags, id: \.self) { tag in
                    HStack {
                        Image(systemName: vm.capturedTags.contains(tag) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(vm.capturedTags.contains(tag) ? TCColor.success : TCColor.foregroundFaint)
                        Text(tag.displayName).foregroundStyle(.white)
                        Spacer()
                        Button("Capture") {
                            pendingTag = tag
                            showingCamera = true
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(TCColor.primary)
                        .tcTapTarget()
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }
}
