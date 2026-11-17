# MediCalc Pro: mobile app

Laboratory calculators (17) as a phone app. The same code ships three ways:

| You want | Use |
|---|---|
| Try it right now | Open `www/index.html` through any web server (see **A**) |
| Install it like an app, no APK | Host `www/` over HTTPS, open it in Chrome on Android, **Install app** (PWA, works offline) |
| A real `.apk` file | GitHub Actions builds it for you (see **B**), or build locally (see **C**) |

## Folder structure

```
medicalc-mobile/
├── www/                       the app (this is what ends up inside the APK)
│   ├── index.html
│   ├── manifest.webmanifest   PWA install info
│   ├── sw.js                  offline cache (web/PWA build only)
│   ├── css/app.css
│   ├── js/calc.js             formulas (pure functions, unit-tested)
│   ├── js/registry.js         the 17 calculators: fields, validation, result model
│   ├── js/app.js              screens, navigation, result sheet, settings, subscription gate
│   └── assets/                fonts (Inter, OFL) and icons
├── android-assets/res/        launcher icons, copied into the Android project during the build
├── scripts/apply-android-assets.js
├── .github/workflows/build-apk.yml
├── capacitor.config.json      app id, name, web folder
├── package.json
└── tests/                     calc.test.js, registry.test.js, ui.test.js
```

## A. Try it in a browser

```bash
npx serve www          # then open the printed address on your computer or phone
```

## B. Get the APK without Android Studio (GitHub Actions)

1. Create a new GitHub repository and upload everything in this folder (keep the hidden `.github` folder).
2. Open the repository's **Actions** tab, choose **Build Android APK**, click **Run workflow**.
3. After a few minutes open the finished run and download the artifact **MediCalc-Pro-debug-apk** (a zip containing `app-debug.apk`).
4. Copy `app-debug.apk` to your phone and open it. Android will ask you to allow **Install unknown apps** for the app you opened it from (Files, Chrome, etc.).

The workflow runs the calculation tests first, so a broken formula stops the build.

## C. Build locally

Requirements: **Node 22+**, **JDK 21**, and the Android SDK (installing Android Studio provides it).

```bash
npm install
npm run android:add      # creates android/ and applies the launcher icons (first time only)
npm run apk              # syncs www/ into Android and builds a debug APK
# result: android/app/build/outputs/apk/debug/app-debug.apk
npm run open             # or open the project in Android Studio
```

On Windows use `gradlew.bat assembleDebug` inside `android/` if `./gradlew` is not recognised.

After you change anything in `www/`, run `npm run sync` (or `npm run apk` again).

## Before you share it with other people

- **App id.** `com.imad.medicalc` in `capacitor.config.json` is a placeholder. Change it to your own (for example `com.yourname.medicalc`) **before** the first release. It cannot be changed later on Google Play.
- **Subscription settings** are at the top of `www/js/app.js` (`CONFIG`): expiry date, contact link, renewal banner window. Access ends at the end of the expiry day in the device's local time.
- **Honest limit of the subscription lock:** it runs on the phone, so a determined user can bypass it (for example by changing the device clock or editing the app). It is a deterrent. Real enforcement needs a licence check against a server.
- **Version numbers.** When you ship an update, raise `version` in `package.json`, `APP_VERSION` in `www/js/app.js`, and `CACHE` in `www/sw.js`.
- **Google Play** does not accept debug APKs. You need a signed release bundle (`.aab`) made with your own keystore. Keep that keystore safe.
- Results are decision support for healthcare professionals. Validate against your laboratory's methods and reference ranges before clinical use.

## What the app does

- Home with search, category filters, favorites and recent calculators.
- Each calculator is a full-screen form with large inputs, unit toggles and clear inline errors.
- Results open in a bottom sheet: a large readout, a stage chip and scale (eGFR G-stages, ACR A-stages), detail rows, warnings and notes. Copy (and Share, when the platform supports it) sends the result with its inputs.
- Light, dark or system theme. Android back button closes the result, then the calculator.
- Accepts Bengali digits (০-৯) and a decimal comma when typing numbers.
- Calculator values are never stored. Only favorites, recents and settings are kept on the device.

## Tests

```bash
npm test                  # formulas + every calculator's fields and validation (no packages needed)
```
Optional end-to-end test in an emulated Pixel 7 (needs Playwright):
```bash
npm i -D playwright && npx playwright install chromium
node tests/ui.test.js
```

## Licences

Inter typeface: SIL Open Font License 1.1 (see `www/assets/fonts/LICENSE-Inter.txt`).
