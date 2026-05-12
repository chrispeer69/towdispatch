import Foundation
import CoreLocation

public struct Geofence: Sendable {
    public let id: String
    public let center: CLLocationCoordinate2D
    public let radius: CLLocationDistance
    public let kind: Kind

    public enum Kind: String, Sendable { case pickup, dropoff, yard }

    public init(id: String, center: CLLocationCoordinate2D, radius: CLLocationDistance, kind: Kind) {
        self.id = id
        self.center = center
        self.radius = radius
        self.kind = kind
    }
}

public enum GeofenceDefaults {
    /// 75 metres — decision documented in SESSION_6_REPORT.md, configurable
    /// per-tenant in a later session.
    public static let pickupDropoffRadiusMeters: CLLocationDistance = 75
}

public enum LocationPingCadence {
    public static let activeJobInterval: TimeInterval = 5
    public static let idleInterval: TimeInterval = 60
    public static let stationaryThrottleAfter: TimeInterval = 120
}
