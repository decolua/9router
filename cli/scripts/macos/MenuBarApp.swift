// 9Router menu bar app — thin control plane for the local 9router gateway.
//
// The app bundles a Node runtime + the 9router CLI in Contents/Resources and
// spawns `node cli.js --no-tray --skip-update --host 127.0.0.1` on demand.
// Menu bar shows live status (via /v1/models), start/stop, open dashboard.
//
// Build: scripts/macos/build-app.sh (no Xcode project needed).

import AppKit
import SwiftUI

let kPort = 20128
let kHost = "127.0.0.1"
let kDashboardURL = "http://127.0.0.1:\(kPort)/dashboard"

struct Status {
    var running: Bool = false
    var health: String = "checking…"
}

final class RouterController: ObservableObject {
    @Published var status = Status()
    private var child: Process?
    private var timer: Timer?

    private var resourcesDir: URL {
        Bundle.main.resourceURL!
    }
    private var nodeBin: URL {
        resourcesDir.appendingPathComponent("node/bin/node")
    }
    private var cliJs: URL {
        resourcesDir.appendingPathComponent("9router/cli.js")
    }

    init() {
        // Poll health every 5s so the menu reflects reality.
        timer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.refreshHealth()
        }
        refreshHealth()
    }

    deinit {
        timer?.invalidate()
    }

    func refreshHealth() {
        let url = URL(string: "http://\(kHost):\(kPort)/v1/models")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            DispatchQueue.main.async {
                guard let self else { return }
                if let error = error {
                    self.status = Status(running: false, health: "stopped (\(error.localizedDescription.prefix(12)))")
                } else if (200..<500).contains(code) {
                    let models = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])?["data"] as? [Any] ?? []
                    self.status = Status(running: true, health: "running · \(models.count) models")
                } else {
                    self.status = Status(running: false, health: "error \(code)")
                }
            }
        }.resume()
    }

    func start() {
        guard child == nil else { return }
        guard FileManager.default.fileExists(atPath: nodeBin.path),
              FileManager.default.fileExists(atPath: cliJs.path) else {
            status = Status(running: false, health: "bundled runtime missing")
            return
        }
        let proc = Process()
        proc.executableURL = nodeBin
        proc.arguments = [cliJs.path, "--no-tray", "--skip-update", "--host", kHost, "--port", String(kPort)]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.child = nil
                self?.refreshHealth()
            }
        }
        do {
            try proc.run()
            child = proc
            status = Status(running: false, health: "starting…")
            // First boot of the Next.js server can take ~60s; poll a bit faster.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                self?.refreshHealth()
            }
        } catch {
            status = Status(running: false, health: "start failed: \(error.localizedDescription)")
        }
    }

    func stop() {
        // Kill whatever listens on the port first (covers stale server children),
        // then terminate the CLI parent.
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-f", "9router/cli.js --no-tray"]
        try? task.run()
        task.waitUntilExit()

        if let child {
            child.terminate()
            self.child = nil
        }
        status = Status(running: false, health: "stopped")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.refreshHealth()
        }
    }

    func openDashboard() {
        NSWorkspace.shared.open(URL(string: kDashboardURL)!)
    }

    func openConfigDir() {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".9router")
        NSWorkspace.shared.open(dir)
    }
}

@main
struct NineRouterApp: App {
    @StateObject private var controller = RouterController()

    var body: some Scene {
        MenuBarExtra {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Circle()
                        .fill(controller.status.running ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                    Text(controller.status.running ? "9Router" : "9Router")
                        .fontWeight(.semibold)
                    Spacer()
                }
                Text(controller.status.health)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                Divider()

                Button(controller.status.running ? "Stop" : "Start") {
                    controller.status.running ? controller.stop() : controller.start()
                }
                .disabled(!controller.status.running && controller.status.health == "starting…")

                Button("Open Dashboard") { controller.openDashboard() }
                    .disabled(!controller.status.running)

                Button("Open Config Dir") { controller.openConfigDir() }

                Divider()

                Button("Quit") {
                    controller.stop()
                    NSApplication.shared.terminate(nil)
                }
            }
            .padding(8)
            .frame(width: 220)
        } label: {
            Image(systemName: "network")
        }
        .menuBarExtraStyle(.window)
    }
}
