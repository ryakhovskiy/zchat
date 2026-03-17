package com.zchat.mobile.data.repository

sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Error(val message: String, val code: Int? = null) : ApiResult<Nothing>
}

suspend inline fun <T> apiCall(crossinline block: suspend () -> T): ApiResult<T> {
    return try {
        ApiResult.Success(block())
    } catch (e: retrofit2.HttpException) {
        val errorBody = e.response()?.errorBody()?.string()
        val message = parseErrorMessage(errorBody) ?: e.message()
        ApiResult.Error(message ?: "Unknown error", e.code())
    } catch (e: java.io.IOException) {
        ApiResult.Error("Network error: ${e.message}")
    } catch (e: Exception) {
        ApiResult.Error(e.message ?: "Unknown error")
    }
}

@PublishedApi
internal fun parseErrorMessage(body: String?): String? {
    if (body.isNullOrBlank()) return null
    return try {
        val regex = """"(?:detail|error|message)"\s*:\s*"([^"]+)"""".toRegex()
        regex.find(body)?.groupValues?.get(1)
    } catch (_: Exception) {
        null
    }
}
