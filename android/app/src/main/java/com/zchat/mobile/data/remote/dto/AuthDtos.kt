package com.zchat.mobile.data.remote.dto

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class UserDto(
    val id: Long,
    val username: String,
    val email: String? = null,
    @Json(name = "is_online") val isOnline: Boolean? = null,
    @Json(name = "is_active") val isActive: Boolean? = null,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "last_seen") val lastSeen: String? = null
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
data class MessageDto(
    val id: Long,
    @Json(name = "conversation_id") val conversationId: Long,
    val content: String,
    @Json(name = "sender_id") val senderId: Long,
    @Json(name = "sender_username") val senderUsername: String? = null,
    @Json(name = "file_path") val filePath: String? = null,
    @Json(name = "file_type") val fileType: String? = null,
    // REST uses created_at; WebSocket broadcasts use timestamp
    @Json(name = "created_at") val createdAt: String? = null,
    val timestamp: String? = null,
    @Json(name = "is_read") val isRead: Boolean? = null,
    @Json(name = "is_edited") val isEdited: Boolean? = null,
    @Json(name = "is_deleted") val isDeleted: Boolean? = null,
) {
    val displayTime: String get() = createdAt ?: timestamp ?: ""
}

@JsonClass(generateAdapter = true)
data class ConversationDto(
    val id: Long,
    val name: String? = null,
    @Json(name = "is_group") val isGroup: Boolean,
    @Json(name = "created_at") val createdAt: String? = null,
    @Json(name = "updated_at") val updatedAt: String? = null,
    val participants: List<UserDto>? = null,
    @Json(name = "unread_count") val unreadCount: Int? = null,
    @Json(name = "last_message") val lastMessage: MessageDto? = null,
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
data class EditMessageRequestDto(
    val content: String
)

@JsonClass(generateAdapter = true)
data class UploadResponseDto(
    @Json(name = "file_path") val filePath: String,
    @Json(name = "file_type") val fileType: String,
    val filename: String
)