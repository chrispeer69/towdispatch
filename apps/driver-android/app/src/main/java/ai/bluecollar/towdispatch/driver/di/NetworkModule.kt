package ai.bluecollar.towdispatch.driver.di

import ai.bluecollar.towdispatch.driver.BuildConfig
import ai.bluecollar.towdispatch.driver.data.api.AuthInterceptor
import ai.bluecollar.towdispatch.driver.data.api.TokenAuthenticator
import ai.bluecollar.towdispatch.driver.data.api.TowDispatchApi
import ai.bluecollar.towdispatch.driver.data.prefs.AuthTokenStore
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    @Provides @Singleton
    fun provideOkHttpClient(
        tokenStore: AuthTokenStore,
        authenticator: TokenAuthenticator,
    ): OkHttpClient {
        val log = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BASIC
            else HttpLoggingInterceptor.Level.NONE
        }
        return OkHttpClient.Builder()
            .addInterceptor(AuthInterceptor(tokenStore))
            .addInterceptor(log)
            .authenticator(authenticator)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    @Provides @Singleton
    fun provideRetrofit(client: OkHttpClient, json: Json): Retrofit {
        val factory = json.asConverterFactory("application/json".toMediaType())
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(factory)
            .build()
    }

    @Provides @Singleton
    fun provideApi(retrofit: Retrofit): TowDispatchApi = retrofit.create(TowDispatchApi::class.java)
}
