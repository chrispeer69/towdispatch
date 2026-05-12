import Foundation

public enum JobStatus: String, Codable, CaseIterable, Sendable {
    case new
    case dispatched
    case enroute
    case onScene = "on_scene"
    case inProgress = "in_progress"
    case completed
    case cancelled
    case goa
}

public struct Job: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let tenantId: String
    public let jobNumber: String
    public var status: JobStatus
    public let serviceType: String
    public let customerId: String?
    public let vehicleId: String?
    public let accountId: String?
    public let pickupAddress: String
    public let pickupLat: Double?
    public let pickupLng: Double?
    public let dropoffAddress: String?
    public let dropoffLat: Double?
    public let dropoffLng: Double?
    public let authorizedBy: String
    public let authorizedByName: String?
    public let rateQuotedCents: Int64
    public let notes: String?
    public let cancelledReason: String?
    public let assignedDriverId: String?
    public let assignedTruckId: String?
    public let assignedShiftId: String?
    public let assignedAt: String?
    public let createdAt: String
    public let updatedAt: String

    public init(
        id: String,
        tenantId: String,
        jobNumber: String,
        status: JobStatus,
        serviceType: String,
        customerId: String? = nil,
        vehicleId: String? = nil,
        accountId: String? = nil,
        pickupAddress: String,
        pickupLat: Double? = nil,
        pickupLng: Double? = nil,
        dropoffAddress: String? = nil,
        dropoffLat: Double? = nil,
        dropoffLng: Double? = nil,
        authorizedBy: String,
        authorizedByName: String? = nil,
        rateQuotedCents: Int64 = 0,
        notes: String? = nil,
        cancelledReason: String? = nil,
        assignedDriverId: String? = nil,
        assignedTruckId: String? = nil,
        assignedShiftId: String? = nil,
        assignedAt: String? = nil,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.tenantId = tenantId
        self.jobNumber = jobNumber
        self.status = status
        self.serviceType = serviceType
        self.customerId = customerId
        self.vehicleId = vehicleId
        self.accountId = accountId
        self.pickupAddress = pickupAddress
        self.pickupLat = pickupLat
        self.pickupLng = pickupLng
        self.dropoffAddress = dropoffAddress
        self.dropoffLat = dropoffLat
        self.dropoffLng = dropoffLng
        self.authorizedBy = authorizedBy
        self.authorizedByName = authorizedByName
        self.rateQuotedCents = rateQuotedCents
        self.notes = notes
        self.cancelledReason = cancelledReason
        self.assignedDriverId = assignedDriverId
        self.assignedTruckId = assignedTruckId
        self.assignedShiftId = assignedShiftId
        self.assignedAt = assignedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct JobCustomer: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let phone: String?
}

public struct JobVehicle: Codable, Equatable, Sendable {
    public let id: String
    public let year: Int?
    public let make: String?
    public let model: String?
    public let color: String?
    public let plate: String?
    public let plateState: String?
    public let vin: String?
    public let specialInstructions: String?
}

public struct MyJob: Codable, Equatable, Identifiable, Sendable {
    public var id: String { job.id }
    public let job: Job
    public let customer: JobCustomer?
    public let vehicle: JobVehicle?
}
