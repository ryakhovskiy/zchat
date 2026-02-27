package com.zchat.mobile.data.remote.dto

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class UserDto(
    val id: Long,
    val username: String,
    val email: String? = null,
    @Json(name = "is_online") val isOnline: Boolean? = null
)

@JsonClass(generateAdapter = true)
data class AuthResponseDto(
    @Json(name = "access_token") val accessToken: String,
    @Json(name = "token_type") val tokenType: String,
    val user: UserDto
)

@JsonClass(generateAdapter = true)
data class LoginRequestDto(
    val username: String,
    val password: String,
    @Json(name = "remember_me") val rememberMe: Boolean
)

@JsonClass(generateAdapter = true)
data class RegisterRequestDto(
    val username: String,
    val email: String? = null,
    val password: String
)

@JsonClass(generateAdapter = true)
data class ConversationDto(
    val id: Long,
    val name: String? = null,
    @Json(name = "is_group") val isGroup: Boolean,
    @Json(name = "updated_at") val updatedAt: String? = null
)

@JsonClass(generateAdapter = true)
data class MessageDto(
    val id: Long,
    @Json(name = "conversation_id") val conversationId: Long,
    val content: String,
    @Json(name = "sender_id") val senderId: Long,
    @Json(name = "sender_username") val senderUsername: String,
    @Json(name = "file_path") val filePath: String? = null,
    @Json(name = "file_type") val fileType: String? = null,
    val timestamp: String? = null,
    @Json(name = "is_read") val isRead: Boolean? = null
)

@JsonClass(generateAdapter = true)
data class CreateConversationRequestDto(
    @Json(name = "participant_ids") val participantIds: List<Long>,
    @Json(name = "is_group") val isGroup: Boolean,
    val name: String? = null
)

@JsonClass(generateAdapter = true)
data class SendMessageRequestDto(
    val content: String,
    @Json(name = "file_path") val filePath: String? = null,
    @Json(name = "file_type") val fileType: String? = null
)

@JsonClass(generateAdapter = true)
data class UploadResponseDto(
    @Json(name = "file_path") val filePath: String,
    @Json(name = "file_type") val fileType: String,
    val filename: String
)