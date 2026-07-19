import ExpoModulesCore
import HealthKit
import UIKit

public final class ExpoHealthDataModule: Module {
  private let store = HKHealthStore()
  private let calendar = Calendar.autoupdatingCurrent

  public func definition() -> ModuleDefinition {
    Name("ExpoHealthData")

    Function("getAvailability") {
      [
        "available": HKHealthStore.isHealthDataAvailable(),
        "needs_install_or_update": false,
        "platform": "apple_health"
      ]
    }

    AsyncFunction("requestPermissions") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.reject(HealthDataException("Apple Health is unavailable on this device."))
        return
      }
      self.store.requestAuthorization(toShare: [], read: self.readTypes()) { success, error in
        if let error {
          promise.reject(HealthDataException(error.localizedDescription))
          return
        }
        guard success else {
          promise.reject(HealthDataException("Apple Health authorization was not completed."))
          return
        }
        // HealthKit deliberately does not reveal which read permissions were denied.
        promise.resolve([
          "granted": [],
          "platform": "apple_health"
        ])
      }
    }

    AsyncFunction("readDailySummaries") {
      (startDate: String, endDate: String, promise: Promise) in
      guard
        let start = self.parseDate(startDate),
        let end = self.parseDate(endDate),
        start <= end
      else {
        promise.reject(HealthDataException("Health dates must use YYYY-MM-DD."))
        return
      }
      guard self.calendar.dateComponents([.day], from: start, to: end).day ?? 31 <= 30 else {
        promise.reject(HealthDataException("Health reads are limited to 31 calendar days."))
        return
      }
      self.readDays(from: start, through: end) { result in
        switch result {
        case .success(let rows):
          promise.resolve(rows)
        case .failure(let error):
          promise.reject(HealthDataException(error.localizedDescription))
        }
      }
    }

    AsyncFunction("readIntervalSummaries") {
      (startDate: String, endDate: String, promise: Promise) in
      guard
        let start = self.parseDate(startDate),
        let end = self.parseDate(endDate),
        start <= end
      else {
        promise.reject(HealthDataException("Health dates must use YYYY-MM-DD."))
        return
      }
      guard self.calendar.dateComponents([.day], from: start, to: end).day ?? 31 <= 30 else {
        promise.reject(HealthDataException("Health reads are limited to 31 calendar days."))
        return
      }
      self.readIntervals(from: start, through: end, now: Date()) { result in
        switch result {
        case .success(let rows):
          promise.resolve(rows)
        case .failure(let error):
          promise.reject(HealthDataException(error.localizedDescription))
        }
      }
    }

    AsyncFunction("openHealthSettings") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
          promise.reject(HealthDataException("Settings could not be opened."))
          return
        }
        UIApplication.shared.open(url) { _ in promise.resolve() }
      }
    }
  }

  private func readTypes() -> Set<HKObjectType> {
    let identifiers: [HKQuantityTypeIdentifier] = [
      .stepCount,
      .appleExerciseTime,
      .activeEnergyBurned,
      .heartRate,
      .restingHeartRate,
      .heartRateVariabilitySDNN,
      .respiratoryRate,
      .oxygenSaturation,
      .appleSleepingWristTemperature
    ]
    var result = Set(identifiers.compactMap(HKObjectType.quantityType(forIdentifier:)))
    if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
      result.insert(sleep)
    }
    return result
  }

  private func parseDate(_ value: String) -> Date? {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.date(from: value).map(calendar.startOfDay(for:))
  }

  private func formatDate(_ value: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: value)
  }

  private func readDays(
    from start: Date,
    through end: Date,
    completion: @escaping (Result<[[String: Any]], Error>) -> Void
  ) {
    var dates: [Date] = []
    var cursor = start
    while cursor <= end {
      dates.append(cursor)
      guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
      cursor = next
    }

    func readNext(_ index: Int, _ rows: [[String: Any]]) {
      guard index < dates.count else {
        completion(.success(rows))
        return
      }
      readDay(dates[index]) { result in
        switch result {
        case .success(let row):
          readNext(index + 1, rows + [row])
        case .failure(let error):
          completion(.failure(error))
        }
      }
    }
    readNext(0, [])
  }

  private func readIntervals(
    from start: Date,
    through end: Date,
    now: Date,
    completion: @escaping (Result<[[String: Any]], Error>) -> Void
  ) {
    var intervals: [(day: Date, hour: Int, start: Date, end: Date)] = []
    var day = start
    while day <= end {
      for hour in stride(from: 0, through: 18, by: 6) {
        guard let bounds = intervalBounds(for: day, startingAt: hour) else {
          completion(.failure(HealthDataException("Calendar interval could not be created.")))
          return
        }
        // A partial bucket is intentionally omitted; it will be reconstructed on a later read.
        if bounds.end <= now {
          intervals.append((day, hour, bounds.start, bounds.end))
        }
      }
      guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else { break }
      day = nextDay
    }

    func readNext(_ index: Int, _ rows: [[String: Any]]) {
      guard index < intervals.count else {
        completion(.success(rows))
        return
      }
      let interval = intervals[index]
      readInterval(
        observedDay: interval.day,
        bucketStartHour: interval.hour,
        start: interval.start,
        end: interval.end
      ) { result in
        switch result {
        case .success(let row):
          readNext(index + 1, rows + [row])
        case .failure(let error):
          completion(.failure(error))
        }
      }
    }
    readNext(0, [])
  }

  private func intervalBounds(for day: Date, startingAt hour: Int) -> (start: Date, end: Date)? {
    let dayComponents = calendar.dateComponents([.era, .year, .month, .day], from: day)
    var startComponents = dayComponents
    startComponents.calendar = calendar
    startComponents.timeZone = calendar.timeZone
    startComponents.hour = hour
    startComponents.minute = 0
    startComponents.second = 0
    guard let start = calendar.date(from: startComponents) else { return nil }

    if hour < 18 {
      var endComponents = startComponents
      endComponents.hour = hour + 6
      guard let end = calendar.date(from: endComponents) else { return nil }
      return (start, end)
    }
    guard let nextDay = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: day)) else {
      return nil
    }
    return (start, nextDay)
  }

  private func readInterval(
    observedDay: Date,
    bucketStartHour: Int,
    start: Date,
    end: Date,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    var row: [String: Any] = [
      "observed_date": formatDate(observedDay),
      "bucket_start_hour": bucketStartHour,
      "platform": "apple_health"
    ]
    let group = DispatchGroup()
    let lock = NSLock()
    var firstError: Error?

    func set(_ key: String, _ value: Any?) {
      lock.lock()
      row[key] = value ?? NSNull()
      lock.unlock()
    }

    func record(_ error: Error) {
      lock.lock()
      firstError = firstError ?? error
      lock.unlock()
    }

    func total(
      _ key: String,
      identifier: HKQuantityTypeIdentifier,
      unit: HKUnit
    ) {
      group.enter()
      statistics(
        identifier: identifier,
        options: .cumulativeSum,
        start: start,
        end: end,
        unit: unit
      ) { result in
        switch result {
        case .success(let value):
          set(key, value)
        case .failure(let error):
          record(error)
        }
        group.leave()
      }
    }

    func samples(
      identifier: HKQuantityTypeIdentifier,
      unit: HKUnit,
      multiplier: Double = 1,
      completion sampleCompletion: @escaping ([Double]) -> Void
    ) {
      group.enter()
      quantityValues(
        identifier: identifier,
        start: start,
        end: end,
        unit: unit,
        multiplier: multiplier
      ) { result in
        switch result {
        case .success(let values):
          sampleCompletion(values)
        case .failure(let error):
          record(error)
        }
        group.leave()
      }
    }

    total("steps", identifier: .stepCount, unit: .count())
    total("activity_minutes", identifier: .appleExerciseTime, unit: .minute())
    total("active_energy_kcal", identifier: .activeEnergyBurned, unit: .kilocalorie())

    samples(
      identifier: .heartRate,
      unit: HKUnit.count().unitDivided(by: .minute())
    ) { values in
      set("heart_rate_avg_bpm", self.average(values))
      set("heart_rate_min_bpm", values.min())
      set("heart_rate_max_bpm", values.max())
      set("heart_rate_sample_count", values.isEmpty ? nil : values.count)
    }
    samples(identifier: .heartRateVariabilitySDNN, unit: .secondUnit(with: .milli)) { values in
      set("hrv_avg_ms", self.average(values))
      set("hrv_sample_count", values.isEmpty ? nil : values.count)
      set("hrv_method", values.isEmpty ? nil : "sdnn")
    }
    samples(
      identifier: .respiratoryRate,
      unit: HKUnit.count().unitDivided(by: .minute())
    ) { values in
      set("respiratory_rate_avg_bpm", self.average(values))
      set("respiratory_rate_sample_count", values.isEmpty ? nil : values.count)
    }
    samples(identifier: .oxygenSaturation, unit: .percent(), multiplier: 100) { values in
      set("oxygen_saturation_avg_pct", self.average(values))
      set("oxygen_saturation_sample_count", values.isEmpty ? nil : values.count)
    }

    group.notify(queue: .global(qos: .userInitiated)) {
      if let firstError {
        completion(.failure(firstError))
      } else {
        completion(.success(row))
      }
    }
  }

  private func readDay(
    _ day: Date,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else {
      completion(.failure(HealthDataException("Calendar interval could not be created.")))
      return
    }

    var row: [String: Any] = [
      "observed_date": formatDate(day),
      "platform": "apple_health"
    ]
    let group = DispatchGroup()
    let lock = NSLock()
    var firstError: Error?

    func set(_ key: String, _ value: Any?) {
      lock.lock()
      row[key] = value ?? NSNull()
      lock.unlock()
    }

    func query(
      _ key: String,
      identifier: HKQuantityTypeIdentifier,
      options: HKStatisticsOptions,
      unit: HKUnit,
      multiplier: Double = 1
    ) {
      group.enter()
      statistics(
        identifier: identifier,
        options: options,
        start: day,
        end: nextDay,
        unit: unit
      ) { result in
        switch result {
        case .success(let value):
          set(key, value.map { $0 * multiplier })
        case .failure(let error):
          lock.lock()
          firstError = firstError ?? error
          lock.unlock()
        }
        group.leave()
      }
    }

    query(
      "steps",
      identifier: .stepCount,
      options: .cumulativeSum,
      unit: .count()
    )
    query(
      "activity_minutes",
      identifier: .appleExerciseTime,
      options: .cumulativeSum,
      unit: .minute()
    )
    query(
      "active_energy_kcal",
      identifier: .activeEnergyBurned,
      options: .cumulativeSum,
      unit: .kilocalorie()
    )
    query(
      "resting_heart_rate_bpm",
      identifier: .restingHeartRate,
      options: .discreteAverage,
      unit: HKUnit.count().unitDivided(by: .minute())
    )
    query(
      "hrv_ms",
      identifier: .heartRateVariabilitySDNN,
      options: .discreteAverage,
      unit: .secondUnit(with: .milli)
    )
    query(
      "respiratory_rate_bpm",
      identifier: .respiratoryRate,
      options: .discreteAverage,
      unit: HKUnit.count().unitDivided(by: .minute())
    )
    query(
      "oxygen_saturation_pct",
      identifier: .oxygenSaturation,
      options: .discreteAverage,
      unit: .percent(),
      multiplier: 100
    )

    group.enter()
    sleepMinutes(wakeDate: day) { result in
      if case .success(let value) = result {
        set("sleep_minutes", value)
      } else if case .failure(let error) = result {
        lock.lock()
        firstError = firstError ?? error
        lock.unlock()
      }
      group.leave()
    }

    group.enter()
    temperatureDelta(for: day) { result in
      if case .success(let value) = result {
        set("peripheral_temperature_delta_c", value)
      } else if case .failure(let error) = result {
        lock.lock()
        firstError = firstError ?? error
        lock.unlock()
      }
      group.leave()
    }

    group.notify(queue: .global(qos: .userInitiated)) {
      if let firstError {
        completion(.failure(firstError))
        return
      }
      if row["hrv_ms"] is NSNull {
        row["hrv_method"] = NSNull()
      } else {
        row["hrv_method"] = "sdnn"
      }
      completion(.success(row))
    }
  }

  private func statistics(
    identifier: HKQuantityTypeIdentifier,
    options: HKStatisticsOptions,
    start: Date,
    end: Date,
    unit: HKUnit,
    completion: @escaping (Result<Double?, Error>) -> Void
  ) {
    guard let type = HKObjectType.quantityType(forIdentifier: identifier) else {
      completion(.success(nil))
      return
    }
    let predicate = HKQuery.predicateForSamples(
      withStart: start,
      end: end,
      options: [.strictStartDate, .strictEndDate]
    )
    let query = HKStatisticsQuery(
      quantityType: type,
      quantitySamplePredicate: predicate,
      options: options
    ) { _, statistics, error in
      if let error {
        completion(.failure(error))
        return
      }
      let quantity = options.contains(.cumulativeSum)
        ? statistics?.sumQuantity()
        : statistics?.averageQuantity()
      completion(.success(quantity?.doubleValue(for: unit)))
    }
    store.execute(query)
  }

  private func quantityValues(
    identifier: HKQuantityTypeIdentifier,
    start: Date,
    end: Date,
    unit: HKUnit,
    multiplier: Double = 1,
    completion: @escaping (Result<[Double], Error>) -> Void
  ) {
    guard let type = HKObjectType.quantityType(forIdentifier: identifier) else {
      completion(.success([]))
      return
    }
    let predicate = HKQuery.predicateForSamples(
      withStart: start,
      end: end,
      options: [.strictStartDate, .strictEndDate]
    )
    let query = HKSampleQuery(
      sampleType: type,
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: nil
    ) { _, samples, error in
      if let error {
        completion(.failure(error))
        return
      }
      let values = (samples as? [HKQuantitySample] ?? []).map {
        $0.quantity.doubleValue(for: unit) * multiplier
      }
      completion(.success(values))
    }
    store.execute(query)
  }

  private func average(_ values: [Double]) -> Double? {
    guard !values.isEmpty else { return nil }
    return values.reduce(0, +) / Double(values.count)
  }

  private func sleepMinutes(
    wakeDate: Date,
    completion: @escaping (Result<Int?, Error>) -> Void
  ) {
    guard
      let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
      let windowStart = calendar.date(byAdding: .hour, value: -12, to: wakeDate),
      let windowEnd = calendar.date(byAdding: .hour, value: 12, to: wakeDate)
    else {
      completion(.success(nil))
      return
    }
    let predicate = HKQuery.predicateForSamples(
      withStart: windowStart,
      end: windowEnd,
      options: []
    )
    let asleepValues = Set([
      HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
      HKCategoryValueSleepAnalysis.asleepCore.rawValue,
      HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
      HKCategoryValueSleepAnalysis.asleepREM.rawValue
    ])
    let query = HKSampleQuery(
      sampleType: type,
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: nil
    ) { _, samples, error in
      if let error {
        completion(.failure(error))
        return
      }
      let intervals = (samples as? [HKCategorySample] ?? [])
        .filter { asleepValues.contains($0.value) }
        .map { (max($0.startDate, windowStart), min($0.endDate, windowEnd)) }
        .filter { $0.0 < $0.1 }
        .sorted { $0.0 < $1.0 }
      guard !intervals.isEmpty else {
        completion(.success(nil))
        return
      }
      var total: TimeInterval = 0
      var current = intervals[0]
      for interval in intervals.dropFirst() {
        if interval.0 <= current.1 {
          current.1 = max(current.1, interval.1)
        } else {
          total += current.1.timeIntervalSince(current.0)
          current = interval
        }
      }
      total += current.1.timeIntervalSince(current.0)
      completion(.success(Int((total / 60).rounded())))
    }
    store.execute(query)
  }

  private func temperatureDelta(
    for day: Date,
    completion: @escaping (Result<Double?, Error>) -> Void
  ) {
    guard
      let nextDay = calendar.date(byAdding: .day, value: 1, to: day),
      let baselineStart = calendar.date(byAdding: .day, value: -28, to: day)
    else {
      completion(.success(nil))
      return
    }
    statistics(
      identifier: .appleSleepingWristTemperature,
      options: .discreteAverage,
      start: day,
      end: nextDay,
      unit: .degreeCelsius()
    ) { currentResult in
      switch currentResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let current):
        guard let current else {
          completion(.success(nil))
          return
        }
        self.statistics(
          identifier: .appleSleepingWristTemperature,
          options: .discreteAverage,
          start: baselineStart,
          end: day,
          unit: .degreeCelsius()
        ) { baselineResult in
          switch baselineResult {
          case .failure(let error):
            completion(.failure(error))
          case .success(let baseline):
            completion(.success(baseline.map { current - $0 }))
          }
        }
      }
    }
  }
}

private final class HealthDataException: GenericException<String> {
  override var reason: String {
    param
  }
}
