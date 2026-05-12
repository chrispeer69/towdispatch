import SwiftUI
import VisionKit

/// VIN scanner. VisionKit's `DataScannerViewController` does barcode capture
/// on iOS 16+. This view is shown from JobDetail when the vehicle VIN is
/// missing or the driver wants to verify. Full plate-to-VIN backend roundtrip
/// is a follow-up — see SESSION_6_REPORT.md.
struct VINScannerView: View {
    var onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        Group {
            if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                DataScannerContainer(onScan: { code in
                    onScan(code); dismiss()
                })
            } else {
                VStack(spacing: 12) {
                    Text("Scanner unavailable on this device.")
                    Button("Enter VIN manually") { dismiss() }
                }
                .padding()
            }
        }
    }
}

private struct DataScannerContainer: UIViewControllerRepresentable {
    var onScan: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.code39, .code128, .qr])],
            qualityLevel: .accurate,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onScan: (String) -> Void
        init(onScan: @escaping (String) -> Void) { self.onScan = onScan }
        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in addedItems {
                if case .barcode(let bc) = item, let payload = bc.payloadStringValue, VINValidator.isValid(payload) {
                    onScan(payload)
                    return
                }
            }
        }
    }
}

enum VINValidator {
    /// Validates the VIN check digit (position 9) using the standard NHTSA
    /// algorithm. Tolerates 17-character VINs with no I, O, Q.
    static func isValid(_ raw: String) -> Bool {
        let vin = raw.uppercased()
        guard vin.count == 17 else { return false }
        guard !vin.contains(where: { "IOQ".contains($0) }) else { return false }

        let translit: [Character: Int] = [
            "A":1,"B":2,"C":3,"D":4,"E":5,"F":6,"G":7,"H":8,
            "J":1,"K":2,"L":3,"M":4,"N":5,"P":7,"R":9,
            "S":2,"T":3,"U":4,"V":5,"W":6,"X":7,"Y":8,"Z":9,
            "0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,
        ]
        let weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
        var sum = 0
        for (i, ch) in vin.enumerated() {
            guard let v = translit[ch] else { return false }
            sum += v * weights[i]
        }
        let remainder = sum % 11
        let expectedDigit = remainder == 10 ? "X" : String(remainder)
        let actual = String(vin[vin.index(vin.startIndex, offsetBy: 8)])
        return actual == expectedDigit
    }
}
