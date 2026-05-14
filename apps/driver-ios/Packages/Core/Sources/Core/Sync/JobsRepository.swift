import Foundation

/// The repository layer the UI talks to. Reads come from the local store
/// (offline-first); writes go through the outbox and are reflected
/// optimistically in the local store before sync.
public actor JobsRepository {
    private let api: USTowDispatchAPI
    private let localStore: LocalStore
    private let outbox: Outbox

    public init(api: USTowDispatchAPI, localStore: LocalStore, outbox: Outbox) {
        self.api = api
        self.localStore = localStore
        self.outbox = outbox
    }

    public func cachedJobs() -> [MyJob] { localStore.loadJobs() }

    public func refreshFromServer() async throws -> [MyJob] {
        let jobs = try await api.myJobs()
        try localStore.saveJobs(jobs)
        return jobs
    }

    public func transition(jobId: String, to: JobStatus, reason: String? = nil) async throws {
        guard let current = localStore.loadJobs().first(where: { $0.job.id == jobId })?.job else {
            throw RepositoryError.notFound
        }
        guard JobStateMachine.canTransition(from: current.status, to: to) else {
            throw InvalidJobTransitionError(from: current.status, to: to)
        }

        let optimistic = applyStatus(to, to: current)
        try localStore.updateJob(optimistic)

        _ = try outbox.enqueue(.transition(jobId: jobId, to: to, reason: reason, attemptedAt: Date()))
    }

    public func cancel(jobId: String, reason: String) async throws {
        guard let current = localStore.loadJobs().first(where: { $0.job.id == jobId })?.job else {
            throw RepositoryError.notFound
        }
        guard JobStateMachine.canTransition(from: current.status, to: .cancelled) else {
            throw InvalidJobTransitionError(from: current.status, to: .cancelled)
        }
        let optimistic = applyStatus(.cancelled, to: current)
        try localStore.updateJob(optimistic)
        _ = try outbox.enqueue(.cancel(jobId: jobId, reason: reason, attemptedAt: Date()))
    }

    public func queuePhoto(jobId: String, request: PhotoUploadRequest) async throws {
        _ = try outbox.enqueue(.uploadPhoto(jobId: jobId, photo: request, attemptedAt: Date()))
    }

    private func applyStatus(_ status: JobStatus, to job: Job) -> Job {
        Job(
            id: job.id, tenantId: job.tenantId, jobNumber: job.jobNumber, status: status,
            serviceType: job.serviceType, customerId: job.customerId, vehicleId: job.vehicleId,
            accountId: job.accountId, pickupAddress: job.pickupAddress, pickupLat: job.pickupLat,
            pickupLng: job.pickupLng, dropoffAddress: job.dropoffAddress, dropoffLat: job.dropoffLat,
            dropoffLng: job.dropoffLng, authorizedBy: job.authorizedBy, authorizedByName: job.authorizedByName,
            rateQuotedCents: job.rateQuotedCents, notes: job.notes,
            cancelledReason: status == .cancelled ? "pending_sync" : job.cancelledReason,
            assignedDriverId: job.assignedDriverId, assignedTruckId: job.assignedTruckId,
            assignedShiftId: job.assignedShiftId, assignedAt: job.assignedAt,
            createdAt: job.createdAt, updatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }
}

public enum RepositoryError: Error {
    case notFound
}
