# Attendance Tick (no login)

A tiny web app for your team: scan a QR code → open this page → select your name → tap the time slot (08:00, 12:00, 12:30, 17:30).
It stores the tick with a server timestamp.

## Rules (as requested)
- Works only on **Mon–Sat**
- Works only in **year 2026**
- Slots: **08:00 AM, 12:00 PM, 12:30 PM, 05:30 PM**

## Setup
1) Install Node.js (LTS).
2) In this folder, run:
   ```bash
   npm install
   npm start
   ```
3) Open:
   - http://localhost:3000

## Put your coworkers' names
Edit `attendance.json`:
```json
{
  "employees": ["Alice", "Bob", "Charlie"],
  "ticks": []
}
```

## Admin export (optional)
Set an admin key so only admins can download CSV:
- macOS/Linux:
  ```bash
  ADMIN_KEY="yourSecretKey" npm start
  ```
- Windows PowerShell:
  ```powershell
  $env:ADMIN_KEY="yourSecretKey"; npm start
  ```

Then export:
- http://localhost:3000/admin?key=yourSecretKey
- http://localhost:3000/api/export.csv?key=yourSecretKey

## QR code
Generate a QR code that points to your server URL, e.g.:
- `https://your-server.com/` (or `http://office-pc:3000/`)

Print it and place it near the scanner/door.
