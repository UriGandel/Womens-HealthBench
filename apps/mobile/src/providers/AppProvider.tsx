import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { useRouter, useSegments } from "expo-router";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import {
  acceptConsent,
  deleteCycleTracking as deleteRemoteCycleTracking,
  deleteAccount as deleteRemoteAccount,
  deleteWearableData as deleteRemoteWearableData,
  enroll,
  enableCycleTracking as enableRemoteCycleTracking,
  getAccount,
  getCycleTracking,
  getForecast,
} from "@/services/api";
import { authenticateDevice } from "@/services/deviceAuth";
import {
  connectHealthData,
  refreshHealthData,
  wearableSleepHoursForDate,
} from "@/services/healthData";
import {
  cacheCycleDays,
  cachedCycleDays,
  clearAccessToken,
  clearLocalCycleData,
  clearLocalHealthData,
  clearLocalWearableData,
  clearStoredConsentVersion,
  cycleQueueCount,
  enqueueCheckIn,
  enqueueCycleSync,
  getAccessToken,
  getCycleTrackingEnabled,
  getStoredConsentVersion,
  initializeStorage,
  queueCount,
  replaceCachedCycleDays,
  saveAccessToken,
  saveStoredConsentVersion,
  setCycleTrackingEnabled,
  wearableQueueCount,
} from "@/services/storage";
import {
  syncQueuedCheckIns,
  syncQueuedCycleDays,
  syncQueuedWearables,
} from "@/services/sync";
import type {
  AccountSummary,
  CheckInCreate,
  CycleStatus,
  CycleTrackingSummary,
  EnrollRequest,
  ForecastResponse,
  Result,
} from "@/types";
import { applyCycleDay, checkInCycleContext, localCycleSummary } from "@/utils/cycle";
import { localDateString } from "@/utils/date";

const CONSENT_VERSION = "2026-07-19-intraday-cycle-v2";
const BACKGROUND_LOCK_MS = 5 * 60 * 1000;

