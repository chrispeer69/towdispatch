package ai.bluecollar.towcommand.driver.data.api

import ai.bluecollar.towcommand.driver.data.api.dto.CancelRequest
import ai.bluecollar.towcommand.driver.data.api.dto.DriverProfileDto
import ai.bluecollar.towcommand.driver.data.api.dto.JobDto
import ai.bluecollar.towcommand.driver.data.api.dto.LoginRequest
import ai.bluecollar.towcommand.driver.data.api.dto.LoginResponse
import ai.bluecollar.towcommand.driver.data.api.dto.LogoutRequest
import ai.bluecollar.towcommand.driver.data.api.dto.MeResponse
import ai.bluecollar.towcommand.driver.data.api.dto.MyJobDto
import ai.bluecollar.towcommand.driver.data.api.dto.PhotoUploadRequest
import ai.bluecollar.towcommand.driver.data.api.dto.PhotoUploadResponse
import ai.bluecollar.towcommand.driver.data.api.dto.RefreshRequest
import ai.bluecollar.towcommand.driver.data.api.dto.RefreshResponse
import ai.bluecollar.towcommand.driver.data.api.dto.TransitionRequest
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface TowCommandApi {
    @POST("/auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    @POST("/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): RefreshResponse

    @POST("/auth/logout")
    suspend fun logout(@Body body: LogoutRequest)

    @GET("/auth/me")
    suspend fun me(): MeResponse

    /** Driver-scoped — returns jobs assigned to the driver linked to the current user. */
    @GET("/dispatch/my-jobs")
    suspend fun myJobs(): List<MyJobDto>

    @GET("/dispatch/me/driver")
    suspend fun myDriverProfile(): DriverProfileDto

    @POST("/dispatch/jobs/{id}/transition")
    suspend fun transition(@Path("id") id: String, @Body body: TransitionRequest): JobDto

    @POST("/jobs/{id}/cancel")
    suspend fun cancel(@Path("id") id: String, @Body body: CancelRequest): JobDto

    @POST("/dispatch/jobs/{id}/photos")
    suspend fun uploadJobPhoto(
        @Path("id") id: String,
        @Body body: PhotoUploadRequest,
    ): PhotoUploadResponse
}
