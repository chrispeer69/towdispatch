import Foundation

/// Local full-resolution photo retention until server ack. Photos live in the
/// app's Caches directory keyed by a UUID, with a sidecar JSON describing
/// metadata. The `PhotoUploadRequest` placed in the outbox references the
/// archive entry. On successful upload, the file is deleted.
public final class PhotoArchive: @unchecked Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public let id: UUID
        public let jobId: String
        public let tag: String?
        public let capturedAt: Date
        public let lat: Double?
        public let lng: Double?
        public let mimeType: String
        public let fileName: String
    }

    private let root: URL

    public init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    public static func defaultArchive() throws -> PhotoArchive {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return try PhotoArchive(root: caches.appendingPathComponent("PhotoArchive", isDirectory: true))
    }

    /// Writes the photo bytes and metadata to disk, returns the archive entry.
    public func archive(jobId: String, data: Data, mimeType: String, tag: PhotoTag?, capturedAt: Date = Date(), lat: Double? = nil, lng: Double? = nil) throws -> Entry {
        let id = UUID()
        let ext = mimeType == "image/heic" ? "heic" : "jpg"
        let fileName = "\(id.uuidString).\(ext)"
        let fileURL = root.appendingPathComponent(fileName)
        try data.write(to: fileURL, options: .atomic)
        let entry = Entry(
            id: id, jobId: jobId, tag: tag?.rawValue,
            capturedAt: capturedAt, lat: lat, lng: lng,
            mimeType: mimeType, fileName: fileName
        )
        let sidecar = root.appendingPathComponent("\(id.uuidString).json")
        try JSONEncoder.iso.encode(entry).write(to: sidecar, options: .atomic)
        return entry
    }

    public func data(for entry: Entry) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(entry.fileName))
    }

    public func delete(entry: Entry) throws {
        try? FileManager.default.removeItem(at: root.appendingPathComponent(entry.fileName))
        try? FileManager.default.removeItem(at: root.appendingPathComponent("\(entry.id.uuidString).json"))
    }
}
