import AppKit
import UniformTypeIdentifiers
import WebKit

private let workbookType = UTType(filenameExtension: "xlsx") ?? .spreadsheet
private let fileLimit = 35 * 1024 * 1024
private let storagePreference = "registerFolder"
private let semestersPreference = "semesterFolders"
private struct CatalogEntry: Codable {
    let key: String
    let name: String
}

private enum AppError: LocalizedError {
    case invalidRequest, invalidWorkbook, tooLarge, unavailableFolder, conflictingCopy(String), trashFailed, restoreFailed(URL)

    var errorDescription: String? {
        switch self {
        case .invalidRequest: return "La operación solicitada no es válida."
        case .invalidWorkbook: return "Selecciona un archivo de Excel con extensión .xlsx."
        case .tooLarge: return "Selecciona un Excel de hasta 35 MB."
        case .unavailableFolder: return "La carpeta de datos no está disponible. Conecta el disco o devuelve la carpeta a su ubicación para recuperar las listas."
        case .conflictingCopy(let name): return "El destino contiene una versión diferente de «\(name)». Elige otra carpeta para conservar ambas versiones."
        case .trashFailed: return "No se pudo enviar la lista a la papelera. Se conservó en Docencia."
        case .restoreFailed(let folder): return "No se pudo restaurar la lista automáticamente. Revisa la carpeta «\(folder.path)»."
        }
    }
}

private struct RegisterStore {
    let root: URL
    private let fm = FileManager.default

    func catalog() throws -> [String: Any] {
        guard accessible else {
            return ["lists": [], "archived": [], "active": NSNull(), "folder": root.path, "available": false]
        }
        let links = try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
        func entries(_ ext: String) -> [[String: String]] {
            links.filter { $0.pathExtension == ext }.compactMap { item -> CatalogEntry? in
                guard let entry = try? JSONDecoder().decode(CatalogEntry.self, from: Data(contentsOf: item)),
                      item.deletingPathExtension().lastPathComponent == entry.key,
                      let workbook = try? path(entry.key, "xlsx"), fm.fileExists(atPath: workbook.path)
                else { return nil }
                return entry
            }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
             .map { ["key": $0.key, "name": $0.name] }
        }
        let lists = entries("json")
        let active = UserDefaults.standard.string(forKey: "activeWorkbook")
        return [
            "lists": lists, "archived": entries("archived"),
            "active": lists.first { $0["key"] == active }?["key"] as Any? ?? NSNull(),
            "folder": root.path, "available": true
        ]
    }

    var accessible: Bool {
        var directory: ObjCBool = false
        return fm.fileExists(atPath: root.path, isDirectory: &directory) && directory.boolValue
    }

    func path(_ key: String, _ ext: String) throws -> URL {
        guard key.range(
            of: #"^docencia[.]calificaciones[.]v1[.][0-9]{1,8}[.][0-9]{1,10}$"#,
            options: .regularExpression
        ) != nil else { throw AppError.invalidRequest }
        return root.appendingPathComponent(key).appendingPathExtension(ext)
    }

    func register(_ key: String, name: String, bytes: Data) throws {
        guard accessible else { throw AppError.unavailableFolder }
        let workbook = try path(key, "xlsx")
        if fm.fileExists(atPath: workbook.path) {
            guard try Data(contentsOf: workbook) == bytes else { throw AppError.conflictingCopy(name) }
        } else {
            try bytes.write(to: workbook, options: .atomic)
        }
        let item = CatalogEntry(key: key, name: name)
        let archived = try path(key, "archived")
        if fm.fileExists(atPath: archived.path), !fm.fileExists(atPath: try path(key, "json").path) {
            try setArchived(false, key: key)
        }
        try JSONEncoder().encode(item).write(to: path(key, "json"), options: .atomic)
    }

    func load(_ key: String) throws -> [String: String] {
        let entry = try JSONDecoder().decode(CatalogEntry.self, from: Data(contentsOf: path(key, "json")))
        let workbook = try Data(contentsOf: path(key, "xlsx"))
        return ["name": entry.name, "bytes": workbook.base64EncodedString()]
    }

    func restore(_ key: String) throws -> Any {
        guard accessible else { throw AppError.unavailableFolder }
        let draft = try path(key, "draft")
        if !fm.fileExists(atPath: draft.path) { return NSNull() }
        return try String(contentsOf: draft, encoding: .utf8)
    }

    func save(_ key: String, draft: String) throws {
        guard accessible else { throw AppError.unavailableFolder }
        guard fm.fileExists(atPath: try path(key, "json").path) else { throw AppError.invalidRequest }
        try Data(draft.utf8).write(to: path(key, "draft"), options: .atomic)
        UserDefaults.standard.set(key, forKey: "activeWorkbook")
    }

