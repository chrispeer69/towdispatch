import Foundation

/// File-backed persistence. One JSON file per "table". This is deliberately
/// simple — it gives us offline-first behavior without a third-party SQL
/// dependency. The interface is what matters: replacing this with GRDB
/// later is a single-file swap. See SESSION_6_REPORT.md for the rationale.
public protocol LocalStore: Sendable {
    func saveJobs(_ jobs: [MyJob]) throws
    func loadJobs() -> [MyJob]
    func updateJob(_ job: Job) throws
    func saveDriverProfile(_ profile: DriverProfile) throws
    func loadDriverProfile() -> DriverProfile?

    // Session 6.1
    func upsertDvir(_ dvir: Dvir) throws
    func loadDvirs() -> [Dvir]
    func upsertDocument(_ doc: FleetDocument) throws
    func loadDocuments() -> [FleetDocument]
    func saveExpirations(_ exps: ExpirationsResponse) throws
    func loadExpirations() -> ExpirationsResponse?
    func upsertShift(_ shift: DriverShift) throws
    func loadShifts() -> [DriverShift]
    func activeShift() -> DriverShift?
    func appendChatMessage(_ message: ChatMessage) throws
    func loadChatMessages(jobId: String) -> [ChatMessage]
    func acknowledgeChatMessage(clientId: String, server: ChatMessage) throws

    func clear() throws
}

public final class FileLocalStore: LocalStore, @unchecked Sendable {
    private let root: URL
    private let queue = DispatchQueue(label: "com.ustowdispatch.driver.LocalStore", attributes: .concurrent)

    public init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    public static func defaultStore() throws -> FileLocalStore {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let root = docs.appendingPathComponent("LocalStore", isDirectory: true)
        return try FileLocalStore(root: root)
    }

    public func saveJobs(_ jobs: [MyJob]) throws {
        try writeAtomic(jobs, to: "jobs.json")
    }

    public func loadJobs() -> [MyJob] {
        (try? read([MyJob].self, from: "jobs.json")) ?? []
    }

    public func updateJob(_ job: Job) throws {
        var jobs = loadJobs()
        if let idx = jobs.firstIndex(where: { $0.job.id == job.id }) {
            jobs[idx] = MyJob(job: job, customer: jobs[idx].customer, vehicle: jobs[idx].vehicle)
            try saveJobs(jobs)
        }
    }

    public func saveDriverProfile(_ profile: DriverProfile) throws {
        try writeAtomic(profile, to: "driver_profile.json")
    }

    public func loadDriverProfile() -> DriverProfile? {
        try? read(DriverProfile.self, from: "driver_profile.json")
    }

    public func upsertDvir(_ dvir: Dvir) throws {
        var all = loadDvirs()
        if let idx = all.firstIndex(where: { $0.id == dvir.id }) {
            all[idx] = dvir
        } else {
            all.append(dvir)
        }
        try writeAtomic(all, to: "dvirs.json")
    }

    public func loadDvirs() -> [Dvir] { (try? read([Dvir].self, from: "dvirs.json")) ?? [] }

    public func upsertDocument(_ doc: FleetDocument) throws {
        var all = loadDocuments()
        if let idx = all.firstIndex(where: { $0.id == doc.id }) {
            all[idx] = doc
        } else {
            all.append(doc)
        }
        try writeAtomic(all, to: "documents.json")
    }

    public func loadDocuments() -> [FleetDocument] {
        (try? read([FleetDocument].self, from: "documents.json")) ?? []
    }

    public func saveExpirations(_ exps: ExpirationsResponse) throws {
        try writeAtomic(exps, to: "expirations.json")
    }

    public func loadExpirations() -> ExpirationsResponse? {
        try? read(ExpirationsResponse.self, from: "expirations.json")
    }

    public func upsertShift(_ shift: DriverShift) throws {
        var all = loadShifts()
        if let idx = all.firstIndex(where: { $0.id == shift.id }) {
            all[idx] = shift
        } else {
            all.append(shift)
        }
        try writeAtomic(all, to: "shifts.json")
    }

    public func loadShifts() -> [DriverShift] {
        (try? read([DriverShift].self, from: "shifts.json")) ?? []
    }

    public func activeShift() -> DriverShift? {
        loadShifts().first(where: { $0.endedAt == nil })
    }

    public func appendChatMessage(_ message: ChatMessage) throws {
        var all = loadChatMessagesAll()
        if let idx = all.firstIndex(where: { $0.id == message.id }) {
            all[idx] = message
        } else {
            all.append(message)
        }
        try writeAtomic(all, to: "chat.json")
    }

    public func loadChatMessages(jobId: String) -> [ChatMessage] {
        loadChatMessagesAll().filter { $0.jobId == jobId }
    }

    public func acknowledgeChatMessage(clientId: String, server: ChatMessage) throws {
        var all = loadChatMessagesAll()
        if let idx = all.firstIndex(where: { $0.id == clientId }) {
            all[idx] = server
        } else {
            all.append(server)
        }
        try writeAtomic(all, to: "chat.json")
    }

    private func loadChatMessagesAll() -> [ChatMessage] {
        (try? read([ChatMessage].self, from: "chat.json")) ?? []
    }

    public func clear() throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: root.path) {
            try fm.removeItem(at: root)
            try fm.createDirectory(at: root, withIntermediateDirectories: true)
        }
    }

    private func writeAtomic<T: Encodable>(_ value: T, to fileName: String) throws {
        let url = root.appendingPathComponent(fileName)
        let data = try JSONEncoder.iso.encode(value)
        try data.write(to: url, options: .atomic)
    }

    private func read<T: Decodable>(_ type: T.Type, from fileName: String) throws -> T {
        let url = root.appendingPathComponent(fileName)
        let data = try Data(contentsOf: url)
        return try JSONDecoder.iso.decode(type, from: data)
    }
}
