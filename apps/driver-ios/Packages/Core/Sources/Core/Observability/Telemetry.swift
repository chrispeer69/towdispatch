import Foundation
import os

/// Thin protocol abstraction so Sentry and Datadog can be wired in later
/// without churning call sites. The default impl writes structured logs to
/// `os_log`, which Console.app + Sentry's auto-breadcrumbs both pick up.
public protocol Telemetry: Sendable {
    func event(_ name: String, attributes: [String: String])
    func error(_ error: Error, attributes: [String: String])
    func breadcrumb(_ message: String, category: String)
}

public struct OSLogTelemetry: Telemetry {
    private let log = Logger(subsystem: "com.towcommand.driver", category: "app")
    public init() {}

    public func event(_ name: String, attributes: [String: String] = [:]) {
        log.info("event=\(name, privacy: .public) attrs=\(attributes.description, privacy: .public)")
    }
    public func error(_ error: Error, attributes: [String: String] = [:]) {
        log.error("error=\(String(describing: error), privacy: .public) attrs=\(attributes.description, privacy: .public)")
    }
    public func breadcrumb(_ message: String, category: String) {
        log.debug("breadcrumb=\(message, privacy: .public) cat=\(category, privacy: .public)")
    }
}

/// No-op for tests.
public struct NullTelemetry: Telemetry {
    public init() {}
    public func event(_ name: String, attributes: [String: String]) {}
    public func error(_ error: Error, attributes: [String: String]) {}
    public func breadcrumb(_ message: String, category: String) {}
}