    func setArchived(_ archived: Bool, key: String) throws {
        let from = try path(key, archived ? "json" : "archived")
        let to = try path(key, archived ? "archived" : "json")
        try fm.moveItem(at: from, to: to)
    }

    func deleteList(_ key: String, trash: (URL) throws -> Void) throws {
        guard accessible else { throw AppError.unavailableFolder }
        let metadata = try path(key, "json")
        let workbook = try path(key, "xlsx")
        let draft = try path(key, "draft")
        let entry = try JSONDecoder().decode(CatalogEntry.self, from: Data(contentsOf: metadata))
        guard entry.key == key, fm.fileExists(atPath: workbook.path) else { throw AppError.invalidRequest }
        let stage = root.appendingPathComponent("Lista eliminada de Docencia - " + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var moved: [(source: URL, destination: URL)] = []
        do {
            for source in [metadata, workbook, draft] {
                if source == draft && !fm.fileExists(atPath: source.path) { continue }
                let destination = stage.appendingPathComponent(source.lastPathComponent)
                try fm.moveItem(at: source, to: destination)
                moved.append((source, destination))
            }
            try trash(stage)
        } catch {
            do {
                for item in moved.reversed() { try fm.moveItem(at: item.destination, to: item.source) }
                try fm.removeItem(at: stage)
            } catch {
                throw AppError.restoreFailed(stage)
            }
            throw AppError.trashFailed
        }
    }

    func copied(to target: URL) throws -> RegisterStore {
        guard accessible else { throw AppError.unavailableFolder }
        let source = root.resolvingSymlinksInPath().standardizedFileURL
        let destination = target.resolvingSymlinksInPath().standardizedFileURL
        if source.path == destination.path { return self }
        guard !destination.path.hasPrefix(source.path + "/"), !source.path.hasPrefix(destination.path + "/")
        else { throw AppError.invalidRequest }
        let next = RegisterStore(root: destination)
        let files = try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
        let supported = Set(["json", "xlsx", "draft", "archived"])
        let entries = files.filter { file in
            supported.contains(file.pathExtension) &&
            (try? path(file.deletingPathExtension().lastPathComponent, file.pathExtension)) != nil &&
            (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
        }
        if next.accessible {
            for file in entries {
                let existing = destination.appendingPathComponent(file.lastPathComponent)
                let alternate = file.pathExtension == "json" ? "archived" : file.pathExtension == "archived" ? "json" : nil
                if let alternate, fm.fileExists(atPath: existing.deletingPathExtension().appendingPathExtension(alternate).path) {
                    throw AppError.conflictingCopy(file.lastPathComponent)
                }
                if fm.fileExists(atPath: existing.path), !fm.contentsEqual(atPath: file.path, andPath: existing.path) {
                    throw AppError.conflictingCopy(file.lastPathComponent)
                }
            }
        }
        let stage = destination.deletingLastPathComponent().appendingPathComponent(".docencia-" + UUID().uuidString)
        try fm.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: stage) }
        for file in entries {
            let copy = stage.appendingPathComponent(file.lastPathComponent)
            try fm.copyItem(at: file, to: copy)
            guard fm.contentsEqual(atPath: file.path, andPath: copy.path) else { throw AppError.conflictingCopy(file.lastPathComponent) }
        }
        if next.accessible {
            for file in entries {
                let path = destination.appendingPathComponent(file.lastPathComponent)
                if !fm.fileExists(atPath: path.path) {
                    try fm.moveItem(at: stage.appendingPathComponent(file.lastPathComponent), to: path)
                }
            }
        } else {
            try fm.moveItem(at: stage, to: destination)
        }
        return next
    }
}

