import NetInfo from "@react-native-community/netinfo";
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
  deleteAccount as deleteRemoteAccount,
  deleteWearableData as deleteRemoteWearableData,
  enroll,
  getAccount,
  getForecast,
} from "@/services/api";
import { authenticateDevice } from "@/services/deviceAuth";
import {
  connectHealthData,
  refreshHealthData,
  wearableSleepHoursForDate,
} from "@/services/healthData";
import {
  clearAccessToken,
  clearLocalHealthData,
  clearLocalWearableData,
  clearStoredConsentVersion,
  enqueueCheckIn,
  getAccessToken,
  getStoredConsentVersion,
  initializeStorage,
  queueCount,
  saveAccessToken,
  saveStoredConsentVersion,
  wearableQueueCount,
} from "@/services/storage";
import { syncQueuedCheckIns, syncQueuedWearables } from "@/services/sync";
import type {
  AccountSummary,
  CheckInCreate,
  EnrollRequest,
  ForecastResponse,
  Result,
} from "@/types";

const CONSENT_VERSION = "2026-07-19-health-v1";
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
  readonly syncIssue: string | null;
  readonly forecast: ForecastResponse | null;
  readonly account: AccountSummary | null;
  readonly isRefreshing: boolean;
  readonly isHealthSyncing: boolean;
  readonly unlockApp: () => Promise<Result<void>>;
  readonly enrollUser: (payload: EnrollRequest) => Promise<Result<void>>;
  readonly acceptCurrentConsent: () => Promise<Result<void>>;
  readonly submitCheckIn: (payload: CheckInCreate) => Promise<Result<void>>;
  readonly connectHealth: () => Promise<Result<void>>;
  readonly syncHealth: () => Promise<Result<void>>;
  readonly disconnectHealth: () => Promise<Result<void>>;
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
  const [syncIssue, setSyncIssue] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isHealthSyncing, setIsHealthSyncing] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const router = useRouter();
  const segments = useSegments();

  const resetSession = useCallback(async (): Promise<void> => {
    await clearAccessToken();
    setToken(null);
    setIsLocked(false);
    setHasCurrentConsent(null);
    setForecast(null);
    setAccount(null);
    setWearablePendingCount(0);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
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
      const forecastResult = await getForecast(token);
      if (forecastResult.ok) setForecast(forecastResult.value);
      if (!forecastResult.ok && forecastResult.status === 401) {
        await resetSession();
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [hasCurrentConsent, isLocked, resetSession, token]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeStorage();
        const [storedToken, storedConsent, queued, queuedWearables] = await Promise.all([
          getAccessToken(),
          getStoredConsentVersion(),
          queueCount(),
          wearableQueueCount(),
        ]);
        if (active) {
          setToken(storedToken);
          setIsLocked(storedToken !== null);
          setHasCurrentConsent(
            storedToken && storedConsent === CONSENT_VERSION ? true : null,
          );
          setPendingCount(queued);
          setWearablePendingCount(queuedWearables);
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
      (inEnrollment || inLock || inConsent)
    ) {
      router.replace("/(tabs)");
    }
  }, [hasCurrentConsent, isBooting, isLocked, router, segments, token]);

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
      if (connected && token && !isLocked) void refresh();
    });
    return unsubscribe;
  }, [isLocked, refresh, token]);

  useEffect(() => {
    if (token && !isLocked) void refresh();
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
      setToken(result.value.access_token);
      setHasCurrentConsent(true);
      setIsLocked(false);
      return { ok: true, value: undefined };
    },
    [],
  );

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
        setPendingCount(await queueCount());
        if (token && isOnline) await refresh();
        return { ok: true, value: undefined };
      } catch {
        return {
          ok: false,
          message: "This entry could not be saved to encrypted storage. Please try again.",
        };
      }
    },
    [hasCurrentConsent, isOnline, refresh, token],
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
      syncIssue,
      forecast,
      account,
      isRefreshing,
      isHealthSyncing,
      unlockApp,
      enrollUser,
      acceptCurrentConsent,
      submitCheckIn,
      connectHealth,
      syncHealth,
      disconnectHealth,
      wearableSleepHours,
      refresh,
      deleteAccount,
    }),
    [
      acceptCurrentConsent,
      account,
      connectHealth,
      deleteAccount,
      disconnectHealth,
      enrollUser,
      forecast,
      hasCurrentConsent,
      isBooting,
      isLocked,
      isOnline,
      isRefreshing,
      isHealthSyncing,
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
