import Foundation

public protocol APIClient: Sendable {
    func request<Response: Decodable & Sendable>(
        _ method: HTTPMethod,
        _ path: String,
        body: (any Encodable & Sendable)?,
        authorize: Bool
    ) async throws -> Response

    func requestVoid(
        _ method: HTTPMethod,
        _ path: String,
        body: (any Encodable & Sendable)?,
        authorize: Bool
    ) async throws
}

public enum HTTPMethod: String, Sendable {
    case GET, POST, PUT, PATCH, DELETE
}

public protocol TokenProvider: Sendable {
    func currentAccessToken() async -> String?
    func refreshAccessToken() async throws -> String
    func clearSession() async
}

public actor URLSessionAPIClient: APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let tokenProvider: TokenProvider
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(baseURL: URL, tokenProvider: TokenProvider, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider

        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    public func request<Response: Decodable & Sendable>(
        _ method: HTTPMethod,
        _ path: String,
        body: (any Encodable & Sendable)? = nil,
        authorize: Bool = true
    ) async throws -> Response {
        let data = try await send(method: method, path: path, body: body, authorize: authorize)
        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    public func requestVoid(
        _ method: HTTPMethod,
        _ path: String,
        body: (any Encodable & Sendable)? = nil,
        authorize: Bool = true
    ) async throws {
        _ = try await send(method: method, path: path, body: body, authorize: authorize)
    }

    private func send(
        method: HTTPMethod,
        path: String,
        body: (any Encodable & Sendable)?,
        authorize: Bool,
        retriedAfter401: Bool = false
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw APIError.invalidURL }
        var req = URLRequest(url: url)
        req.httpMethod = method.rawValue
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = try encoder.encode(AnyEncodable(body))
        }
        if authorize {
            if let token = await tokenProvider.currentAccessToken() {
                req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            } else {
                throw APIError.noActiveSession
            }
        }
        do {
            let (data, response) = try await session.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.http(status: -1, message: nil)
            }
            switch http.statusCode {
            case 200..<300:
                return data
            case 401 where authorize && !retriedAfter401:
                _ = try await tokenProvider.refreshAccessToken()
                return try await send(
                    method: method, path: path, body: body,
                    authorize: authorize, retriedAfter401: true
                )
            case 401:
                await tokenProvider.clearSession()
                throw APIError.unauthorized
            default:
                let message = String(data: data, encoding: .utf8)
                throw APIError.http(status: http.statusCode, message: message)
            }
        } catch let error as APIError {
            throw error
        } catch let urlError as URLError {
            if urlError.code == .notConnectedToInternet || urlError.code == .networkConnectionLost {
                throw APIError.offline
            }
            throw APIError.transport(urlError)
        }
    }
}

private struct AnyEncodable: Encodable {
    let wrapped: any Encodable
    init(_ wrapped: any Encodable) { self.wrapped = wrapped }
    func encode(to encoder: Encoder) throws { try wrapped.encode(to: encoder) }
}
