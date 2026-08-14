// The macOS half of src/system, as one binary.
//
// Three things here need a framework rather than a shell, and each one answers
// on exactly the contract its PowerShell counterpart already answers on -
// base64 in on stdin, the same bytes out on stdout - so the JavaScript above is
// one code path and not two:
//
//   ocr                    <- base64 PNG   -> [{top,bottom,left,text}]  (ocr.ps1)
//   faces                  <- base64 JPEG  -> an integer                (faces.ps1)
//   keychain protect       <- the key      -> base64 ciphertext         (keys.ps1)
//   keychain unprotect     <- base64       -> the key
//
// Build: npm run build:helper (needs Xcode's command line tools). It is not
// committed as a binary, because a compiled artefact in a repository is
// something nobody can review.

import Foundation
import Vision
import CryptoKit
import Security

// MARK: - plumbing

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(message.data(using: .utf8)!)
    exit(1)
}

func stdinText() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}

func stdinImage() -> CGImage {
    let text = stdinText()
    guard !text.isEmpty else { fail("Nothing on stdin.") }
    guard let raw = Data(base64Encoded: text) else { fail("stdin was not base64.") }
    guard let source = CGImageSourceCreateWithData(raw as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("Those bytes are not an image this machine can read.")
    }
    return image
}

func emit(_ text: String) {
    FileHandle.standardOutput.write(text.data(using: .utf8)!)
}

// MARK: - ocr

// Vision hands back normalised coordinates with the origin at the bottom left.
// ocr.ps1 reports pixels from the top left, and toReadingOrder in ocr.js sorts
// on that, so a straight pass-through here would rebuild every screen upside
// down and read the last line first.
func runOCR() {
    let image = stdinImage()
    let height = Double(image.height)
    let width = Double(image.width)

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    // Everything here happens on this machine. Vision will not use the network
    // for text, but saying so is cheaper than someone having to find out.
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    }

    do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
        fail("Vision could not read that: \(error.localizedDescription)")
    }

    var frags: [[String: Any]] = []
    for observation in (request.results ?? []) {
        guard let best = observation.topCandidates(1).first, !best.string.isEmpty else { continue }
        let box = observation.boundingBox
        frags.append([
            "top": (1.0 - Double(box.maxY)) * height,
            "bottom": (1.0 - Double(box.minY)) * height,
            "left": Double(box.minX) * width,
            "text": best.string,
        ])
    }

    guard let json = try? JSONSerialization.data(withJSONObject: frags, options: []) else {
        fail("Could not encode the result.")
    }
    FileHandle.standardOutput.write(json)
}

// MARK: - faces

// How many, never whose. VNDetectFaceRectanglesRequest returns boxes and
// nothing that identifies anyone; no landmarks and no face print are asked for
// here, and the count is all that crosses back.
func runFaces() {
    let request = VNDetectFaceRectanglesRequest()
    do {
        try VNImageRequestHandler(cgImage: stdinImage(), options: [:]).perform([request])
    } catch {
        fail("Vision could not look at that: \(error.localizedDescription)")
    }
    emit(String(request.results?.count ?? 0))
}

// MARK: - keychain

// DPAPI's shape, rebuilt: wrap a secret so the file holding it is useless on
// its own, without becoming a vault. A random 256 bit key lives in the login
// keychain and the payload is sealed with AES-GCM, so keys.json keeps exactly
// the format it has on Windows and keys.js needs no branch.
//
// Same honest limit as DPAPI: anything already running as you can ask the
// keychain for this key, exactly as this binary does.

let KEY_SERVICE = "screenpet"
let KEY_ACCOUNT = "keys.json master key"

func keychainQuery() -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: KEY_SERVICE,
        kSecAttrAccount as String: KEY_ACCOUNT,
    ]
}

func masterKey(creating: Bool) -> SymmetricKey? {
    var query = keychainQuery()
    query[kSecReturnData as String] = true

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data {
        return SymmetricKey(data: data)
    }
    if status != errSecItemNotFound {
        fail("The keychain refused: \(status)")
    }
    guard creating else { return nil }

    let fresh = SymmetricKey(size: .bits256)
    let bytes = fresh.withUnsafeBytes { Data($0) }
    var insert = keychainQuery()
    insert[kSecValueData as String] = bytes
    // Only after this Mac has been unlocked once since boot, and never synced
    // to iCloud or included in a backup that leaves the machine.
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let added = SecItemAdd(insert as CFDictionary, nil)
    if added != errSecSuccess { fail("The keychain would not store a key: \(added)") }
    return fresh
}

func runKeychain(_ mode: String) {
    let payload = stdinText()
    if payload.isEmpty { fail("Nothing on stdin.") }

    switch mode {
    case "protect":
        guard let key = masterKey(creating: true) else { fail("No key.") }
        guard let sealed = try? AES.GCM.seal(Data(payload.utf8), using: key),
              let combined = sealed.combined else {
            fail("Could not wrap that.")
        }
        emit(combined.base64EncodedString())
    case "unprotect":
        guard let key = masterKey(creating: false) else {
            fail("There is no key on this machine to unwrap that with.")
        }
        guard let raw = Data(base64Encoded: payload),
              let box = try? AES.GCM.SealedBox(combined: raw),
              let opened = try? AES.GCM.open(box, using: key),
              let text = String(data: opened, encoding: .utf8) else {
            fail("That key was written by a different account or a different machine.")
        }
        emit(text)
    default:
        fail("Unknown keychain mode.")
    }
}

// MARK: - entry

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "ocr": runOCR()
case "faces": runFaces()
case "keychain": runKeychain(args.count > 1 ? args[1] : "")
default: fail("Usage: screenpet-helper ocr|faces|keychain protect|unprotect\n")
}
