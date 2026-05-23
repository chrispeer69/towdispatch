import Foundation
import Core

@MainActor
final class PretripViewModel: ObservableObject {
    @Published var form: [PretripFormCategory] = PretripFormBuilder.defaultCategories
    @Published var odometerText: String = ""
    @Published var notes: String = ""
    @Published var errorMessage: String?
    @Published var isSubmitting = false

    var categoryIndices: Range<Int> { form.indices }

    func setState(categoryIdx: Int, itemIdx: Int, state: PretripItemState) {
        guard form.indices.contains(categoryIdx),
              form[categoryIdx].items.indices.contains(itemIdx) else { return }
        form[categoryIdx].items[itemIdx].state = state
        errorMessage = nil
    }

    func setNote(categoryIdx: Int, itemIdx: Int, note: String) {
        guard form.indices.contains(categoryIdx),
              form[categoryIdx].items.indices.contains(itemIdx) else { return }
        form[categoryIdx].items[itemIdx].note = note
    }

    func submit(container: AppContainer) async {
        isSubmitting = true
        defer { isSubmitting = false }
        errorMessage = nil
        let truckId = container.activeTruckId ?? "unassigned"
        do {
            let odometer = Double(odometerText.trimmingCharacters(in: .whitespaces))
            let payload = try PretripFormBuilder.buildPayload(
                form: form, truckId: truckId,
                shiftId: container.activeShiftId,
                odometerMiles: odometer,
                notes: notes.isEmpty ? nil : notes
            )
            try await container.pretripRepository.submit(payload)
            Task.detached { await container.syncEngine.drain() }
            container.markPretripSubmittedLocally()
        } catch let err as PretripValidationError {
            errorMessage = err.message
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
