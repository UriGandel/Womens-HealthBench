import NetInfo from "@react-native-community/netinfo";
import { useRouter, useSegments } from "expo-router";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  deleteAccount as deleteRemoteAccount,
  enroll,
  getAccount,
  getForecast,
  updateResearchConsent,
} from "@/services/api";
import {
  clearAccessToken,
  clearLocalHealthData,
  enqueueCheckIn,
  getAccessToken,
  initializeStorage,
  queueCount,
  saveAccessToken,
} from "@/services/storage";
import { syncQueuedCheckIns } from "@/services/sync";
import type {
  AccountSummary,
  CheckInCreate,
  EnrollRequest,
  ForecastResponse,
  Result,
} from "@/types";

interface AppContextValue {
  readonly token: string | null;
  readonly isBooting: boolean;
  readonly storageError: string | null;
  readonly isOnline: boolean;
  readonly pendingCount: number;
  readonly syncIssue: string | null;
  readonly forecast: ForecastResponse | null;
  readonly account: AccountSummary | null;
  readonly isRefreshing: boolean;
  readonly enrollUser: (payload: EnrollRequest) => Promise<Result<void>>;
  readonly submitCheckIn: (payload: CheckInCreate) => Promise<Result<void>>;
  readonly refresh: () => Promise<void>;
  readonly setResearchConsent: (
    enabled: boolean,
    contributeExisting: boolean,
  ) => Promise<Result<void>>;
  readonly deleteAccount: () => Promise<Result<void>>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren): React.ReactElement {
  const [token, setToken] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncIssue, setSyncIssue] = useState<string | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();
  const segments = useSegments();

  const refresh = useCallback(async (): Promise<void> => {
    if (!token) return;
    setIsRefreshing(true);
    try {
      const sync = await syncQueuedCheckIns(token);
      setPendingCount(sync.remaining);
      setSyncIssue(sync.rejected ?? null);
      const [forecastResult, accountResult] = await Promise.all([
        getForecast(token),
        getAccount(token),
      ]);
      if (forecastResult.ok) setForecast(forecastResult.value);
      if (accountResult.ok) setAccount(accountResult.value);
      if (
        (!forecastResult.ok && forecastResult.status === 401) ||
        (!accountResult.ok && accountResult.status === 401)
      ) {
        await clearAccessToken();
        setToken(null);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeStorage();
        const [storedToken, queued] = await Promise.all([getAccessToken(), queueCount()]);
        if (active) {
          setToken(storedToken);
          setPendingCount(queued);
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
    const inEnrollment = segments[0] === "enroll";
    if (!token && !inEnrollment) router.replace("/enroll");
    if (token && inEnrollment) router.replace("/(tabs)");
  }, [isBooting, router, segments, token]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      setIsOnline(connected);
      if (connected && token) void refresh();
    });
    return unsubscribe;
  }, [refresh, token]);

  useEffect(() => {
    if (token) void refresh();
  }, [refresh, token]);

  const enrollUser = useCallback(
    async (payload: EnrollRequest): Promise<Result<void>> => {
      const result = await enroll(payload);
      if (!result.ok) return result;
      await saveAccessToken(result.value.access_token);
      setToken(result.value.access_token);
      return { ok: true, value: undefined };
    },
    [],
  );

  const submitCheckIn = useCallback(
    async (payload: CheckInCreate): Promise<Result<void>> => {
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
    [isOnline, refresh, token],
  );

  const setResearchConsent = useCallback(
    async (enabled: boolean, contributeExisting: boolean): Promise<Result<void>> => {
      if (!token || !account) return { ok: false, message: "Account details are unavailable." };
      const result = await updateResearchConsent(
        token,
        enabled,
        account.consent_version,
        contributeExisting,
      );
      if (!result.ok) return result;
      await refresh();
      return { ok: true, value: undefined };
    },
    [account, refresh, token],
  );

  const deleteAccount = useCallback(async (): Promise<Result<void>> => {
    if (!token) return { ok: false, message: "No account is signed in." };
    const result = await deleteRemoteAccount(token);
    if (!result.ok) return result;
    await Promise.all([clearAccessToken(), clearLocalHealthData()]);
    setToken(null);
    setForecast(null);
    setAccount(null);
    setPendingCount(0);
    return { ok: true, value: undefined };
  }, [token]);

  const value = useMemo<AppContextValue>(
    () => ({
      token,
      isBooting,
      storageError,
      isOnline,
      pendingCount,
      syncIssue,
      forecast,
      account,
      isRefreshing,
      enrollUser,
      submitCheckIn,
      refresh,
      setResearchConsent,
      deleteAccount,
    }),
    [
      account,
      deleteAccount,
      enrollUser,
      forecast,
      isBooting,
      isOnline,
      isRefreshing,
      pendingCount,
      syncIssue,
      refresh,
      setResearchConsent,
      storageError,
      submitCheckIn,
      token,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}
