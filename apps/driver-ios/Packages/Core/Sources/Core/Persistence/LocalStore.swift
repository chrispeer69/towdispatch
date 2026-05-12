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
    func clear() throws
}

public final class FileLocalStore: LocalStore, @unchecked Sendable {
    private let root: URL
    private let queue = DispatchQueue(label: "com.towcommand.driver.LocalStore", attributes: .concurrent)

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
