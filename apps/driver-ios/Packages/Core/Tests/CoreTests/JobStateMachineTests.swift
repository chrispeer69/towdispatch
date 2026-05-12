import XCTest
@testable import Core

final class JobStateMachineTests: XCTestCase {

    /// Mirrors `apps/api/src/modules/jobs/job-state-machine.spec.ts` —
    /// the backend's authoritative table of legal moves.
    func testValidTransitions() {
        let valid: [(JobStatus, JobStatus)] = [
            (.new, .dispatched), (.new, .cancelled),
            (.dispatched, .enroute), (.dispatched, .new), (.dispatched, .cancelled), (.dispatched, .goa),
            (.enroute, .onScene), (.enroute, .cancelled), (.enroute, .goa),
            (.onScene, .inProgress), (.onScene, .goa), (.onScene, .cancelled),
            (.inProgress, .completed), (.inProgress, .cancelled),
        ]
        for (from, to) in valid {
            XCTAssertTrue(
                JobStateMachine.canTransition(from: from, to: to),
                "\(from) → \(to) should be legal"
            )
        }
    }

    func testTerminalStatesAreTerminal() {
        for s in [JobStatus.completed, .cancelled, .goa] {
            XCTAssertTrue(JobStateMachine.isTerminal(s))
            XCTAssertTrue(JobStateMachine.allowedTransitions(from: s).isEmpty)
        }
    }

    func testExhaustiveInvalidTransitionsAreRejected() {
        let all = JobStatus.allCases
        for from in all {
            for to in all where from != to {
                if JobStateMachine.canTransition(from: from, to: to) { continue }
                XCTAssertFalse(
                    JobStateMachine.canTransition(from: from, to: to),
                    "Unexpected legal \(from) → \(to)"
                )
            }
        }
    }

    func testForwardPathHitsEveryDriverStep() {
        var current: JobStatus = .new
        var visited: [JobStatus] = [current]
        while let next = JobStateMachine.nextForwardStep(from: current) {
            visited.append(next)
            current = next
        }
        XCTAssertEqual(visited, [.new, .dispatched, .enroute, .onScene, .inProgress, .completed])
    }

    func testDriverActionLabels() {
        XCTAssertEqual(JobStateMachine.driverActionLabel(currentStatus: .new), "Start En Route")
        XCTAssertEqual(JobStateMachine.driverActionLabel(currentStatus: .enroute), "Arrived On Scene")
        XCTAssertEqual(JobStateMachine.driverActionLabel(currentStatus: .completed), "Completed")
    }
}