interface AppContextValue {
  readonly token: string | null;
  readonly isBooting: boolean;
  readonly isLocked: boolean;
  readonly hasCurrentConsent: boolean | null;
  readonly storageError: string | null;
  readonly isOnline: boolean;
  readonly pendingCount: number;
  readonly wearablePendingCount: number;
  readonly cyclePendingCount: number;
  readonly syncIssue: string | null;
  readonly cycleSyncIssue: string | null;
  readonly forecast: ForecastResponse | null;
  readonly account: AccountSummary | null;
  readonly cycleSummary: CycleTrackingSummary | null;
  readonly isRefreshing: boolean;
  readonly isHealthSyncing: boolean;
  readonly unlockApp: () => Promise<Result<void>>;
  readonly lastCheckInDate: string | null;
  readonly enrollUser: (payload: EnrollRequest) => Promise<Result<void>>;
  readonly completeEnrollment: () => void;
  readonly acceptCurrentConsent: () => Promise<Result<void>>;
  readonly submitCheckIn: (payload: CheckInCreate) => Promise<Result<void>>;
  readonly connectHealth: () => Promise<Result<void>>;
  readonly syncHealth: () => Promise<Result<void>>;
  readonly disconnectHealth: () => Promise<Result<void>>;
  readonly enableCycleTracking: () => Promise<Result<void>>;
  readonly logCycleDay: (
    observedDate: string,
    periodStatus: CycleStatus | null,
  ) => Promise<Result<void>>;
  readonly disableCycleTracking: () => Promise<Result<void>>;
  readonly cycleContextForDate: (
    observedDate: string,
  ) => Promise<{
    readonly period_status: "none" | CycleStatus;
    readonly cycle_day: number | null;
  }>;
  readonly wearableSleepHours: (observedDate: string) => Promise<number | null>;
  readonly refresh: () => Promise<void>;
  readonly deleteAccount: () => Promise<Result<void>>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren): React.ReactElement {
  const [token, setToken] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isLocked, setIsLocked] = useState(true);
  const [hasCurrentConsent, setHasCurrentConsent] = useState<boolean | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [wearablePendingCount, setWearablePendingCount] = useState(0);
  const [cyclePendingCount, setCyclePendingCount] = useState(0);
  const [syncIssue, setSyncIssue] = useState<string | null>(null);
  const [cycleSyncIssue, setCycleSyncIssue] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [cycleSummary, setCycleSummary] = useState<CycleTrackingSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHealthSyncing, setIsHealthSyncing] = useState(false);
  const [isFinishingEnrollment, setIsFinishingEnrollment] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const [lastCheckInDate, setLastCheckInDate] = useState<string | null>(null);
  const router = useRouter();
  const segments = useSegments();

  const resetSession = useCallback(async (): Promise<void> => {
    await Promise.all([clearAccessToken(), clearLocalHealthData()]);
    setToken(null);
    setIsLocked(false);
    setHasCurrentConsent(null);
    setForecast(null);
    setAccount(null);
    setLastCheckInDate(null);
    setWearablePendingCount(0);
    setCyclePendingCount(0);
    setCycleSummary(null);
    setCycleSyncIssue(null);
  }, []);

  const performRefresh = useCallback(async (): Promise<void> => {
    if (!token || isLocked) return;
    setIsRefreshing(true);
    try {
      const accountResult = await getAccount(token);
      if (!accountResult.ok && accountResult.status === 401) {
        await resetSession();
        return;
      }

      let consentVerified = hasCurrentConsent === true;
      if (accountResult.ok) {
        setAccount(accountResult.value);
        consentVerified = accountResult.value.consent_current;
        setHasCurrentConsent(consentVerified);
        if (consentVerified) {
          await saveStoredConsentVersion(CONSENT_VERSION);
        } else {
          await clearStoredConsentVersion();
        }
      }
      if (!consentVerified) return;

      const sync = await syncQueuedCheckIns(token);
      setPendingCount(sync.remaining);
      const healthRead = await refreshHealthData(false);
      if (healthRead.ok && !healthRead.value.skipped) {
        setWearablePendingCount(await wearableQueueCount());
      }
      const wearableSync = await syncQueuedWearables(token);
      setWearablePendingCount(wearableSync.remaining);
      setSyncIssue(sync.rejected ?? wearableSync.rejected ?? null);
      if (wearableSync.synced > 0) {
        const updatedAccount = await getAccount(token);
        if (updatedAccount.ok) setAccount(updatedAccount.value);
      }
      if (accountResult.ok) {
        await setCycleTrackingEnabled(accountResult.value.cycle_tracking_enabled);
        if (accountResult.value.cycle_tracking_enabled) {
          const cycleSync = await syncQueuedCycleDays(token);
          setCyclePendingCount(cycleSync.remaining);
          setCycleSyncIssue(cycleSync.rejected ?? null);
        } else {
          setCyclePendingCount(0);
          setCycleSyncIssue(null);
        }
        const cycleResult = await getCycleTracking(token, localDateString());
        if (cycleResult.ok) {
          setCycleSummary(cycleResult.value);
          await replaceCachedCycleDays(cycleResult.value.days);
          const updatedAccount = await getAccount(token);
          if (updatedAccount.ok) setAccount(updatedAccount.value);
        }
      }
      const forecastResult = await getForecast(token);
      if (forecastResult.ok) setForecast(forecastResult.value);
      if (!forecastResult.ok && forecastResult.status === 401) {
        await resetSession();
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [hasCurrentConsent, isLocked, resetSession, token]);

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const operation = performRefresh();
    refreshInFlight.current = operation;
    void operation.then(
      () => {
        if (refreshInFlight.current === operation) refreshInFlight.current = null;
      },
      () => {
        if (refreshInFlight.current === operation) refreshInFlight.current = null;
      },
    );
    return operation;
  }, [performRefresh]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeStorage();
        const [
          storedToken,
          storedConsent,
          queued,
          queuedWearables,
          queuedCycles,
          cycleEnabled,
          localCycleDays,
        ] = await Promise.all([
          getAccessToken(),
          getStoredConsentVersion(),
          queueCount(),
          wearableQueueCount(),
          cycleQueueCount(),
          getCycleTrackingEnabled(),
          cachedCycleDays(),
        ]);
        if (active) {
          setToken(storedToken);
          setIsLocked(storedToken !== null);
          setHasCurrentConsent(
            storedToken && storedConsent === CONSENT_VERSION ? true : null,
          );
          setPendingCount(queued);
          setWearablePendingCount(queuedWearables);
          setCyclePendingCount(queuedCycles);
          setCycleSummary(
            localCycleSummary(cycleEnabled, localCycleDays, localDateString()),
          );
        }
      } catch {
        if (active) {
          setStorageError(
            "Encrypted storage could not open. Use the internal development build, then restart the app.",
          );
        }
      } finally {
        if (active) setIsBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isBooting) return;
    const route = segments[0];
    const inEnrollment = route === "enroll";
    const inLock = route === "lock";
    const inConsent = route === "consent";

    if (!token && !inEnrollment) {
      router.replace("/enroll");
      return;
    }
    if (token && isLocked && !inLock) {
      router.replace("/lock");
      return;
    }
    if (token && !isLocked && hasCurrentConsent === false && !inConsent) {
      router.replace("/consent");
      return;
    }
    if (
      token &&
      !isLocked &&
      hasCurrentConsent === true &&
      ((inEnrollment && !isFinishingEnrollment) || inLock || inConsent)
    ) {
      router.replace("/(tabs)");
    }
  }, [
    hasCurrentConsent,
    isBooting,
    isFinishingEnrollment,
    isLocked,
    router,
    segments,
    token,
  ]);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus): void => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundedAt.current ??= Date.now();
        return;
      }
      if (nextState === "active") {
        const elapsed = backgroundedAt.current
          ? Date.now() - backgroundedAt.current
          : 0;
        backgroundedAt.current = null;
        if (token && elapsed >= BACKGROUND_LOCK_MS) setIsLocked(true);
      }
    };
    const subscription = AppState.addEventListener("change", handleAppState);
    return () => subscription.remove();
  }, [token]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(connected);
      if (connected && token && !isLocked) {
        void refresh().catch(() => {
          setSyncIssue("Background refresh could not complete. Please try again.");
        });
      }
    });
    return unsubscribe;
  }, [isLocked, refresh, token]);

  useEffect(() => {
    if (token && !isLocked) {
      void refresh().catch(() => {
        setSyncIssue("Background refresh could not complete. Please try again.");
      });
    }
  }, [isLocked, refresh, token]);

  const unlockApp = useCallback(async (): Promise<Result<void>> => {
    const result = await authenticateDevice();
    if (!result.ok) return result;
    setIsLocked(false);
    return { ok: true, value: undefined };
  }, []);

  const enrollUser = useCallback(
    async (payload: EnrollRequest): Promise<Result<void>> => {
      const authentication = await authenticateDevice();
      if (!authentication.ok) return authentication;
      const result = await enroll(payload);
      if (!result.ok) return result;
      await Promise.all([
        saveAccessToken(result.value.access_token),
        saveStoredConsentVersion(result.value.consent_version),
      ]);
      setIsFinishingEnrollment(true);
      setToken(result.value.access_token);
      setHasCurrentConsent(true);
      setIsLocked(false);
      return { ok: true, value: undefined };
    },
    [],
  );

  const completeEnrollment = useCallback((): void => {
    setIsFinishingEnrollment(false);
  }, []);

  const acceptCurrentConsent = useCallback(async (): Promise<Result<void>> => {
    if (!token) return { ok: false, message: "No account is available." };
    const result = await acceptConsent(token, CONSENT_VERSION);
    if (!result.ok) return result;
    await saveStoredConsentVersion(result.value.consent_version);
    setHasCurrentConsent(true);
    await refresh();
    return { ok: true, value: undefined };
  }, [refresh, token]);

  const submitCheckIn = useCallback(
    async (payload: CheckInCreate): Promise<Result<void>> => {
      if (hasCurrentConsent !== true) {
        return { ok: false, message: "Current research participation consent is required." };
      }
      try {
        await enqueueCheckIn(payload);
        if (!cycleSummary?.enabled) {
          const checkInCycleRecord = {
            observed_date: payload.observed_date,
            period_status:
              payload.period_status === "none" ? null : payload.period_status,
          };
          await cacheCycleDays([checkInCycleRecord]);
          setCycleSummary((current) =>
            current
              ? applyCycleDay(
                  current,
                  checkInCycleRecord,
                  localDateString(),
                )
              : current,
          );
        }
        setPendingCount(await queueCount());
        setLastCheckInDate(payload.observed_date);
        if (token && isOnline) await refresh();
        return { ok: true, value: undefined };
      } catch {
        return {
          ok: false,
          message: "This entry could not be saved to encrypted storage. Please try again.",
        };
      }
    },
    [cycleSummary?.enabled, hasCurrentConsent, isOnline, refresh, token],
  );

  const connectHealth = useCallback(async (): Promise<Result<void>> => {
    if (!token || hasCurrentConsent !== true) {
      return { ok: false, message: "Current participation consent is required." };
    }
    setIsHealthSyncing(true);
    try {
      const result = await connectHealthData();
      if (!result.ok) return result;
      setWearablePendingCount(await wearableQueueCount());
      if (isOnline) {
        const synced = await syncQueuedWearables(token);
        setWearablePendingCount(synced.remaining);
        if (synced.rejected) return { ok: false, message: synced.rejected };
        await refresh();
      }
      return { ok: true, value: undefined };
    } finally {
      setIsHealthSyncing(false);
    }
  }, [hasCurrentConsent, isOnline, refresh, token]);

  const syncHealth = useCallback(async (): Promise<Result<void>> => {
    if (!token) return { ok: false, message: "No account is available." };
    setIsHealthSyncing(true);
    try {
      const read = await refreshHealthData(true);
      if (!read.ok) return read;
      setWearablePendingCount(await wearableQueueCount());
      if (!isOnline) {
        return {
          ok: true,
          value: undefined,
        };
      }
      const synced = await syncQueuedWearables(token);
      setWearablePendingCount(synced.remaining);
      if (synced.rejected) return { ok: false, message: synced.rejected };
      await refresh();
      return { ok: true, value: undefined };
    } finally {
      setIsHealthSyncing(false);
    }
  }, [isOnline, refresh, token]);

  const disconnectHealth = useCallback(async (): Promise<Result<void>> => {
    if (!token) return { ok: false, message: "No account is available." };
    if (!isOnline) {
      return { ok: false, message: "A secure connection is required to delete imported data." };
    }
    setIsHealthSyncing(true);
    try {
      const result = await deleteRemoteWearableData(token);
      if (!result.ok) return result;
      await clearLocalWearableData();
      setWearablePendingCount(0);
      await refresh();
      return { ok: true, value: undefined };
    } finally {
      setIsHealthSyncing(false);
    }
  }, [isOnline, refresh, token]);

  const wearableSleepHours = useCallback(
    (observedDate: string): Promise<number | null> =>
      wearableSleepHoursForDate(observedDate),
    [],
  );

  const enableCycleTracking = useCallback(async (): Promise<Result<void>> => {
    if (!token || hasCurrentConsent !== true) {
      return { ok: false, message: "Current participation consent is required." };
    }
    if (!isOnline) {
      return { ok: false, message: "A secure connection is required to enable cycle tracking." };
    }
    const result = await enableRemoteCycleTracking(token, localDateString());
    if (!result.ok) return result;
    await setCycleTrackingEnabled(true);
    setCycleSummary(result.value);
    const updatedAccount = await getAccount(token);
    if (updatedAccount.ok) setAccount(updatedAccount.value);
    return { ok: true, value: undefined };
  }, [hasCurrentConsent, isOnline, token]);

  const logCycleDay = useCallback(
    async (
      observedDate: string,
      periodStatus: CycleStatus | null,
    ): Promise<Result<void>> => {
      if (!cycleSummary?.enabled) {
        return { ok: false, message: "Enable cycle tracking before logging cycle history." };
      }
      const record = { observed_date: observedDate, period_status: periodStatus };
      const payload = {
        sync_id: Crypto.randomUUID(),
        local_today: localDateString(),
        records: [record],
      };
      try {
        await cacheCycleDays([record]);
        await enqueueCycleSync(payload);
        setCycleSummary((current) =>
          current ? applyCycleDay(current, record, localDateString()) : current,
        );
        setCyclePendingCount(await cycleQueueCount());
        if (token && isOnline) {
          const synced = await syncQueuedCycleDays(token);
          setCyclePendingCount(synced.remaining);
          setCycleSyncIssue(synced.rejected ?? null);
          if (!synced.rejected) {
            const refreshed = await getCycleTracking(token, localDateString());
            if (refreshed.ok) {
              setCycleSummary(refreshed.value);
              await replaceCachedCycleDays(refreshed.value.days);
            }
            const forecastResult = await getForecast(token);
            if (forecastResult.ok) setForecast(forecastResult.value);
            const accountResult = await getAccount(token);
            if (accountResult.ok) setAccount(accountResult.value);
          }
        }
        return { ok: true, value: undefined };
      } catch {
        return {
          ok: false,
          message: "This cycle edit could not be saved to encrypted storage.",
        };
      }
    },
    [cycleSummary?.enabled, isOnline, token],
  );

  const disableCycleTracking = useCallback(async (): Promise<Result<void>> => {
    if (!token) return { ok: false, message: "No account is available." };
    if (!isOnline) {
      return { ok: false, message: "A secure connection is required to delete cycle history." };
    }
    const result = await deleteRemoteCycleTracking(token);
    if (!result.ok) return result;
    await clearLocalCycleData();
    setCycleSummary(localCycleSummary(false, [], localDateString()));
    setCyclePendingCount(0);
    setCycleSyncIssue(null);
    const updatedAccount = await getAccount(token);
    if (updatedAccount.ok) setAccount(updatedAccount.value);
    return { ok: true, value: undefined };
  }, [isOnline, token]);

  const cycleContextForDate = useCallback(
    async (observedDate: string) => {
      const days = await cachedCycleDays();
      return checkInCycleContext(days, observedDate);
    },
    [],
  );

  const deleteAccount = useCallback(async (): Promise<Result<void>> => {
    if (!token) return { ok: false, message: "No account is available." };
    const result = await deleteRemoteAccount(token);
    if (!result.ok) return result;
    await Promise.all([clearAccessToken(), clearLocalHealthData()]);
    setToken(null);
    setIsLocked(false);
    setHasCurrentConsent(null);
    setForecast(null);
    setAccount(null);
    setPendingCount(0);
    setWearablePendingCount(0);
    setCyclePendingCount(0);
    setCycleSummary(null);
    setCycleSyncIssue(null);
    return { ok: true, value: undefined };
  }, [token]);

  const value = useMemo<AppContextValue>(
    () => ({
      token,
      isBooting,
      isLocked,
      hasCurrentConsent,
      storageError,
      isOnline,
      pendingCount,
      wearablePendingCount,
      cyclePendingCount,
      syncIssue,
      cycleSyncIssue,
      forecast,
      account,
      cycleSummary,
      isRefreshing,
      isHealthSyncing,
      unlockApp,
      lastCheckInDate,
      enrollUser,
      completeEnrollment,
      acceptCurrentConsent,
      submitCheckIn,
      connectHealth,
      syncHealth,
      disconnectHealth,
      enableCycleTracking,
      logCycleDay,
      disableCycleTracking,
      cycleContextForDate,
      wearableSleepHours,
      refresh,
      deleteAccount,
    }),
    [
      acceptCurrentConsent,
      account,
      cycleContextForDate,
      cyclePendingCount,
      cycleSummary,
      cycleSyncIssue,
      completeEnrollment,
      connectHealth,
      deleteAccount,
      disconnectHealth,
      disableCycleTracking,
      enableCycleTracking,
      enrollUser,
      forecast,
      hasCurrentConsent,
      isBooting,
      isLocked,
      isOnline,
      isRefreshing,
      isHealthSyncing,
      lastCheckInDate,
      logCycleDay,
      pendingCount,
      refresh,
      storageError,
      submitCheckIn,
      syncHealth,
      syncIssue,
      token,
      unlockApp,
      wearablePendingCount,
      wearableSleepHours,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}
