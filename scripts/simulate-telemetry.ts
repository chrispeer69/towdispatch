#!/usr/bin/env tsx
import { argv } from 'node:process';

/**
 * live-telemetry-simulator.ts
 * 
 * Simulates real-time telemetry tracking for a driver by sending smooth,
 * successive GPS coordinate pings to the US Tow Dispatch HTTP API.
 * 
 * Since this operates purely over the HTTP API, it can be run locally,
 * on a staging environment, or in production.
 * 
 * Prerequisites:
 *   - The backend API must be running.
 *   - The database must be seeded (e.g. `pnpm db:seed:demo`).
 * 
 * Usage:
 *   pnpm tsx scripts/simulate-telemetry.ts [options]
 * 
 * Options:
 *   --url=http://localhost:3001       API public URL
 *   --email=chris@roadside.demo       Operator/manager login email
 *   --password=TempPass#001           Operator/manager login password
 *   --driver-index=0                  Index of the driver in the roster to simulate
 *   --interval=2000                   Delay in milliseconds between GPS pings
 *   --steps=100                       Number of simulation steps to run
 */

const args = parseArgs(argv);

const API_URL = args.url || 'http://localhost:3001';
const EMAIL = args.email || 'chris@roadside.demo';
const PASSWORD = args.password || 'TempPass#001';
const INTERVAL_MS = Number(args.interval || '2000');
const MAX_STEPS = Number(args.steps || '100');
const DRIVER_INDEX = Number(args['driver-index'] || '0');

// Coordinates around Columbus, OH for a realistic, smooth driving trajectory.
// Starts at Main Yard, drives around downtown/Ohio State University, then returns.
const BASE_LAT = 39.992;
const BASE_LNG = -82.955;
const WAYPOINTS = [
  { lat: 39.992, lng: -82.955 }, // Joyce Ave Yard
  { lat: 39.985, lng: -82.980 }, // Towards OSU
  { lat: 39.978, lng: -83.000 }, // High St / Short North
  { lat: 39.961, lng: -83.002 }, // Downtown Columbus
  { lat: 39.955, lng: -82.990 }, // German Village
  { lat: 39.965, lng: -82.960 }, // Heading east
  { lat: 39.992, lng: -82.955 }, // Back to yard
];

// Helper to generate a smooth intermediate path between waypoints
function generateSmoothPath(steps: number): { lat: number; lng: number }[] {
  const path: { lat: number; lng: number }[] = [];
  const segments = WAYPOINTS.length - 1;
  const stepsPerSegment = Math.ceil(steps / segments);

  for (let i = 0; i < segments; i++) {
    const start = WAYPOINTS[i]!;
    const end = WAYPOINTS[i + 1]!;
    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      path.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lng: start.lng + (end.lng - start.lng) * t,
      });
    }
  }
  return path.slice(0, steps);
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

