# Next Project Ideas

## ESP32 Tinkering

### What is ESP32?

A tiny, cheap (~$5-10) microcontroller with built-in WiFi and Bluetooth. No operating system — your code IS the entire thing running on it. Flash a new project anytime over USB, it overwrites the old one instantly.

### Board: ESP32-S3-DevKitC-1 (~$8-10)

The best all-rounder for general tinkering. USB-C, USB OTG, ~36 GPIO pins, plenty of RAM.

**Other boards (only if you need them):**

| Board | Price | Best For | Notes |
|-------|-------|----------|-------|
| **ESP32-CAM (AI-Thinker)** | ~$5-8 | Dedicated camera projects | OV2640 camera built in, but no USB (needs FTDI adapter), limited pins, no mic |
| **ESP32-S3-EYE** | ~$20-25 | Camera + mic + display projects | Camera, microphone, LCD connector all built in, USB-C |

### Shopping List

**Skip the mega kits** (like Freenove 173-item). Most of it is filler resistors and LEDs you'll use once. Buy the board and add modules as you need them.

#### Tier 1 — Start here (~$20 total)

| Item | ~Cost | Why |
|------|-------|-----|
| **ESP32-S3-DevKitC-1** | $8-10 | The board itself |
| **Breadboard + jumper wires** | $3 | Required — this is how you connect components to GPIO pins without soldering. The board's pin headers plug directly into the breadboard. |
| **SSD1306 OLED** (0.96") | $3 | Instant visual feedback for any project, I2C interface |
| **INMP441 mic module** | $2 | Opens up audio/voice projects, I2S digital microphone |

#### Tier 2 — Add when you have a specific idea

| Item | ~Cost | Unlocks |
|------|-------|---------|
| **OV2640 camera module** | $4 | Camera/vision projects on the S3 |
| **BME280 sensor** | $3 | Temperature/humidity/pressure monitoring |
| **Servo motor (SG90)** | $2 | Physical movement, robotics |
| **NeoPixel LED strip** (8-pixel) | $3 | Programmable lighting |
| **E-ink display** (2.13") | $10 | Low-power always-on display (weather, reminders) |
| **ILI9341 TFT** | $5 | Color display, SPI interface |

### How Flashing Works

1. Plug USB-C into laptop
2. Write code in **Arduino IDE**, **PlatformIO** (VS Code extension), or **ESP-IDF** (Espressif's official C framework, more advanced)
3. Hit upload — flashes over USB serial
4. Board runs your code immediately, re-runs on every power-up
5. Want a different project? Flash again. It overwrites completely.

No SD card image, no OS install. The microcontroller runs your compiled code directly.

### Ports and Pins (ESP32-S3-DevKitC)

- **USB-C** — power, flashing, serial monitor (debugging output)
- **~36 GPIO pins** — each can be configured as:
  - Digital input/output
  - Analog input (ADC)
  - I2C (for displays, sensors)
  - SPI (for faster displays, SD cards)
  - UART (serial communication)
  - PWM (motor speed, LED brightness)
  - Capacitive touch sensor

Wire sensors and displays to GPIO pins on a breadboard. USB is for talking to your laptop.

### Project Ideas

| Project | Components Needed | What It Does |
|---------|-------------------|--------------|
| **Environment monitor** | BME280 + OLED + WiFi | Web dashboard showing temp/humidity in your room |
| **Voice command device** | INMP441 mic + WiFi | Send audio to a speech API, trigger actions |
| **DIY security cam** | OV2640 + WiFi | Motion detection + phone notifications |
| **Smart display** | E-ink or OLED + WiFi | Always-on weather/calendar/notifications |
| **Custom controller** | GPIO buttons + WiFi | Control anything (lights, music, scripts on laptop) |
| **Audio visualizer** | INMP441 mic + NeoPixel strip | Reactive LED lighting |
| **Doorbell camera** | OV2640 + button + WiFi | Camera with phone notifications |
| **Macro pad** | Buttons + USB OTG | Custom keyboard shortcuts/hotkeys |

---

## Photo Backup: Immich vs Syncthing

### The Problem

iPhone photos go to Google Photos (metadata gets stripped to reduce size). Approaching storage limits. Apple pushes iCloud, Google pushes storage upgrades. Need a self-hosted solution to own photos locally.

### Immich

**What it is:** A self-hosted, open-source Google Photos replacement. Full-featured photo/video management with a web UI and mobile apps.

**How it works with iPhone:**
- Install Immich iOS app from the App Store
- App connects to your Immich server over local WiFi (or internet if you expose it)
- Enable "auto backup" in the app — it uploads photos/videos automatically whenever the app is open
- Photos land on whatever storage you configure (your laptop's drive, external HDD)
- Browse and manage everything via web UI at `localhost:2283`

**Does it read directly from iPhone?**
Yes, through the iOS app. The app accesses your iPhone photo library and uploads to the server. No cable needed, no iTunes, no weird workarounds. It uses the same photo access APIs that Google Photos and iCloud use.

**Key features:**
- **Face recognition** — automatically detects and groups faces. You name them once, it tags all matching photos
- **Search** — search by content ("beach", "dog", "birthday"), location, date, person
- **Duplicate detection** — finds and flags duplicate photos for cleanup
- **Albums** — auto-created (by date/location) and manual
- **Map view** — see where photos were taken (if GPS metadata exists)
- **Sharing** — share albums with family/friends via links
- **Metadata preserved** — EXIF data stays intact, no stripping
- **Sorting and cleanup** — browse by date timeline, filter by media type, bulk select and delete, archive photos you want to keep but hide from the main timeline
- **Trash bin** — deleted photos go to trash first, recoverable for 30 days

**Setup (Docker on laptop):**
```bash
# Download docker-compose.yml from Immich GitHub
mkdir ~/immich && cd ~/immich
wget https://github.com/immich-app/immich/releases/latest/download/docker-compose.yml
wget https://github.com/immich-app/immich/releases/latest/download/.env

# Edit .env — set UPLOAD_LOCATION to your external HDD path
# e.g., UPLOAD_LOCATION=/media/your-external-hdd/immich-photos

docker compose up -d
# Web UI at http://localhost:2283
```

**Does it need to be always online?**
No. Run it on-demand:
1. Plug in external HDD
2. `docker compose up -d` (starts Immich)
3. Open Immich app on iPhone — it syncs over WiFi
4. Browse, organize, clean up duplicates in web UI
5. `docker compose down` when done

The database and ML models live in Docker volumes on your laptop. Everything persists between sessions.

**Downsides:**
- Heavier resource usage (PostgreSQL + Redis + ML containers)
- First-time ML indexing takes a while on a laptop
- ~2-4 GB RAM usage when running

### Syncthing

**What it is:** A continuous file synchronization tool. No cloud, no accounts — devices sync directly peer-to-peer over local network or internet.

**How it works:** Pick folders on device A and device B, Syncthing keeps them identical. That's it.

**iPhone support — the catch:**
Syncthing does NOT have an official iOS app. There is a third-party app called **Möbius Sync** (~$5 one-time) that implements the Syncthing protocol on iOS. It works but has limitations:
- Runs in the background intermittently (iOS restricts background activity)
- Can sync the entire Camera Roll or selected albums
- Syncs reliably when the app is open, less reliably in background
- No smart photo management — it's just raw file sync

**What you get:**
- Photos synced as raw files to a folder on your laptop
- You organize them yourself (or use another tool)
- No face recognition, no search, no web UI, no duplicate detection
- Just files in folders

**Setup:**
```bash
# Install on laptop
sudo apt install syncthing  # or brew install syncthing on macOS

# Run it
syncthing
# Web UI at http://localhost:8384

# On iPhone: install Möbius Sync from App Store
# Pair devices via the web UI
# Select Camera Roll as sync folder
# Point sync destination to your external HDD
```

**Downsides:**
- No real iOS app (Möbius Sync is third-party, paid, limited)
- Background sync unreliable on iPhone
- No photo management features at all
- Just dumb file sync — you handle organization

### Comparison

| Feature | Immich | Syncthing |
|---------|--------|-----------|
| **iPhone app** | Official, free, works well | Third-party (Möbius Sync, ~$5), limited |
| **Auto backup** | Yes, reliable when app is open | Unreliable in background on iOS |
| **Face recognition** | Yes, automatic | No |
| **Search by content** | Yes ("beach", "dog", etc.) | No |
| **Duplicate detection** | Yes | No |
| **Web UI** | Full photo management | File list only |
| **Sorting/cleanup** | Timeline, albums, archive, bulk ops | Manual file management |
| **Map view** | Yes | No |
| **Resource usage** | Heavy (~2-4 GB RAM) | Light (~50 MB RAM) |
| **Complexity** | Docker setup, multiple containers | Single binary |
| **Metadata** | Preserved and indexed | Preserved (just copied) |
| **Always online?** | No, run on-demand | Needs both devices online to sync |
| **Open source** | Yes (AGPL) | Yes (MPL) |

### Recommendation

**Immich** if you want a real Google Photos replacement with smart features. The iPhone app works properly, face recognition is solid, and running it on-demand from your laptop with an external HDD is a perfectly valid setup.

**Syncthing** if you just want raw file transfer and will organize photos yourself. But the iPhone experience is significantly worse.

For the stated use case (escaping iCloud/Google Photos, preserving metadata, organizing and cleaning up), **Immich is the clear winner**.
