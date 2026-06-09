import Foundation
import Network

/// Thin wrapper around NWPathMonitor surfaced as an AsyncStream. Used by the
/// app delegate to kick the sync engine when the network comes back.
public final class Reachability: @unchecked Sendable {
    public enum Status: Equatable, Sendable {
        case online(expensive: Bool)
        case offline
    }

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.towdispatch.driver.Reachability")
    private var continuation: AsyncStream<Status>.Continuation?

    public init() {}

    public lazy var statusStream: AsyncStream<Status> = {
        AsyncStream { continuation in
            self.continuation = continuation
            self.monitor.pathUpdateHandler = { [weak self] path in
                let status: Status = path.status == .satisfied
                    ? .online(expensive: path.isExpensive)
                    : .offline
                self?.continuation?.yield(status)
            }
            self.monitor.start(queue: self.queue)
            continuation.onTermination = { @Sendable _ in
                self.monitor.cancel()
            }
        }
    }()

    public var currentStatus: Status {
        let path = monitor.currentPath
        return path.status == .satisfied ? .online(expensive: path.isExpensive) : .offline
    }
}
