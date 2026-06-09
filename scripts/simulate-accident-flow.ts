#!/usr/bin/env tsx
import { argv } from 'node:process';

/**
 * simulate-accident-flow.ts
 * 
 * Runs a complete, live end-to-end integration and simulation of an accident tow job:
 *   1. Logs in as a dispatcher/owner.
 *   2. Automatically starts a driver shift (if off-shift).
 *   3. Creates an "Accident Recovery" job via the /jobs/intake API.
 *   4. Assigns the job to the driver.
 *   5. Transitions job state to 'enroute' and drives from the Yard to the Accident Scene (GPS telemetry pings).
 *   6. Reaches the scene, transitions to 'on_scene', and uploads a "pre-tow walkaround photo" base64 attachment.
 *   7. Transitions to 'in_progress' and drives from the Accident Scene to the Dropoff Yard.
 *   8. Reaches the destination and transitions to 'completed'.
 * 
 * Watch the updates happen live on your browser at http://localhost:3000/dispatch !
 */

const args = parseArgs(argv);
const API_URL = args.url || 'http://localhost:3001';
const EMAIL = args.email || 'owner@acme.test';
const PASSWORD = args.password || 'ChangeMe123!';
const DRIVER_EMAIL = args['driver-email'] || 'driver@acme.test';
const DRIVER_PASSWORD = args['driver-password'] || 'ChangeMe123!';
const INTERVAL_MS = Number(args.interval || '1500');

// Waypoints around Columbus, OH
const YARD = { lat: 39.992, lng: -82.955 };       // Joyce Ave Yard
const ACCIDENT = { lat: 39.9612, lng: -82.9988 }; // Downtown Columbus Accident Scene
const DROPOFF = { lat: 39.992, lng: -82.955 };    // Back to Yard / Storage

// Helper to generate a smooth path between coordinates
function generatePath(start: { lat: number; lng: number }, end: { lat: number; lng: number }, steps = 15) {
  const path: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lng: start.lng + (end.lng - start.lng) * t,
    });
  }
  return path;
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=');
      const key = parts[0];
      const val = parts.slice(1).join('=');
      if (key) result[key] = val;
    }
  }
  return result;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1x1 transparent pixel base64 GIF to simulate walkaround photo upload
