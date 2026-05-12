import Foundation

/// Mirror of `apps/api/src/modules/jobs/job-state-machine.ts`.
///
/// Transition map:
///   new          → dispatched, cancelled
///   dispatched   → enroute, new, cancelled, goa
///   enroute      → on_scene, cancelled, goa
///   on_scene     → in_progress, goa, cancelled
///   in_progress  → completed, cancelled
///   completed    → (terminal)
///   cancelled    → (terminal)
///   goa          → (terminal)
public enum JobStateMachine {
    private static let transitionMap: [JobStatus: [JobStatus]] = [
        .new: [.dispatched, .cancelled],
        .dispatched: [.enroute, .new, .cancelled, .goa],
        .enroute: [.onScene, .cancelled, .goa],
        .onScene: [.inProgress, .goa, .cancelled],
        .inProgress: [.completed, .cancelled],
        .completed: [],
        .cancelled: [],
        .goa: [],
    ]

    public static let terminalStatuses: Set<JobStatus> = [.completed, .cancelled, .goa]

    public static func canTransition(from: JobStatus, to: JobStatus) -> Bool {
        transitionMap[from]?.contains(to) ?? false
    }

    public static func allowedTransitions(from: JobStatus) -> [JobStatus] {
        transitionMap[from] ?? []
    }

    public static func isTerminal(_ status: JobStatus) -> Bool {
        terminalStatuses.contains(status)
    }

    /// The primary driver-facing forward path used by the active job screen.
    public static func nextForwardStep(from: JobStatus) -> JobStatus? {
        switch from {
        case .new: return .dispatched
        case .dispatched: return .enroute
        case .enroute: return .onScene
        case .onScene: return .inProgress
        case .inProgress: return .completed
        default: return nil
        }
    }

    public static func driverActionLabel(currentStatus: JobStatus) -> String {
        switch currentStatus {
        case .new, .dispatched: return "Start En Route"
        case .enroute: return "Arrived On Scene"
        case .onScene: return "Load & Tow"
        case .inProgress: return "Complete Drop"
        case .completed: return "Completed"
        case .cancelled: return "Cancelled"
        case .goa: return "Gone On Arrival"
        }
    }
}

public struct InvalidJobTransitionError: Error, Equatable {
    public let from: JobStatus
    public let to: JobStatus
}
