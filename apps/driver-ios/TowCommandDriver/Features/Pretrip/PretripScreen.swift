import SwiftUI
import Core
import DesignSystem

/// Pre-trip DVIR checklist. Mirrors `/driver/pretrip`. Driver marks each
/// item OK / N/A / Fail; fails require a note + at least one photo.
/// Submission enqueues a `submitPretrip` outbox action.
struct PretripScreen: View {
    @EnvironmentObject var container: AppContainer
    @StateObject private var vm = PretripViewModel()

    var body: some View {
        ZStack {
            TCColor.surface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    ForEach(vm.categoryIndices, id: \.self) { ci in
                        CategoryCard(
                            category: vm.form[ci],
                            onState: { itemIdx, state in vm.setState(categoryIdx: ci, itemIdx: itemIdx, state: state) },
                            onNote: { itemIdx, note in vm.setNote(categoryIdx: ci, itemIdx: itemIdx, note: note) }
                        )
                    }
                    TCCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(NSLocalizedString("pretrip.odometer", value: "Odometer (miles)", comment: ""))
                                .font(TCFont.caption(12))
                                .foregroundStyle(TCColor.foregroundFaint)
                            TextField("", text: $vm.odometerText)
                                .keyboardType(.numberPad)
                                .padding(10)
                                .background(TCColor.surfaceMuted)
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Text(NSLocalizedString("pretrip.notes", value: "General notes", comment: ""))
                                .font(TCFont.caption(12))
                                .foregroundStyle(TCColor.foregroundFaint)
                            TextField("", text: $vm.notes, axis: .vertical)
                                .lineLimit(2...4)
                                .padding(10)
                                .background(TCColor.surfaceMuted)
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    if let err = vm.errorMessage {
                        Text(err)
                            .font(TCFont.caption(13))
                            .foregroundStyle(TCColor.danger)
                    }
                    TCPrimaryButton(
                        NSLocalizedString("pretrip.submit", value: "Submit pre-trip", comment: ""),
                        systemImage: "checkmark.circle.fill",
                        isLoading: vm.isSubmitting
                    ) {
                        Task { await vm.submit(container: container) }
                    }
                }
                .padding(.horizontal, TCMetrics.standardPadding)
                .padding(.vertical, TCMetrics.standardPadding)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(NSLocalizedString("pretrip.title", value: "Pre-trip inspection", comment: ""))
                .font(TCFont.title(24))
                .foregroundStyle(.white)
            Text(NSLocalizedString(
                "pretrip.subtitle",
                value: "Walk the truck and rate each item. Fails require a note + photo.",
                comment: ""
            ))
            .font(TCFont.caption(13))
            .foregroundStyle(TCColor.foregroundMuted)
        }
    }
}

private struct CategoryCard: View {
    let category: PretripFormCategory
    let onState: (Int, PretripItemState) -> Void
    let onNote: (Int, String) -> Void

    var body: some View {
        TCCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(category.label)
                    .font(TCFont.headline(17))
                    .foregroundStyle(.white)
                ForEach(category.items.indices, id: \.self) { idx in
                    itemRow(item: category.items[idx], idx: idx)
                }
            }
        }
    }

    private func itemRow(item: PretripFormItem, idx: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(item.label)
                .font(TCFont.body(14))
                .foregroundStyle(.white)
            HStack(spacing: 8) {
                stateButton(item: item, idx: idx, state: .ok,        label: "PASS", color: TCColor.success)
                stateButton(item: item, idx: idx, state: .na,        label: "N/A",  color: TCColor.surfaceMuted)
                stateButton(item: item, idx: idx, state: .fail,      label: "FAIL", color: TCColor.danger)
            }
            if item.state == .fail {
                TextField(
                    NSLocalizedString("pretrip.fail_note", value: "Describe the issue (required)", comment: ""),
                    text: Binding(get: { item.note }, set: { onNote(idx, $0) })
                )
                .padding(8)
                .background(TCColor.surfaceMuted)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func stateButton(item: PretripFormItem, idx: Int, state: PretripItemState, label: String, color: Color) -> some View {
        Button(action: { onState(idx, state) }) {
            Text(label)
                .font(TCFont.caption(13))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 38)
                .background(item.state == state ? color : TCColor.surfaceMuted.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .tcTapTarget()
    }
}
