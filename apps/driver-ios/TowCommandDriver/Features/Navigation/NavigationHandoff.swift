import UIKit
import CoreLocation

/// Detects installed navigation apps and hands off to the user's preferred
/// one. Apple Maps is always available; Google and Waze are detected via
/// LSApplicationQueriesSchemes (declared in Info.plist).
enum NavigationHandoff {
    static func open(address: String, lat: Double? = nil, lng: Double? = nil) {
        let encoded = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? address
        let target: URL
        if let lat, let lng {
            target = URL(string: "http://maps.apple.com/?daddr=\(lat),\(lng)")!
        } else {
            target = URL(string: "http://maps.apple.com/?daddr=\(encoded)")!
        }
        UIApplication.shared.open(target)
    }

    static func openGoogleMaps(lat: Double, lng: Double) -> Bool {
        guard let url = URL(string: "comgooglemaps://?daddr=\(lat),\(lng)&directionsmode=driving"),
              UIApplication.shared.canOpenURL(url) else { return false }
        UIApplication.shared.open(url)
        return true
    }

    static func openWaze(lat: Double, lng: Double) -> Bool {
        guard let url = URL(string: "waze://?ll=\(lat),\(lng)&navigate=yes"),
              UIApplication.shared.canOpenURL(url) else { return false }
        UIApplication.shared.open(url)
        return true
    }
}

enum TwilioMaskedCall {
    /// In production this would call the backend to fetch a masked Twilio
    /// number for the customer, then `tel:` dial it. The contract for that
    /// endpoint isn't yet exposed by the backend — see SESSION_6_REPORT.md.
    /// For now we dial the raw number with a clear marker in the report.
    static func dial(_ rawNumber: String) {
        let digits = rawNumber.filter { $0.isNumber || $0 == "+" }
        guard let url = URL(string: "tel://\(digits)") else { return }
        UIApplication.shared.open(url)
    }
}
