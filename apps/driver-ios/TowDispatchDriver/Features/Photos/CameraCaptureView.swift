import SwiftUI
import AVFoundation
import UIKit

/// AVFoundation-backed photo capture. Wraps `AVCapturePhotoOutput` in a
/// SwiftUI container with rotation-safe preview. Production capture is
/// HEIC-preferred; we deliver JPEG bytes to the caller because that's the
/// upload format the backend currently accepts. The original HEIC sits in
/// PhotoArchive (see Core/PhotoArchive.swift).
struct CameraCaptureView: UIViewControllerRepresentable {
    var onCapture: (Data) -> Void
    var onCancel: () -> Void

    func makeUIViewController(context: Context) -> CameraCaptureViewController {
        let vc = CameraCaptureViewController()
        vc.onCapture = onCapture
        vc.onCancel = onCancel
        return vc
    }
    func updateUIViewController(_ uiViewController: CameraCaptureViewController, context: Context) {}
}

final class CameraCaptureViewController: UIViewController, AVCapturePhotoCaptureDelegate {
    var onCapture: ((Data) -> Void)?
    var onCancel: (() -> Void)?

    private let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private var previewLayer: AVCaptureVideoPreviewLayer?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureSession()
        configureUI()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.startRunning()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.session.stopRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .photo
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input),
              session.canAddOutput(output) else {
            session.commitConfiguration()
            return
        }
        session.addInput(input)
        session.addOutput(output)
        session.commitConfiguration()

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        view.layer.insertSublayer(preview, at: 0)
        self.previewLayer = preview
    }

    private func configureUI() {
        let shutter = UIButton(type: .system)
        shutter.translatesAutoresizingMaskIntoConstraints = false
        shutter.setTitle("●", for: .normal)
        shutter.setTitleColor(.white, for: .normal)
        shutter.titleLabel?.font = .systemFont(ofSize: 64)
        shutter.addTarget(self, action: #selector(snap), for: .touchUpInside)
        view.addSubview(shutter)
        NSLayoutConstraint.activate([
            shutter.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutter.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            shutter.widthAnchor.constraint(equalToConstant: 80),
            shutter.heightAnchor.constraint(equalToConstant: 80),
        ])

        let cancel = UIButton(type: .system)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.setTitle("Cancel", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            cancel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            cancel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
        ])
    }

    @objc private func snap() {
        let settings = AVCapturePhotoSettings()
        output.capturePhoto(with: settings, delegate: self)
    }

    @objc private func cancelTapped() { onCancel?() }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard let data = photo.fileDataRepresentation() else { return }
        onCapture?(data)
    }
}
