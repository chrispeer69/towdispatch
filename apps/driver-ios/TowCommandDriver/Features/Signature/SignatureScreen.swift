import SwiftUI
import PencilKit
import Core
import DesignSystem

struct SignatureScreen: View {
    @EnvironmentObject var container: AppContainer
    let jobId: String

    @State private var canvas = PKCanvasView()
    @State private var saving = false
    @State private var saveError: String?
    @State private var done = false

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            VStack(spacing: 12) {
                Text("Customer Signature")
                    .font(TCFont.headline())
                    .foregroundStyle(.white)
                SignatureCanvas(canvas: $canvas)
                    .frame(maxWidth: .infinity, maxHeight: 320)
                    .background(Color.white)
                    .cornerRadius(TCMetrics.cornerRadius)
                    .padding(.horizontal, TCMetrics.standardPadding)
                if let err = saveError {
                    Text(err).foregroundStyle(TCColor.danger).font(TCFont.caption())
                }
                if done {
                    Label("Signature captured", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(TCColor.success)
                }
                HStack(spacing: 12) {
                    TCSecondaryButton("Clear") {
                        canvas.drawing = PKDrawing()
                        done = false
                    }
                    TCPrimaryButton("Save", isLoading: saving) {
                        Task { await save() }
                    }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
            }
            .padding(.vertical, TCMetrics.standardPadding)
        }
        .navigationTitle("Signature")
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let bounds = CGRect(x: 0, y: 0, width: 1024, height: 320)
        let image = canvas.drawing.image(from: bounds, scale: UIScreen.main.scale)
        guard let png = image.pngData() else {
            saveError = "Could not render signature."; return
        }
        do {
            let entry = try container.photoArchive.archive(
                jobId: jobId, data: png, mimeType: "image/png", tag: .signature
            )
            let req = PhotoUploadRequest(
                fileName: entry.fileName,
                mimeType: "image/png",
                contentBase64: png.base64EncodedString(),
                capturedAt: ISO8601DateFormatter().string(from: entry.capturedAt),
                lat: entry.lat,
                lng: entry.lng,
                tag: PhotoTag.signature.rawValue
            )
            try await container.jobsRepository.queuePhoto(jobId: jobId, request: req)
            await container.syncEngine.drain()
            done = true
        } catch {
            saveError = String(describing: error)
        }
    }
}

private struct SignatureCanvas: UIViewRepresentable {
    @Binding var canvas: PKCanvasView
    func makeUIView(context: Context) -> PKCanvasView {
        canvas.drawingPolicy = .anyInput
        canvas.tool = PKInkingTool(.pen, color: .black, width: 4)
        canvas.backgroundColor = .white
        return canvas
    }
    func updateUIView(_ uiView: PKCanvasView, context: Context) {}
}
