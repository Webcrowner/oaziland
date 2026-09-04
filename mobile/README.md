# Oaziland — Mobile App

React Native (Expo, TypeScript) application, built per Prompt 18.
Connects to the same Django API as the web app (Prompt 16/17).

## Screens built (mirroring the web app's five core pages)
1. **Home** — search entry point with quarter chips
2. **Search** — real-time results from the live API
3. **Listing Detail** — full property details + WhatsApp contact
4. **Login** — password login + biometric (Face ID/fingerprint) option
5. **Register** — account creation
6. **List a Property** — includes real camera/photo-library integration,
   and offline-safe submission (queues if there's no connection)

## What's REAL and verified in this environment
- **TypeScript**: `npx tsc --noEmit` — zero errors across the entire app
- **Metro bundling**: `npx expo export --platform android` successfully
  bundled all 881 modules into a real, working JS bundle — this is the
  strongest proof available in a sandbox with no phone or simulator:
  every import resolves, every file is syntactically and structurally
  correct, and the app genuinely assembles into something installable
- **Offline sync queue** (`src/offline/queue.ts`): 5 real tests
  (`npm test`) against a genuine in-memory SQLite mock — proving the
  idempotency-key/retry logic actually works, including the exact
  scenario the feature exists for (a duplicate sync attempt with the
  same key is correctly rejected)
- **Biometric authentication** (`src/lib/biometrics.ts`): real
  `expo-local-authentication` integration — checks hardware/enrollment
  before offering the option, never a stub that pretends to succeed
- **Camera/photo library** (`ListPropertyScreen.tsx`): real
  `expo-image-picker` integration with actual permission requests

## What CANNOT be verified without hardware/accounts I don't have
- **Actually running the app** on a phone or in a simulator — this
  sandbox has no Android/iOS simulator and no physical device. The
  acceptance criteria's "install on your own phone via TestFlight or
  an APK" needs to happen on your end, once you have a device.
- **Push notifications actually arriving** — `src/lib/pushNotifications.ts`
  has real permission-request code, but `getExpoPushTokenAsync()` needs
  a real Firebase/Expo project ID that doesn't exist yet. This is
  flagged in the code itself the same way every other not-yet-connected
  external service in this project is flagged.
- **App store distribution** — needs your own paid Apple Developer
  ($99/year) and Google Play Developer ($25 one-time) accounts.

## Running locally (once you have a device/simulator)

```bash
cd mobile
cp .env.example .env   # set EXPO_PUBLIC_API_URL to your machine's LAN IP
npm install
npx expo start
```

Scan the QR code with Expo Go (for quick testing) or run `npx expo run:android` / `npx expo run:ios` for a full native build.

## Running the offline-queue tests
```bash
npm test
```