private final class Docencia: NSObject, NSApplicationDelegate, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var store: RegisterStore
    private var quitting = false

    init(root: URL) throws {
        if let selected = UserDefaults.standard.string(forKey: storagePreference) {
            store = RegisterStore(root: URL(fileURLWithPath: selected, isDirectory: true))
        } else {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            store = RegisterStore(root: root)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenus()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "docencia")
        if #available(macOS 13.3, *) {
            configuration.preferences.isElementFullscreenEnabled = false
        }
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1110, height: 790),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "Docencia"
        window.minSize = NSSize(width: 700, height: 470)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("Docencia.main")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
        guard let page = Bundle.main.url(forResource: "index", withExtension: "html") else {
            NSAlert(error: AppError.invalidRequest).runModal()
            NSApp.terminate(nil)
            return
        }
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let page = Bundle.main.url(forResource: "index", withExtension: "html")?.standardizedFileURL
        decisionHandler(action.request.url?.standardizedFileURL == page ? .allow : .cancel)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let request = message.body as? [String: Any],
              let action = request["action"] as? String else {
            replyHandler(nil, AppError.invalidRequest.localizedDescription)
            return
        }
        do {
            let key = request["key"] as? String ?? ""
            switch action {
            case "catalog":
                replyHandler(try catalogWithSemesters(), nil)
            case "revealFolder":
                guard store.accessible else { throw AppError.unavailableFolder }
                NSWorkspace.shared.open(store.root)
                replyHandler(true, nil)
            case "chooseFolder":
                chooseFolder(replyHandler)
            case "newAcademicTerm":
                replyHandler(try startAcademicTerm(), nil)
            case "openAcademicTerm":
                guard semesterFolders.contains(key) else { throw AppError.invalidRequest }
                replyHandler(try switchAcademicTerm(to: URL(fileURLWithPath: key, isDirectory: true)), nil)
            case "archive", "unarchive":
                try store.setArchived(action == "archive", key: key)
                replyHandler(try catalogWithSemesters(), nil)
            case "deleteList":
                try store.deleteList(key) { try FileManager.default.trashItem(at: $0, resultingItemURL: nil) }
                replyHandler(try catalogWithSemesters(), nil)
            case "restore":
                replyHandler(try store.restore(key), nil)
            case "load":
                replyHandler(try store.load(key), nil)
            case "save":
                guard let draft = request["draft"] as? String else { throw AppError.invalidRequest }
                try store.save(key, draft: draft)
                replyHandler(true, nil)
            case "remember":
                let (name, bytes) = try filePayload(request)
                try store.register(key, name: name, bytes: bytes)
                replyHandler(try catalogWithSemesters(), nil)
            case "choose":
                chooseWorkbook(replyHandler)
            case "export":
                let (name, bytes) = try filePayload(request)
                saveWorkbook(name: name, bytes: bytes, reply: replyHandler)
            case "confirm":
                guard let text = request["message"] as? String else { throw AppError.invalidRequest }
                let alert = NSAlert()
                alert.messageText = text
                alert.addButton(withTitle: "Continuar")
                alert.addButton(withTitle: "Cancelar")
                alert.beginSheetModal(for: window) { result in
                    replyHandler(result == .alertFirstButtonReturn, nil)
                }
            default:
                throw AppError.invalidRequest
            }
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }

    private func filePayload(_ request: [String: Any]) throws -> (String, Data) {
        guard let name = request["name"] as? String, !name.isEmpty,
              (name as NSString).pathExtension.lowercased() == "xlsx",
              let encoded = request["bytes"] as? String,
              let bytes = Data(base64Encoded: encoded) else { throw AppError.invalidWorkbook }
        return ((name as NSString).lastPathComponent, bytes)
    }

    private var semesterFolders: [String] {
        UserDefaults.standard.stringArray(forKey: semestersPreference) ?? []
    }

    private func catalogWithSemesters() throws -> [String: Any] {
        var catalog = try store.catalog()
        catalog["semesters"] = semesterFolders.filter { $0 != store.root.path }
        return catalog
    }

    private func startAcademicTerm() throws -> [String: Any] {
        guard store.accessible else { throw AppError.unavailableFolder }
        let parent = store.root.deletingLastPathComponent()
        let name = "Docencia - Semestres"
        let container = parent.lastPathComponent == name ? parent : parent.appendingPathComponent(name, isDirectory: true)
        let date = DateFormatter()
        date.locale = Locale(identifier: "en_US_POSIX")
        date.dateFormat = "yyyy-MM-dd HHmmss"
        let title = "Semestre " + date.string(from: Date())
        let fm = FileManager.default
        try fm.createDirectory(at: container, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var folder = container.appendingPathComponent(title, isDirectory: true)
        var suffix = 2
        while fm.fileExists(atPath: folder.path) {
            folder = container.appendingPathComponent(title + " (" + String(suffix) + ")", isDirectory: true)
            suffix += 1
        }
        try fm.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        return try switchAcademicTerm(to: folder)
    }

    private func switchAcademicTerm(to folder: URL) throws -> [String: Any] {
        let next = RegisterStore(root: folder)
        guard next.accessible else { throw AppError.unavailableFolder }
        var catalog = try next.catalog()
        var paths = semesterFolders.filter { $0 != next.root.path && $0 != store.root.path }
        paths.insert(store.root.path, at: 0)
        UserDefaults.standard.set(paths, forKey: semestersPreference)
        UserDefaults.standard.set(next.root.path, forKey: storagePreference)
        store = next
        catalog["semesters"] = paths
        return catalog
    }

    private func chooseWorkbook(_ reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "Importar lista de alumnos"
        panel.allowedContentTypes = [workbookType]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { reply(NSNull(), nil); return }
            do {
                guard url.pathExtension.lowercased() == "xlsx" else { throw AppError.invalidWorkbook }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= fileLimit else { throw AppError.tooLarge }
                let data = try Data(contentsOf: url)
                reply(["name": url.lastPathComponent, "bytes": data.base64EncodedString()], nil)
            } catch {
                reply(nil, error.localizedDescription)
            }
        }
    }

    private func chooseFolder(_ reply: @escaping (Any?, String?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "Elegir ubicación para las listas de Docencia"
        panel.message = "Docencia usará una carpeta «Docencia - Listas» en la ubicación que elijas y conservará la copia anterior."
        panel.prompt = "Usar ubicación"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = store.root.deletingLastPathComponent()
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let selected = panel.url else { reply(NSNull(), nil); return }
            do {
                let name = "Docencia - Listas"
                let target = selected.lastPathComponent == name ? selected : selected.appendingPathComponent(name, isDirectory: true)
                let next: RegisterStore
                if self.store.accessible {
                    next = try self.store.copied(to: target)
                } else {
                    let candidates = [selected, target].map { RegisterStore(root: $0) }
                    guard let recovered = try candidates.first(where: { candidate in
                        let contents = try candidate.catalog()
                        return ["lists", "archived"].contains { !(contents[$0] as? [[String: String]] ?? []).isEmpty }
                    }) else { throw AppError.unavailableFolder }
                    next = recovered
                }
                _ = try next.catalog()
                UserDefaults.standard.set(next.root.path, forKey: storagePreference)
                self.store = next
                reply(try self.catalogWithSemesters(), nil)
            } catch {
                reply(nil, error.localizedDescription)
            }
        }
    }

    private func saveWorkbook(name: String, bytes: Data, reply: @escaping (Any?, String?) -> Void) {
        let panel = NSSavePanel()
        panel.title = "Guardar Excel para Servicios Escolares"
        panel.nameFieldStringValue = name
        panel.allowedContentTypes = [workbookType]
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { reply(false, nil); return }
            do {
                try bytes.write(to: url, options: .atomic)
                reply(true, nil)
            } catch {
                reply(nil, error.localizedDescription)
            }
        }
    }

    @objc private func openList() {
        window.makeKeyAndOrderFront(nil)
        web.evaluateJavaScript("document.getElementById('choose').click()")
    }

    @objc private func exportList() {
        window.makeKeyAndOrderFront(nil)
        web.evaluateJavaScript("document.getElementById('export').click()")
    }

    @objc private func requestQuit() {
        guard !quitting else { return }
        quitting = true
        Task { @MainActor in
            let saved = try? await web.callAsyncJavaScript(
                "return typeof flushPending === 'function' ? await flushPending() : true;",
                arguments: [:], in: nil, contentWorld: .page
            )
            if (saved as? Bool) == false {
                let alert = NSAlert()
                alert.messageText = "Hay cambios pendientes de guardar"
                alert.informativeText = "Vuelve a abrir el acceso a la carpeta antes de salir para conservar los últimos cambios."
                alert.addButton(withTitle: "Volver a Docencia")
                alert.addButton(withTitle: "Salir de todos modos")
                guard alert.runModal() == .alertSecondButtonReturn else { quitting = false; return }
            }
            NSApp.terminate(nil)
        }
    }

    private func installMenus() {
        let main = NSMenu()
        let application = NSMenuItem()
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: "Acerca de Docencia", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "Salir de Docencia", action: #selector(requestQuit), keyEquivalent: "q").target = self
        application.submenu = applicationMenu
        main.addItem(application)

        let file = NSMenuItem()
        let fileMenu = NSMenu(title: "Archivo")
        fileMenu.addItem(withTitle: "Importar lista de Excel…", action: #selector(openList), keyEquivalent: "o").target = self
        let export = fileMenu.addItem(withTitle: "Guardar Excel…", action: #selector(exportList), keyEquivalent: "S")
        export.target = self
        export.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Cerrar ventana", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        file.submenu = fileMenu
        main.addItem(file)

        let edit = NSMenuItem()
        let editMenu = NSMenu(title: "Edición")
        for (title, action, key) in [("Deshacer", "undo:", "z"), ("Rehacer", "redo:", "Z"),
                                     ("Cortar", "cut:", "x"), ("Copiar", "copy:", "c"),
                                     ("Pegar", "paste:", "v"), ("Seleccionar todo", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: NSSelectorFromString(action), keyEquivalent: key)
        }
        edit.submenu = editMenu
        main.addItem(edit)
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
do {
    let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                             appropriateFor: nil, create: true)
    let root = support.appendingPathComponent("Docencia", isDirectory: true).appendingPathComponent("Listas", isDirectory: true)
    let delegate = try Docencia(root: root)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
} catch {
    NSAlert(error: error).runModal()
}
