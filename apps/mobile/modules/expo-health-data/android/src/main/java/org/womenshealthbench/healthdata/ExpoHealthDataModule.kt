package org.womenshealthbench.healthdata

import android.content.Context
import android.content.Intent
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SkinTemperatureRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt

class ExpoHealthDataModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val permissions = setOf(
    HealthPermission.getReadPermission(SleepSessionRecord::class),
    HealthPermission.getReadPermission(StepsRecord::class),
    HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
    HealthPermission.getReadPermission(HeartRateRecord::class),
    HealthPermission.getReadPermission(RestingHeartRateRecord::class),
    HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
    HealthPermission.getReadPermission(RespiratoryRateRecord::class),
    HealthPermission.getReadPermission(OxygenSaturationRecord::class),
    HealthPermission.getReadPermission(SkinTemperatureRecord::class),
  )

  private lateinit var permissionLauncher:
    AppContextActivityResultLauncher<HealthPermissionRequest, Set<String>>

  override fun definition() = ModuleDefinition {
    Name("ExpoHealthData")

    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(HealthPermissionContract())
    }

    Function("getAvailability") {
      val status = HealthConnectClient.getSdkStatus(context)
      mapOf(
        "available" to (status == HealthConnectClient.SDK_AVAILABLE),
        "needs_install_or_update" to
          (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED),
        "platform" to "health_connect",
      )
    }

    AsyncFunction("requestPermissions") Coroutine (suspend {
      requireAvailable()
      val granted = permissionLauncher.launch(
        HealthPermissionRequest(ArrayList(permissions))
      )
      mapOf(
        "granted" to granted.sorted(),
        "platform" to "health_connect",
      )
    })

    AsyncFunction("readDailySummaries") Coroutine {
        startDate: String,
        endDate: String,
      ->
      requireAvailable()
      val start = LocalDate.parse(startDate)
      val end = LocalDate.parse(endDate)
      require(!start.isAfter(end)) { "Health start date must not follow end date." }
      require(start.plusDays(30) >= end) { "Health reads are limited to 31 calendar days." }

      val client = HealthConnectClient.getOrCreate(context)
      val granted = client.permissionController.getGrantedPermissions()
      buildList {
        var day = start
        while (!day.isAfter(end)) {
          add(readDay(client, granted, day))
          day = day.plusDays(1)
        }
      }
    }

    AsyncFunction("readIntervalSummaries") Coroutine {
        startDate: String,
        endDate: String,
      ->
      requireAvailable()
      val start = LocalDate.parse(startDate)
      val end = LocalDate.parse(endDate)
      require(!start.isAfter(end)) { "Health start date must not follow end date." }
      require(start.plusDays(30) >= end) { "Health reads are limited to 31 calendar days." }

      val client = HealthConnectClient.getOrCreate(context)
      val granted = client.permissionController.getGrantedPermissions()
      val zone = ZoneId.systemDefault()
      val now = Instant.now()
      buildList {
        var day = start
        while (!day.isAfter(end)) {
          for (bucketStartHour in INTERVAL_START_HOURS) {
            val bucketStart = day.atTime(bucketStartHour, 0).atZone(zone).toInstant()
            val bucketEnd = if (bucketStartHour == 18) {
              day.plusDays(1).atStartOfDay(zone).toInstant()
            } else {
              day.atTime(bucketStartHour + INTERVAL_HOURS, 0).atZone(zone).toInstant()
            }
            // Never emit a partial bucket. A later sync will reconstruct it from history.
            if (!bucketEnd.isAfter(now)) {
              add(
                readInterval(
                  client = client,
                  granted = granted,
                  day = day,
                  bucketStartHour = bucketStartHour,
                  start = bucketStart,
                  end = bucketEnd,
                )
              )
            }
          }
          day = day.plusDays(1)
        }
      }
    }

    AsyncFunction("openHealthSettings") {
      requireAvailable()
      val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }
  }

  private fun requireAvailable() {
    check(HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
      "Health Connect is unavailable or needs to be installed or updated."
    }
  }

  private suspend fun readDay(
    client: HealthConnectClient,
    granted: Set<String>,
    day: LocalDate,
  ): Map<String, Any?> {
    val zone = ZoneId.systemDefault()
    val start = day.atStartOfDay(zone).toInstant()
    val end = day.plusDays(1).atStartOfDay(zone).toInstant()
    val filter = TimeRangeFilter.between(start, end)

    val sleepPermission = HealthPermission.getReadPermission(SleepSessionRecord::class)
    val stepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    val caloriesPermission =
      HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)
    val metrics = buildSet {
      if (stepsPermission in granted) add(StepsRecord.COUNT_TOTAL)
      if (caloriesPermission in granted) {
        add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
      }
    }
    val aggregate = if (metrics.isEmpty()) {
      null
    } else {
      client.aggregate(AggregateRequest(metrics = metrics, timeRangeFilter = filter))
    }

    // Attribute the main sleep interval to its local wake date, not midnight buckets.
    val sleepMinutes = if (sleepPermission in granted) {
      val sleepWindowStart = day.minusDays(1).atTime(12, 0).atZone(zone).toInstant()
      val sleepWindowEnd = day.atTime(12, 0).atZone(zone).toInstant()
      client.aggregate(
        AggregateRequest(
          metrics = setOf(SleepSessionRecord.SLEEP_DURATION_TOTAL),
          timeRangeFilter = TimeRangeFilter.between(sleepWindowStart, sleepWindowEnd),
        )
      )[SleepSessionRecord.SLEEP_DURATION_TOTAL]?.toMinutes()?.toInt()
    } else {
      null
    }
    val steps = aggregate?.get(StepsRecord.COUNT_TOTAL)?.toInt()
    val activeEnergy = aggregate
      ?.get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
      ?.inKilocalories
    val activityMinutes = if (
      HealthPermission.getReadPermission(ExerciseSessionRecord::class) in granted
    ) {
      exerciseMinutes(client, start, end)
    } else {
      null
    }
    val restingHeartRate = if (
      HealthPermission.getReadPermission(RestingHeartRateRecord::class) in granted
    ) {
      readRecords<RestingHeartRateRecord>(client, filter)
        .map { it.beatsPerMinute.toDouble() }
        .averageOrNull()
    } else {
      null
    }
    val hrv = if (
      HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class) in granted
    ) {
      readRecords<HeartRateVariabilityRmssdRecord>(client, filter)
        .map { it.heartRateVariabilityMillis }
        .averageOrNull()
    } else {
      null
    }
    val respiratoryRate = if (
      HealthPermission.getReadPermission(RespiratoryRateRecord::class) in granted
    ) {
      readRecords<RespiratoryRateRecord>(client, filter)
        .map { it.rate }
        .averageOrNull()
    } else {
      null
    }
    val oxygenSaturation = if (
      HealthPermission.getReadPermission(OxygenSaturationRecord::class) in granted
    ) {
      readRecords<OxygenSaturationRecord>(client, filter)
        .map { it.percentage.value }
        .averageOrNull()
    } else {
      null
    }
    val temperatureDelta = if (
      HealthPermission.getReadPermission(SkinTemperatureRecord::class) in granted
    ) {
      runCatching {
        client.aggregate(
          AggregateRequest(
            metrics = setOf(SkinTemperatureRecord.TEMPERATURE_DELTA_AVG),
            timeRangeFilter = filter,
          )
        )[SkinTemperatureRecord.TEMPERATURE_DELTA_AVG]?.inCelsius
      }.getOrNull()
    } else {
      null
    }

    return mapOf(
      "observed_date" to day.toString(),
      "platform" to "health_connect",
      "sleep_minutes" to sleepMinutes,
      "steps" to steps,
      "activity_minutes" to activityMinutes,
      "active_energy_kcal" to activeEnergy,
      "resting_heart_rate_bpm" to restingHeartRate,
      "hrv_ms" to hrv,
      "hrv_method" to if (hrv == null) null else "rmssd",
      "respiratory_rate_bpm" to respiratoryRate,
      "oxygen_saturation_pct" to oxygenSaturation,
      "peripheral_temperature_delta_c" to temperatureDelta,
    )
  }

  private suspend fun readInterval(
    client: HealthConnectClient,
    granted: Set<String>,
    day: LocalDate,
    bucketStartHour: Int,
    start: Instant,
    end: Instant,
  ): Map<String, Any?> {
    val filter = TimeRangeFilter.between(start, end)
    val stepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    val caloriesPermission =
      HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)
    val metrics = buildSet {
      if (stepsPermission in granted) add(StepsRecord.COUNT_TOTAL)
      if (caloriesPermission in granted) {
        add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
      }
    }
    val aggregate = if (metrics.isEmpty()) {
      null
    } else {
      client.aggregate(AggregateRequest(metrics = metrics, timeRangeFilter = filter))
    }

    val heartRateSamples = if (
      HealthPermission.getReadPermission(HeartRateRecord::class) in granted
    ) {
      readRecords<HeartRateRecord>(client, filter)
        .flatMap { it.samples }
        // Series records can overlap the requested range; retain only this bucket's samples.
        .filter { !it.time.isBefore(start) && it.time.isBefore(end) }
        .map { it.beatsPerMinute.toDouble() }
    } else {
      emptyList()
    }
    val heartRate = heartRateSamples.statisticsOrNull()

    val hrvSamples = if (
      HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class) in granted
    ) {
      readRecords<HeartRateVariabilityRmssdRecord>(client, filter)
        .map { it.heartRateVariabilityMillis }
    } else {
      emptyList()
    }
    val respiratorySamples = if (
      HealthPermission.getReadPermission(RespiratoryRateRecord::class) in granted
    ) {
      readRecords<RespiratoryRateRecord>(client, filter).map { it.rate }
    } else {
      emptyList()
    }
    val oxygenSamples = if (
      HealthPermission.getReadPermission(OxygenSaturationRecord::class) in granted
    ) {
      readRecords<OxygenSaturationRecord>(client, filter).map { it.percentage.value }
    } else {
      emptyList()
    }

    return mapOf(
      "observed_date" to day.toString(),
      "bucket_start_hour" to bucketStartHour,
      "platform" to "health_connect",
      "steps" to aggregate?.get(StepsRecord.COUNT_TOTAL)?.toInt(),
      "activity_minutes" to if (
        HealthPermission.getReadPermission(ExerciseSessionRecord::class) in granted
      ) {
        exerciseMinutes(client, start, end)
      } else {
        null
      },
      "active_energy_kcal" to aggregate
        ?.get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
        ?.inKilocalories,
      "heart_rate_avg_bpm" to heartRate?.average,
      "heart_rate_min_bpm" to heartRate?.minimum,
      "heart_rate_max_bpm" to heartRate?.maximum,
      "heart_rate_sample_count" to heartRateSamples.countOrNull(),
      "hrv_avg_ms" to hrvSamples.averageOrNull(),
      "hrv_sample_count" to hrvSamples.countOrNull(),
      "hrv_method" to if (hrvSamples.isEmpty()) null else "rmssd",
      "respiratory_rate_avg_bpm" to respiratorySamples.averageOrNull(),
      "respiratory_rate_sample_count" to respiratorySamples.countOrNull(),
      "oxygen_saturation_avg_pct" to oxygenSamples.averageOrNull(),
      "oxygen_saturation_sample_count" to oxygenSamples.countOrNull(),
    )
  }

  private suspend inline fun <reified T : Record> readRecords(
    client: HealthConnectClient,
    filter: TimeRangeFilter,
  ): List<T> {
    val records = mutableListOf<T>()
    var pageToken: String? = null
    do {
      val response = client.readRecords(
        ReadRecordsRequest<T>(
          timeRangeFilter = filter,
          pageSize = 1000,
          pageToken = pageToken,
        )
      )
      records.addAll(response.records)
      pageToken = response.pageToken
    } while (pageToken != null)
    return records
  }

  private suspend fun exerciseMinutes(
    client: HealthConnectClient,
    start: Instant,
    end: Instant,
  ): Int? {
    val sessions = readRecords<ExerciseSessionRecord>(
      client,
      TimeRangeFilter.between(start, end),
    ).sortedBy { it.startTime }
    if (sessions.isEmpty()) return null

    var totalSeconds = 0L
    var intervalStart = maxOf(start, sessions.first().startTime)
    var intervalEnd = minOf(end, sessions.first().endTime)
    for (session in sessions.drop(1)) {
      val nextStart = maxOf(start, session.startTime)
      val nextEnd = minOf(end, session.endTime)
      if (!nextStart.isAfter(intervalEnd)) {
        intervalEnd = maxOf(intervalEnd, nextEnd)
      } else {
        totalSeconds += intervalEnd.epochSecond - intervalStart.epochSecond
        intervalStart = nextStart
        intervalEnd = nextEnd
      }
    }
    totalSeconds += intervalEnd.epochSecond - intervalStart.epochSecond
    val intervalMinutes = ((end.epochSecond - start.epochSecond) / 60).toInt()
    return (totalSeconds / 60.0).roundToInt().coerceIn(0, intervalMinutes)
  }

  private companion object {
    const val INTERVAL_HOURS = 6
    val INTERVAL_START_HOURS = listOf(0, 6, 12, 18)
  }
}

private fun List<Double>.averageOrNull(): Double? =
  if (isEmpty()) null else average()

private fun List<*>.countOrNull(): Int? =
  if (isEmpty()) null else size

private fun List<Double>.statisticsOrNull(): SampleStatistics? =
  if (isEmpty()) {
    null
  } else {
    SampleStatistics(
      average = average(),
      minimum = minOrNull()!!,
      maximum = maxOrNull()!!,
    )
  }

private data class SampleStatistics(
  val average: Double,
  val minimum: Double,
  val maximum: Double,
)

private data class HealthPermissionRequest(
  val permissions: ArrayList<String>
) : Serializable

private class HealthPermissionContract :
  AppContextActivityResultContract<HealthPermissionRequest, Set<String>> {
  private val delegate: ActivityResultContract<Set<String>, Set<String>> =
    PermissionController.createRequestPermissionResultContract()

  override fun createIntent(context: Context, input: HealthPermissionRequest): Intent =
    delegate.createIntent(context, input.permissions.toSet())

  override fun parseResult(
    input: HealthPermissionRequest,
    resultCode: Int,
    intent: Intent?,
  ): Set<String> = delegate.parseResult(resultCode, intent)
}
