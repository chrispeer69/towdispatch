package ai.bluecollar.ustowdispatch.driver

import ai.bluecollar.ustowdispatch.driver.data.api.UsTowDispatchApi
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockWebServer
import retrofit2.Retrofit

/**
 * Shared scaffolding for MockWebServer-backed tests. Builds a Retrofit-wired
 * [UsTowDispatchApi] against a fresh server per test. Caller is responsible
 * for calling [MockWebServer.shutdown] in @After.
 */
object MockWebServerSupport {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    fun api(server: MockWebServer): UsTowDispatchApi {
        val client = OkHttpClient.Builder().build()
        val retrofit = Retrofit.Builder()
            .baseUrl(server.url("/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
        return retrofit.create(UsTowDispatchApi::class.java)
    }
}