async function run() {
  console.clear();
  console.log('\x1b[32m%s\x1b[0m', '⚡ US Tow Dispatch — Live Telemetry Simulator');
  console.log('\x1b[90m%s\x1b[0m', '---------------------------------------------------');
  console.log(`📡 Target API:      ${API_URL}`);
  console.log(`👤 Operator Account:${EMAIL}`);
  console.log(`⏱️  Ping Interval:   ${INTERVAL_MS}ms`);
  console.log(`📈 Total Steps:     ${MAX_STEPS}`);
  console.log('\x1b[90m%s\x1b[0m', '---------------------------------------------------\n');

  try {
    // 1. Operator Login
    console.log('🔑 Authenticating operator...');
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    if (!loginRes.ok) {
      const errorText = await loginRes.text();
      throw new Error(`Login failed (${loginRes.status}): ${errorText}`);
    }

    const { accessToken } = (await loginRes.json()) as { accessToken: string };
    console.log('\x1b[32m%s\x1b[0m', '  ✓ Authentication successful!\n');

    // 2. Fetch Active Roster
    console.log('📋 Fetching active roster...');
    const rosterRes = await fetch(`${API_URL}/dispatch/roster`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!rosterRes.ok) {
      throw new Error(`Failed to fetch roster (${rosterRes.status})`);
    }

    const roster = (await rosterRes.json()) as any[];
    if (roster.length === 0) {
      throw new Error('No drivers found in the active roster. Have you seeded the database?');
    }

    console.log(`  ✓ Found ${roster.length} drivers:`);
    roster.forEach((row, i) => {
      const onShift = row.shift && !row.shift.endedAt;
      console.log(
        `    [${i}] ${row.driver.firstName} ${row.driver.lastName} (Shift: ${
          onShift ? `ACTIVE - ID ${row.shift.id.slice(0, 8)}…` : 'OFF-SHIFT'
        })`
      );
    });
    console.log('');

    const targetRow = roster[DRIVER_INDEX];
    if (!targetRow) {
      throw new Error(`Driver index ${DRIVER_INDEX} out of bounds.`);
    }

    const { driver } = targetRow;
    console.log('\x1b[35m%s\x1b[0m', `🎯 Simulating driver: ${driver.firstName} ${driver.lastName}`);

    // 3. Ensure Driver has an Active Shift
    let shiftId = targetRow.shift?.id;
    const isShiftActive = targetRow.shift && !targetRow.shift.endedAt;

    if (!isShiftActive) {
      console.log(`🏁 Driver is off-shift. Starting an active shift automatically...`);
      
      // Let's grab the first available truck or primary truck assigned to start shift
      const trucksRes = await fetch(`${API_URL}/dispatch/trucks`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const trucks = (await trucksRes.json()) as any[];
      const availableTruck = trucks.find(t => t.inService && t.status === 'active');

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
        const errBody = await startShiftRes.text();
        throw new Error(`Failed to start shift: ${errBody}`);
      }

      const newShift = (await startShiftRes.json()) as { id: string };
      shiftId = newShift.id;
      console.log('\x1b[32m%s\x1b[0m', `  ✓ Shift started successfully! Shift ID: ${shiftId}\n`);
    } else {
      console.log('\x1b[32m%s\x1b[0m', `  ✓ Using existing active shift: ${shiftId}\n`);
    }

    // 4. Generate Smooth Path Points
    const pathPoints = generateSmoothPath(MAX_STEPS);
    console.log(`🗺️  Generated smooth path with ${pathPoints.length} GPS pings.`);
    console.log(`🚀 Starting simulation loops. Open http://localhost:3000/dispatch to watch live!`);
    console.log('\x1b[90m%s\x1b[0m', 'Press Ctrl+C to stop simulation at any time.');
    console.log('\x1b[90m%s\x1b[0m', '---------------------------------------------------');

    // Register cleanup to end shift if desired
    let shouldEndShiftOnExit = false;
    process.on('SIGINT', async () => {
      console.log('\n🛑 Simulation interrupted by user.');
      if (shouldEndShiftOnExit && shiftId) {
        console.log('⌛ Clocking driver off shift...');
        await fetch(`${API_URL}/dispatch/shifts/end`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ shiftId }),
        });
        console.log('✓ Clocked off successfully.');
      }
      process.exit(0);
    });

    // 5. Telemetry Ping Loop
    for (let step = 0; step < pathPoints.length; step++) {
      const point = pathPoints[step]!;
      const percent = Math.round(((step + 1) / pathPoints.length) * 100);
      const progressBar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));

      const pingRes = await fetch(`${API_URL}/dispatch/shifts/${shiftId}/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          lat: point.lat,
          lng: point.lng,
        }),
      });

      if (!pingRes.ok) {
        console.log(`\x1b[31m⚠️  Ping failed at step ${step + 1}/${pathPoints.length} (${pingRes.statusText})\x1b[0m`);
      } else {
        process.stdout.write(
          `\r[${progressBar}] ${percent}% | Step ${step + 1}/${MAX_STEPS} | Coords: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
        );
      }

      await sleep(INTERVAL_MS);
    }

    console.log('\n\n\x1b[32m%s\x1b[0m', '🎉 Simulation complete! Driver arrived back at yard.');
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', `\n❌ Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

run();
