package com.zchat.mobile.data.remote.api

import com.zchat.mobile.data.remote.dto.AuthResponseDto
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.data.remote.dto.CreateConversationRequestDto
import com.zchat.mobile.data.remote.dto.LoginRequestDto
import com.zchat.mobile.data.remote.dto.MessageDto
import com.zchat.mobile.data.remote.dto.RegisterRequestDto
import com.zchat.mobile.data.remote.dto.SendMessageRequestDto
import com.zchat.mobile.data.remote.dto.UploadResponseDto
import com.zchat.mobile.data.remote.dto.UserDto
import okhttp3.MultipartBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface AuthApi {
    @POST("auth/register")
    suspend fun register(@Body payload: RegisterRequestDto): AuthResponseDto

    @POST("auth/login")
    suspend fun login(@Body payload: LoginRequestDto): AuthResponseDto

    @POST("auth/logout")
    suspend fun logout(): Response<Unit>

    @GET("auth/me")
    suspend fun me(): UserDto
}

interface UsersApi {
    @GET("users/")
    suspend fun listUsers(): List<UserDto>

    @GET("users/{id}")
    suspend fun getUser(@Path("id") id: Long): UserDto
}

interface ConversationsApi {
    @POST("conversations/")
    suspend fun createConversation(@Body payload: CreateConversationRequestDto): ConversationDto

    @GET("conversations/")
    suspend fun listConversations(): List<ConversationDto>

    @GET("conversations/{id}")
    suspend fun getConversation(@Path("id") id: Long): ConversationDto

    @GET("conversations/{id}/messages")
    suspend fun listMessages(
        @Path("id") conversationId: Long,
        @Query("limit") limit: Int = 1000
    ): List<MessageDto>

    @POST("conversations/{id}/messages")
    suspend fun sendMessage(
        @Path("id") conversationId: Long,
        @Body payload: SendMessageRequestDto
    ): MessageDto

    @POST("conversations/{id}/read")
    suspend fun markAsRead(@Path("id") conversationId: Long): Response<Unit>
}

interface FilesApi {
    @Multipart
    @POST("uploads/")
    suspend fun upload(@Part file: MultipartBody.Part): UploadResponseDto

    @Streaming
    @GET("uploads/{filename}")
    suspend fun download(
        @Path("filename") filename: String,
        @Query("token") token: String
    ): ResponseBody
}

interface BrowserApi {
    @GET("browser/proxy")
    suspend fun proxy(@Query("url") url: String): ResponseBody
}

interface MessagesApi {
    @DELETE("messages/{id}")
    suspend fun deleteMessage(
        @Path("id") messageId: Long,
        @Query("delete_type") deleteType: String
    ): Response<Unit>
}