const DUMMY_BASE64_PHOTO = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function run() {
  console.clear();
  console.log('\x1b[35m%s\x1b[0m', '🚨 US Tow Dispatch — Full Accident Flow Live Simulator');
  console.log('\x1b[90m%s\x1b[0m', '=======================================================');
  console.log(`📡 API endpoint:   ${API_URL}`);
  console.log(`👤 Seed Account:   ${EMAIL}`);
  console.log(`⏱️  Ping interval:  ${INTERVAL_MS}ms`);
  console.log('\x1b[90m%s\x1b[0m', '=======================================================\n');

  try {
    // 1. Authenticate
    console.log('🔑 Authenticating...');
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!loginRes.ok) {
      throw new Error(`Login failed (${loginRes.status}): ${await loginRes.text()}`);
    }
    const { accessToken } = (await loginRes.json()) as { accessToken: string };
    console.log('\x1b[32m  ✓ Connected successfully!\x1b[0m\n');

    // 2. Roster and Shift Bootstrap
    console.log('📋 Fetching driver roster...');
    const rosterRes = await fetch(`${API_URL}/dispatch/roster`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!rosterRes.ok) {
      throw new Error(`Roster fetch failed: ${await rosterRes.text()}`);
    }
    const roster = (await rosterRes.json()) as any[];
    const targetRow = roster.find(r => r.driver.role === 'driver' || r.driver.email === 'driver@acme.test') || roster[0];
    if (!targetRow) {
      throw new Error('No drivers found in the database. Please verify seeding.');
    }
    const { driver } = targetRow;
    let shiftId = targetRow.shift?.id;
    const isShiftActive = targetRow.shift && !targetRow.shift.endedAt;

    console.log(`🎯 Targeting Driver: \x1b[36m${driver.firstName} ${driver.lastName}\x1b[0m`);

    if (!isShiftActive) {
      console.log('🏁 Starting a fresh active shift for driver...');
      const trucksRes = await fetch(`${API_URL}/dispatch/trucks`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const trucks = (await trucksRes.json()) as any[];
      const availableTruck = trucks.find(t => t.inService) || trucks[0];

      const startShiftRes = await fetch(`${API_URL}/dispatch/shifts/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          driverId: driver.id,
          truckId: availableTruck?.id || undefined,
        }),
      });
      if (!startShiftRes.ok) {
        throw new Error(`Start shift failed: ${await startShiftRes.text()}`);
      }
      const newShift = (await startShiftRes.json()) as { id: string };
      shiftId = newShift.id;
      console.log(`\x1b[32m  ✓ Driver clocked on. Shift ID: ${shiftId}\x1b[0m\n`);
    } else {
      console.log(`\x1b[32m  ✓ Driver is already clocked on. Shift ID: ${shiftId}\x1b[0m\n`);
    }

    // 3. Create the Accident Tow Job
    console.log('🆕 Creating "Accident Towing" job via call intake...');
    const stamp = Date.now().toString(36).toUpperCase();
    const plate = `ACC-${stamp}`.slice(0, 8);
    const phone = `+15555${String(Date.now() % 1_000_000).padStart(6, '0')}`;

    const intakeRes = await fetch(`${API_URL}/jobs/intake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        customer: { name: 'Dispatch Accident Report', phone, email: 'accident-dispatch@acme.test' },
        vehicle: {
          plate,
          plateState: 'OH',
          year: 2022,
          make: 'Tesla',
          model: 'Model Y',
          vehicleClass: 'light_duty',
          vin: `5YJ3E1EA7KF${Math.floor(100000 + Math.random() * 900000)}`, // Generates a valid-looking 17-digit Tesla VIN
        },
        serviceType: 'tow',
        pickup: { address: 'I-70 Exit 100, Downtown Columbus', lat: ACCIDENT.lat, lng: ACCIDENT.lng },
        dropoff: { address: 'Acme Joyce Ave Yard, Columbus OH', lat: DROPOFF.lat, lng: DROPOFF.lng },
        authorizedBy: 'police',
      }),
    });

    if (!intakeRes.ok) {
      throw new Error(`Job intake failed: ${await intakeRes.text()}`);
    }
    const intakeData = (await intakeRes.json()) as { job: { id: string; jobNumber: string } };
    const jobId = intakeData.job.id;
    console.log(`\x1b[32m  ✓ Job Created! Job Number: #${intakeData.job.jobNumber}\x1b[0m\n`);

    // 4. Assign Job to Driver
    console.log(`🔗 Assigning Job #${intakeData.job.jobNumber} to driver ${driver.firstName}...`);
    const assignRes = await fetch(`${API_URL}/dispatch/jobs/${jobId}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ driverId: driver.id, shiftId }),
    });
    if (!assignRes.ok) {
      throw new Error(`Assignment failed: ${await assignRes.text()}`);
    }
    console.log('\x1b[32m  ✓ Job Assigned! Status is now: DISPATCHED\x1b[0m\n');
    await sleep(2000);

    // 4b. Authenticate as Driver
    console.log(`🔑 Authenticating as Driver (${driver.firstName})...`);
    const driverLoginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DRIVER_EMAIL, password: DRIVER_PASSWORD }),
    });
    if (!driverLoginRes.ok) {
      throw new Error(`Driver login failed (${driverLoginRes.status}): ${await driverLoginRes.text()}`);
    }
    const { accessToken: driverAccessToken } = (await driverLoginRes.json()) as { accessToken: string };
    console.log('\x1b[32m  ✓ Driver connected successfully!\x1b[0m\n');

    // 5. Transition to EN ROUTE and Drive to Scene
    console.log('⚡ Transitioning job status to: \x1b[33mEN ROUTE\x1b[0m');
    const transitionEnroute = await fetch(`${API_URL}/dispatch/jobs/${jobId}/transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({ to: 'enroute' }),
    });
    if (!transitionEnroute.ok) {
      throw new Error(`Transition to enroute failed: ${await transitionEnroute.text()}`);
    }
    console.log('%s', '🚛 Driver is moving! Simulating smooth GPS path to accident scene...\n');

    const pathToAccident = generatePath(YARD, ACCIDENT, 12);
    for (let i = 0; i < pathToAccident.length; i++) {
      const pt = pathToAccident[i]!;
      await fetch(`${API_URL}/dispatch/shifts/${shiftId}/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${driverAccessToken}`,
        },
        body: JSON.stringify({ lat: pt.lat, lng: pt.lng }),
      });
      process.stdout.write(`  [Drive to Scene] Ping ${i + 1}/${pathToAccident.length} | Lat: ${pt.lat.toFixed(5)}, Lng: ${pt.lng.toFixed(5)}\r`);
      await sleep(INTERVAL_MS);
    }
    console.log('\n\x1b[32m  ✓ Driver has arrived at the accident location!\x1b[0m\n');

    // 6. Transition to ON SCENE and Upload Photos
    console.log('⚡ Transitioning job status to: \x1b[33mON SCENE\x1b[0m');
    const transitionOnScene = await fetch(`${API_URL}/dispatch/jobs/${jobId}/transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({ to: 'on_scene' }),
    });
    if (!transitionOnScene.ok) {
      throw new Error(`Transition to on_scene failed: ${await transitionOnScene.text()}`);
    }

    console.log('📸 Uploading walkaround accident damage photo to S3/DB...');
    const photoRes = await fetch(`${API_URL}/dispatch/jobs/${jobId}/photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({
        fileName: 'accident_damage.gif',
        mimeType: 'image/gif',
        contentBase64: DUMMY_BASE64_PHOTO,
        capturedAt: new Date().toISOString(),
        lat: ACCIDENT.lat,
        lng: ACCIDENT.lng,
        tag: 'pre_tow_front_left',
      }),
    });
    if (!photoRes.ok) {
      throw new Error(`Photo upload failed: ${await photoRes.text()}`);
    }
    console.log('\x1b[32m  ✓ Pre-tow damage photo uploaded successfully!\x1b[0m\n');
    console.log('⏳ Hooking up and securing the vehicle (waiting 3 seconds)...');
    await sleep(3000);

    // 7. Transition to IN PROGRESS (Towing) and Drive to Dropoff
    console.log('⚡ Transitioning job status to: \x1b[33mIN PROGRESS (Towing)\x1b[0m');
    const transitionInProgress = await fetch(`${API_URL}/dispatch/jobs/${jobId}/transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({ to: 'in_progress' }),
    });
    if (!transitionInProgress.ok) {
      throw new Error(`Transition to in_progress failed: ${await transitionInProgress.text()}`);
    }
    console.log('%s', '🚛 Flatbed loaded. Driving back to drop-off yard...\n');

    const pathToYard = generatePath(ACCIDENT, DROPOFF, 12);
    for (let i = 0; i < pathToYard.length; i++) {
      const pt = pathToYard[i]!;
      await fetch(`${API_URL}/dispatch/shifts/${shiftId}/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${driverAccessToken}`,
        },
        body: JSON.stringify({ lat: pt.lat, lng: pt.lng }),
      });
      process.stdout.write(`  [Towing to Yard] Ping ${i + 1}/${pathToYard.length} | Lat: ${pt.lat.toFixed(5)}, Lng: ${pt.lng.toFixed(5)}\r`);
      await sleep(INTERVAL_MS);
    }
    console.log('\n\x1b[32m  ✓ Flatbed arrived back at Joyce Ave Yard!\x1b[0m\n');

    // 8. Transition to COMPLETED
    console.log('⚡ Transitioning job status to: \x1b[32mCOMPLETED\x1b[0m');
    const transitionCompleted = await fetch(`${API_URL}/dispatch/jobs/${jobId}/transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({ to: 'completed' }),
    });
    if (!transitionCompleted.ok) {
      throw new Error(`Transition to completed failed: ${await transitionCompleted.text()}`);
    }

    console.log('\x1b[90m%s\x1b[0m', '=======================================================');
    console.log('\x1b[32m%s\x1b[0m', '🎉 ACCIDENT TOW LIFE CYCLE LIVE TEST COMPLETED SUCCESSFULLY!');
    console.log('  - Driver shift was verified/started.');
    console.log('  - Accident job was dynamically created and assigned.');
    console.log('  - En-route telemetry tracked successfully.');
    console.log('  - Incident scene arrivals, pre-tow walkaround photos logged.');
    console.log('  - Dropoff completed and archived.');
    console.log('\x1b[90m%s\x1b[0m', '=======================================================');

  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `\n❌ Simulation Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

run();
