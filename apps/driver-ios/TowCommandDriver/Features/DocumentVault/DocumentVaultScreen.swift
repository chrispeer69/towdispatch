import SwiftUI
import MessageUI
import UIKit
import Core
import DesignSystem

@MainActor
final class DocumentVaultViewModel: ObservableObject {
    @Published var driverDocs: [FleetDocument] = []
    @Published var expirations: ExpirationsResponse?
    @Published var error: String?
    @Published var isUploading = false

    private weak var container: AppContainer?

    func bind(_ container: AppContainer) {
        self.container = container
        Task { await refresh() }
    }

    func refresh() async {
        guard let container else { return }
        if let driverId = container.sessionSnapshot?.user.id {
            driverDocs = await container.documentsRepository.cachedDocuments(ownerId: driverId)
            do {
                let fresh = try await container.documentsRepository.refresh(ownerType: .driver, ownerId: driverId)
                driverDocs = fresh
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? "Could not refresh."
            }
        }
        expirations = await container.documentsRepository.cachedExpirations()
        do {
            expirations = try await container.documentsRepository.refreshExpirations()
        } catch {
            // 403 expected today; surface via the inline error.
            self.error = (error as? LocalizedError)?.errorDescription ?? "Could not load expirations."
        }
    }

    func queueRenewal(docType: DocumentType, imageData: Data, expiresAt: Date?) async {
        guard let container, let driverId = container.sessionSnapshot?.user.id else { return }
        isUploading = true; defer { isUploading = false }
        do {
            let request = UploadDocumentRequest(
                ownerType: .driver,
                ownerId: driverId,
                docType: docType,
                fileName: "\(docType.rawValue)-\(UUID().uuidString).jpg",
                mimeType: "image/jpeg",
                contentBase64: imageData.base64EncodedString(),
                expiresAt: expiresAt.map { ISO8601DateFormatter().string(from: $0) }
            )
            try await container.documentsRepository.queueUpload(request)
            await container.syncEngine.drain()
        } catch {
            self.error = String(describing: error)
        }
    }
}

struct DocumentVaultScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = DocumentVaultViewModel()
    @State private var showCamera = false
    @State private var pendingDocType: DocumentType?

    var body: some View {
        NavigationStack {
            ZStack {
                TCColor.surface.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        if let exp = vm.expirations {
                            expirationsCard(exp)
                        }
                        renewalActionsCard
                        documentsListCard
                        if let err = vm.error {
                            Text(err).foregroundStyle(TCColor.danger).font(TCFont.caption())
                        }
                    }
                    .padding(.horizontal, TCMetrics.standardPadding)
                    .padding(.vertical, TCMetrics.standardPadding)
                }
            }
            .navigationTitle("Documents")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task { vm.bind(container) }
        .refreshable { await vm.refresh() }
        .fullScreenCover(isPresented: $showCamera) {
            if let docType = pendingDocType {
                CameraCaptureView { data in
                    showCamera = false
                    Task { await vm.queueRenewal(docType: docType, imageData: data, expiresAt: nil) }
                } onCancel: {
                    showCamera = false
                }
            }
        }
    }

    @ViewBuilder private func expirationsCard(_ exp: ExpirationsResponse) -> some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Expirations").foregroundStyle(.white).font(TCFont.headline())
                if exp.allOrdered.isEmpty {
                    Text("Nothing expiring soon.").foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                }
                ForEach(exp.expired, id: \.id) { expirationRow($0) }
                ForEach(exp.critical, id: \.id) { expirationRow($0) }
                ForEach(exp.warning, id: \.id) { expirationRow($0) }
            }
        }
    }

    private func expirationRow(_ row: ExpirationRow) -> some View {
        HStack {
            Image(systemName: row.severity == .expired ? "exclamationmark.octagon.fill" :
                              row.severity == .critical ? "exclamationmark.triangle.fill" : "clock.fill")
                .foregroundStyle(row.severity == .expired ? TCColor.danger :
                                  row.severity == .critical ? TCColor.warning : TCColor.info)
            VStack(alignment: .leading) {
                Text(row.label).foregroundStyle(.white).font(TCFont.body(14))
                Text(row.daysUntilExpiry < 0 ? "Expired \(abs(row.daysUntilExpiry))d ago" : "in \(row.daysUntilExpiry)d")
                    .foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption(12))
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var renewalActionsCard: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("Upload renewal").foregroundStyle(.white).font(TCFont.headline())
                ForEach([DocumentType.license, .cdl, .medicalCard, .drugTest, .trainingCert], id: \.self) { dt in
                    Button {
                        pendingDocType = dt
                        showCamera = true
                    } label: {
                        HStack {
                            Image(systemName: "camera.fill").foregroundStyle(TCColor.primary)
                            Text(dt.displayName).foregroundStyle(.white)
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(TCColor.foregroundFaint)
                        }
                        .padding(.vertical, 10)
                    }
                    .tcTapTarget()
                }
            }
        }
    }

    private var documentsListCard: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 8) {
                Text("My documents").foregroundStyle(.white).font(TCFont.headline())
                if vm.driverDocs.isEmpty {
                    Text("No documents on file.").foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption())
                }
                ForEach(vm.driverDocs) { d in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(d.docType.displayName).foregroundStyle(.white).font(TCFont.body(15))
                            Text(d.fileName).foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption(12))
                            if let exp = d.expiresAt {
                                Text("Expires: \(exp.prefix(10))").foregroundStyle(TCColor.foregroundMuted).font(TCFont.caption(11))
                            }
                        }
                        Spacer()
                        Button {
                            DocumentEmailHelper.email(doc: d)
                        } label: {
                            Image(systemName: "envelope.fill").foregroundStyle(TCColor.primary)
                        }
                        .tcTapTarget()
                    }
                    .padding(.vertical, 6)
                }
            }
        }
    }
}

enum DocumentEmailHelper {
    /// Opens the default mail composer with the document URL pre-attached.
    /// Used by drivers at scene to send proof to law enforcement / insurance.
    static func email(doc: FleetDocument) {
        let subject = "TowCommand Document: \(doc.docType.displayName)"
        let body = "Document URL: \(doc.fileUrl)\n\nSent from TowCommand Driver."
        let encoded = "mailto:?subject=\(subject.urlEncoded)&body=\(body.urlEncoded)"
        if let url = URL(string: encoded) {
            UIApplication.shared.open(url)
        }
    }
}

private extension String {
    var urlEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? self
    }
}
