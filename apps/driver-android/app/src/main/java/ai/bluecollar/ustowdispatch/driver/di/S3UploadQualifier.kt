package ai.bluecollar.ustowdispatch.driver.di

import javax.inject.Qualifier

/**
 * Marks an OkHttpClient instance dedicated to S3 PUT uploads — must NOT
 * carry the driver Authorization header. Provided in [NetworkModule].
 */
@Qualifier
@Retention(AnnotationRetention.RUNTIME)
annotation class S3Upload
