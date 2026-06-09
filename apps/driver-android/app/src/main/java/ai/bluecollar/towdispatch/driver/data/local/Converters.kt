package ai.bluecollar.towdispatch.driver.data.local

import androidx.room.TypeConverter

class Converters {
    @TypeConverter
    fun fromList(value: List<String>?): String = value?.joinToString("|") ?: ""

    @TypeConverter
    fun toList(value: String): List<String> = if (value.isBlank()) emptyList() else value.split("|")
}
