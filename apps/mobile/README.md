# Tomorrow, Gently — internal mobile alpha

Expo SDK 56 client for private, experimental next-day symptom forecasting.

## Run

1. Install dependencies with `npm install`.
2. Set `EXPO_PUBLIC_API_URL` to the API host reachable from the device (for example, `http://192.168.1.10:8000`).
3. Link the private EAS project with `eas init`.
4. Build a native development client: `eas build --profile development --platform ios` or `--platform android`.

This app cannot run in Expo Go because encrypted SQLite requires a native development build. SQLCipher encrypts the local queue; its randomly generated key is held in the platform keychain/keystore through SecureStore.

The invitation, check-in, forecast, and privacy flows are for invited adults in an internal alpha. Forecasts are experimental wellness information—not diagnoses or medical advice.
