# Done Deal Trip Log – setup and daily use

This app keeps the travel record Thendo asked for: the date, where you went, why you went, and how many kilometres you drove. It runs on the phone, keeps working without signal, and sends everything to your **Done Deal – East Rand Industrial Pipeline** Google Sheet. The tabs it uses are **Trip Log** (one row per day), **Trip Legs** (one row per trip leg), and **Properties** (when you link a visit to a property).

## A. Connect the Google Sheet (once, about 5 minutes, on a computer is easiest)
1. Open the sheet, then **Extensions > Apps Script**.
2. Delete what's in `Code.gs`, then paste in the whole of `apps-script/Code.gs` from this folder.
3. At the top, change `TOKEN = 'CHANGE-ME-to-a-long-secret'` to your own secret, for example `libby-trips-7Kq29x`. Save (the disk icon).
4. Optional: pick `testSetup` in the function menu and press **Run**. Allow the permissions it asks for (Sheets and Drive, on your own account).
5. **Deploy > New deployment**, then the gear icon > **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone** (the secret token stops strangers from writing to your sheet)
6. Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).
   *If you change Code.gs later, use Deploy > Manage deployments > Edit > New version, or the URL won't pick up the change.*

## B. Install the app on the phone
The app has to be opened from an **https://** link, because phones only allow GPS and offline mode on secure sites. Use the link you're given (see the hosting notes).
- **Android (Chrome):** open the link, then ⋮ menu > **Add to Home screen / Install app**.
- **iPhone (Safari, iOS 16.4 or newer):** open the link, then Share > **Add to Home Screen**. Always open it from the Home Screen icon.
Then:
1. Open the app and allow **Location** ("While using the app"), **Notifications**, and the **Microphone** when you record your first voice memo.
2. Go to **Settings** and paste the Web App URL and your token. Press **Save**.
3. Optional: get a free **openrouteservice** key at openrouteservice.org (sign up > Dashboard > create token) and paste it in Settings for more reliable directions. Without a key, the app uses the free OSRM demo server.
4. Optional: enter your email address. It's sent to OpenStreetMap's search service as a polite contact.

## C. Daily use
1. **08:30, Start day:** choose where you're starting from (Home, Sandton office or other), type the odometer reading if you can, and tap **Start day**. The km count starts at 0.
2. **Before each drive, while parked:**
   - **Navigate to a property:** search an address, or tap **Load my tracker properties** and pick one (for example P001). Fill in the declaration, then the app starts turn-by-turn directions, spoken out loud.
   - **Start leg / Add stop:** use this if you don't need directions.
   - The declaration asks: Where are you going? What will you do there? What have you done so far today? Any other notes? You can type your answers or tap 🎤 for a voice memo of up to 60 seconds. You can play it back and re-record it.
3. **Drive with the app open on screen** (use a phone holder). The screen stays on where the phone supports it.
4. **On arrival** (the app notices when you're within about 50 m, or you can tap **Arrived** / **I've arrived**), park and fill in the arrival notes: purpose, what you saw, property type, lease or sale, size, whether there's a broker board, and how many photos you took. You can add a voice memo here too. If you enter a tracker ID such as P001 and leave "Set Status to Visited" ticked, the Properties tab is updated: Status changes to Visited and the Date Visited is filled in. A property that's already marked Submitted is never changed.
5. **17:00, End day:** type the odometer reading if you can, and tap **End day**. If you gave both odometer readings, the odometer total is the **official km**, and the GPS km is shown next to it. A big difference between the two is flagged.
6. **Reminders:** 08:30 to start your day, hourly from 09:30 to 16:30 with your km so far, and 17:00 with your summary.
7. **History** tab: see your past days, and use **Export CSV** to send a month's log to Thendo.
8. The badge at the top shows **Synced**, or **X waiting** when you're offline. Waiting items are sent automatically once you have signal again.

The **Trip Log** tab has a yellow monthly summary box (K1:L7) showing days logged, GPS km, odometer km, official km, a fuel estimate (7 L/100 km at R30.25 per litre) and how that compares with the R2,000 allowance. To see another month, change cell L1 to that month, written as yyyy-mm.

## Limitations (please read)
- **GPS only counts while the app is open on screen.** On an iPhone, tracking stops when the screen locks or you switch apps. Android may slow it down or pause it. Gaps mean missed km, so **the odometer readings are your reliable total.**
- **Reminders only fire while the app is open or was used recently.** There's no server sending them. On an iPhone they need iOS 16.4 or newer and the app installed on the Home Screen.
- **Never type or record while driving.** Do the declaration and arrival notes only when parked.
- **Offline:** the app, the map areas you've already viewed (up to about 50 MB of map images), and the route you're already following keep working. **Searching, loading new map areas and getting new routes or reroutes need signal.**
- **Directions:** these are free services with no guarantee. The OSRM demo server can be slow or unavailable. The openrouteservice free plan allows about 2,000 routes a day, 40 a minute. Address search is limited to one request a second. Some industrial addresses aren't on OpenStreetMap, so try the street name and suburb.
- **Storage:** a voice memo is about 0.25–1 MB a minute, and is capped at 60 seconds and 5 MB. Memos stay on the phone until they've uploaded, then they're deleted from the phone. They're saved in your Google Drive under *Done Deal Trip Memos/yyyy-mm*, which counts against your free 15 GB. **On an iPhone, Safari can wipe a website's saved data if it isn't used for about 7 days, unless the app is installed on the Home Screen.** Keep it installed, and let it sync.
- We don't know yet whether Done Deal's company phone will be an Android or an iPhone. The app works on both, but Android with Chrome gives the best results.
