import Foundation
enum CSMJSONValue: Codable, Equatable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: CSMJSONValue])
    case array([CSMJSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: CSMJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([CSMJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value.")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

extension CSMJSONValue { static func encodable<T: Encodable>(_ value:T) throws -> Self { try CSMJSONCoding.decoder.decode(Self.self,from:CSMJSONCoding.encoder.encode(value)) } }
enum CSMJSONCoding {
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)

            if let date = makeFractionalISO8601Formatter().date(from: value) {
                return date
            }
            if let date = makeISO8601Formatter().date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date: \(value)")
        }
        return decoder
    }()

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(makeFractionalISO8601Formatter().string(from: date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private static func makeISO8601Formatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }

    private static func makeFractionalISO8601Formatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}

public final class CSMCommunicationRuntime {
    let driverReportService = FixtureService()
    func startIfNeeded() async {}
    func prepareRoutingAuthentication() async {}
}
struct FixtureService {
    func drivingRoutes(_ request: CSMDriverRouteRequest) async throws -> CSMDriverRouteResponse { fatalError("Network is deliberately unavailable in the proof harness") }
    func drivingCapabilities() async throws -> CSMDriverRoutingCatalog { fatalError("Network is deliberately unavailable in the proof harness") }
}
