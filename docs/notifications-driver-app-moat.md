# Driver-app notification moat

> **Status**: Session-15 backend + Android contract. iOS Session 6 must match this contract.

## Why this is a moat

Every competitor we've benchmarked fails on the same axis: a driver, hands-busy
in a glove behind a closed cab window, with Bluetooth audio in the truck and DND
on the phone, does not hear the dispatch. The job sits in their tray for
several minutes. The next driver in queue gets it via re-dispatch. The
customer is angry. Revenue lost.

If we are the one platform that always wakes the driver, we win every
RFP that has a busy fleet on the other side of the table.

## Contract

A "job_assigned" push must, end-to-end:

1. **Bypass Do Not Disturb.** Channel `towcommand_jobs_emergency` is
   created with `setBypassDnd(true)`. The driver app prompts for the
   "Do Not Disturb access" permission at first login. If denied,
   the app prompts again before the first shift starts (Phase 2).
2. **Make a distinct, loud sound.** Custom `new_job_alert.mp3` ships in
   `res/raw/`. Channel `setSound(uri, AudioAttributes.USAGE_ALARM)`.
   Audio attrs are USAGE_ALARM so the OS routes it through the alarm
   stream, not media — alarm-stream volume is independent of media,
   meaning Bluetooth audio doesn't mute the alert.
3. **Vibrate aggressively at the channel level.** A user-disabled
   haptic preference cannot override a channel-level vibration in
   Android 8+. The pattern is `[0, 700, 200, 700, 200, 700]` — three
   long pulses with short gaps. Felt through a glove.
4. **Show on the lockscreen with full content.** `lockscreenVisibility =
   VISIBILITY_PUBLIC`. A driver glancing at the phone reads pickup
   address without unlocking — critical when wearing gloves.
5. **Stay persistent until handled.** `setOngoing(true)` on emergency
   builds keeps the banner sticky. The driver must explicitly accept,
   decline, or open. We do not auto-dismiss after a timeout.
6. **Survive a backgrounded / force-stopped app.** The FCM payload carries
   BOTH `notification` and `data` blocks. The `notification` block lets
   the system tray fire even when our service is dead; the `data` block
   lets our service (when alive) apply the moat steps above.
7. **Wake the device through Doze.** `android.priority='HIGH'` on the
   FCM payload + `direct_boot_ok=true` push the message through the
   doze-mode throttle.
8. **Carry a deep link.** Tapping the notification opens the job detail
   screen with the job already loaded — see `MainActivity` deep-link
   handling. Latency goal: < 1 second from tap to map render.

## Foreground-service fallback

Even with every guarantee above, FCM is not 100%. We measured a
sub-percent drop rate in our pilot. Sub-percent over 1000 dispatches a
day is still ~10 missed jobs. Unacceptable for the moat.

The fallback (`PendingJobsPoller.kt`):

* The driver app keeps a long-running foreground service while a shift
  is active (Session 7 — `LocationService`).
* That service tracks the time of the most-recent FCM message
  (`recordFcmDelivery()` is called from `DriverFcmService.onMessageReceived`).
* If 30 seconds pass without an FCM, the poller begins hitting
  `GET /dispatch/driver/jobs/pending` every 15 seconds.
* When a poll returns a job we don't currently have surfaced, the
  foreground service raises a notification through the same emergency
  channel — same sound, same vibration, same banner — and notes the
  receipt as "fallback" in our delivery log via the same self-report
  path FCM uses.
* When FCM resumes, `recordFcmDelivery()` cancels the polling loop to
  conserve battery.

Battery cost analysis: a 5-second timeout per poll × 4 polls per minute
× ~20 mA average background-radio draw ≈ 0.7 mAh / hour of fallback
mode. A typical 8-hour shift in fully-degraded FCM costs < 1% battery.
Negligible.

## Verification matrix

Every release must pass this matrix on a real device:

| Scenario                                | Expected result                                          |
| --------------------------------------- | -------------------------------------------------------- |
| App in foreground                       | Banner + sound + vibration                               |
| App in background                       | Banner + sound + vibration                               |
| App force-stopped                       | Banner + sound + vibration (system tray path)            |
| DND on                                  | Banner + sound + vibration (channel bypasses DND)        |
| Phone on Bluetooth audio                | Alert audible on phone speaker AND BT (alarm stream)     |
| Phone in pocket, gloves on              | Vibration distinguishable from any other pattern         |
| Network drops mid-shift, FCM stale      | Foreground poller picks up job within ~45s               |
| FCM resumes after a fallback poll       | Polling stops within 15s, single FCM banner appears      |
| Phone in CarPlay/Android Auto cradle    | Audio routed via car speakers                            |
| Phone screen off, lockscreen on         | Lockscreen shows full pickup address                     |
| Doze mode (phone untouched > 1 hour)    | HIGH-priority push wakes device                          |

If any cell in the matrix regresses, treat it as a P0. Document the regression
in `docs/sessions/session-XX-report.md` and ship a fix before a release.

## iOS contract (Session 6 — to match)

When the iOS app ships, the equivalent contract is:

* Notification category: `TOWCOMMAND_JOB_OPEN`
* `interruption-level: critical` (requires Apple's CriticalAlerts entitlement)
* `aps-sound: new_job_alert.caf` shipped in the bundle
* Background app refresh enabled + the same `/dispatch/driver/jobs/pending`
  fallback poll via `BGAppRefreshTask`
* Lock-screen Live Activity for the in-flight job (iOS 16+)

PushAdapter already builds the APNs payload; the iOS app needs to register
for critical alerts on first launch.
