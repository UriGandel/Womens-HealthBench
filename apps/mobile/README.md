# Tomorrow, Gently — internal mobile alpha

Expo SDK 56 client for private, experimental next-day symptom forecasting.

## Run

1. Install dependencies with `npm install`.
2. Set `EXPO_PUBLIC_API_URL` to the API host reachable from the device (for example, `http://192.168.1.10:8000`).
3. For a browser preview, run `EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npm run web`.
4. For native testing, link the private EAS project with `eas init`, then build a development client: `eas build --profile development --platform ios` or `--platform android`.

The browser preview supports enrollment, consent, manual check-ins,
forecasts, and privacy controls against the API. Device authentication is
skipped, health-app imports are disabled, and local tokens and queued records
are deliberately kept only in memory and erased by a page reload. It is a
testing surface, not a production web deployment.

Native builds cannot run in Expo Go because encrypted SQLite and the local
`expo-health-data` native module require a development build. SQLCipher encrypts
the check-in and wearable queues; its randomly generated key is held in the
platform keychain/keystore through SecureStore.

The optional connection is read-only. iOS reads Apple Health summaries supplied
by Apple Watch and compatible apps; Android reads Health Connect summaries
supplied by Wear OS and compatible apps. The app requests sleep, steps,
exercise, active energy, resting heart rate, HRV, respiratory rate, oxygen
saturation, and wrist/skin temperature trend.

Reads happen at connection, on “Sync now,” and on foreground refresh no more
than once per 12 hours. Version 1 does not request background or
older-than-30-day Health Connect access. Run
`npx expo prebuild --clean --no-install` after native-module or config-plugin
changes and verify health access on physical devices.

The enrollment, check-in, forecast, and privacy flows are for adults in an
internal alpha. Operational processing and pseudonymous research contribution
are both required while participating. Deleting the account ends participation
and removes all associated records. “Disconnect and delete health data” removes
imported summaries and their research contribution while preserving manual
check-ins; OS permission is revoked separately in system settings.

The app requires a device passcode, Face ID, or fingerprint. It locks on cold
launch and after five minutes in the background. Authentication remains within
the operating system; the app never receives biometric data or the device
passcode.

Forecasts are experimental wellness information—not diagnoses or medical advice.
