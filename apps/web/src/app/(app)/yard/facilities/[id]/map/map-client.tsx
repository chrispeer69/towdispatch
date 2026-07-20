'use client';
import { useUser } from '@/components/app-shell/session-provider';
import * as yard from '@/lib/api/yard-client';
import {
  type YardFacilityDto,
  type YardStallDetailDto,
  type YardStallDto,
  type YardStallType,
  yardStallTypeValues,
} from '@ustowdispatch/shared';
import Link from 'next/link';
import { type DragEvent, type JSX, useState } from 'react';

const WRITER_ROLES = new Set(['owner', 'admin', 'dispatcher']);
const inputCls =
  'bg-bg-base border border-border-on-dark rounded-md px-2 py-1 text-sm focus:outline-none focus:border-accent-orange';

const TYPE_TONE: Record<YardStallType, string> = {
  standard: 'border-border-on-dark',
  oversized: 'border-blue-500',
  covered: 'border-purple-500',
  secure: 'border-amber-500',
  hazmat: 'border-red-500',
  ev: 'border-emerald-500',
};

const GRID = 12; // columns

export function StallMapClient({
  facility,
  initialStalls,
}: {
  facility: YardFacilityDto;
  initialStalls: YardStallDto[];
}): JSX.Element {
  const user = useUser();
  const canWrite = WRITER_ROLES.has(user.role);
  const [stalls, setStalls] = useState(initialStalls);
  const [selected, setSelected] = useState<YardStallDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<YardStallType>('standard');

  const occupied = stalls.filter((s) => s.occupiedByImpoundId).length;

  function patch(updated: YardStallDto): void {
    setStalls((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  async function addStall(): Promise<void> {
    if (!newLabel.trim()) return;
    setError(null);
    try {
      const free = nextFreeCell(stalls);
      const created = await yard.createStall(facility.id, {
        label: newLabel.trim(),
        stallType: newType,
        x: free.x,
        y: free.y,
      });
      setStalls((s) => [...s, created]);
      setNewLabel('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function openStall(id: string): Promise<void> {
    setError(null);
    try {
      setSelected(await yard.getStall(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onDrop(e: DragEvent, x: number, y: number): void {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/stall');
    if (!id) return;
    setStalls((prev) => prev.map((s) => (s.id === id ? { ...s, x, y } : s)));
    setDirty(true);
  }

  async function saveLayout(): Promise<void> {
    setError(null);
    try {
      const updated = await yard.bulkLayout(facility.id, {
        stalls: stalls.map((s) => ({ id: s.id, x: s.x, y: s.y, stallType: s.stallType })),
      });
      setStalls(updated);
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/yard/facilities" className="text-xs text-accent-orange">
            ← Facilities
          </Link>
          <h1 className="text-2xl font-bold">{facility.name} — Stall Map</h1>
          <p className="text-xs text-text-secondary-on-dark">
            {stalls.length} stalls - {occupied} occupied - {stalls.length - occupied} open
          </p>
        </div>
        {canWrite && dirty && (
          <button
            type="button"
            onClick={saveLayout}
            className="rounded-md bg-accent-orange px-4 py-2 text-sm font-semibold text-black"
          >
            Save layout
          </button>
        )}
      </header>

      {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={inputCls}
            placeholder="Stall label (e.g. A1)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            aria-label="Stall label"
          />
          <select
            className={inputCls}
            value={newType}
            onChange={(e) => setNewType(e.target.value as YardStallType)}
            aria-label="Stall type"
          >
            {yardStallTypeValues.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addStall}
            className="rounded-md border border-border-on-dark px-3 py-1 text-sm"
          >
            Add stall
          </button>
        </div>
      )}

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: GRID * gridRows(stalls) }).map((_, idx) => {
          const x = idx % GRID;
          const y = Math.floor(idx / GRID);
          const stall = stalls.find((s) => s.x === x && s.y === y);
          if (!stall) {
            return (
              <div
                key={`empty-${x}-${y}`}
                onDragOver={(e) => canWrite && e.preventDefault()}
                onDrop={(e) => canWrite && onDrop(e, x, y)}
                className="aspect-square rounded-md border border-dashed border-border-on-dark/40"
              />
            );
          }
          const isOccupied = Boolean(stall.occupiedByImpoundId);
          return (
            <button
              key={stall.id}
              type="button"
              draggable={canWrite}
              onDragStart={(e) => e.dataTransfer.setData('text/stall', stall.id)}
              onDragOver={(e) => canWrite && e.preventDefault()}
              onDrop={(e) => canWrite && onDrop(e, x, y)}
              onClick={() => openStall(stall.id)}
              title={`${stall.label} - ${stall.stallType}`}
              className={`aspect-square rounded-md border-2 p-1 text-[10px] ${TYPE_TONE[stall.stallType]} ${
                isOccupied ? 'bg-accent-orange/30' : 'bg-bg-surface-elevated'
              }`}
            >
              <span className="block font-semibold">{stall.label}</span>
              <span className="block text-text-secondary-on-dark">
                {isOccupied ? 'occupied' : 'open'}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <StallDetail
          detail={selected}
          canWrite={canWrite}
          onClose={() => setSelected(null)}
          onChanged={(s) => {
            patch(s);
            void openStall(s.id);
          }}
          onError={setError}
        />
      )}
    </section>
  );
}

function StallDetail({
  detail,
  canWrite,
  onClose,
  onChanged,
  onError,
}: {
  detail: YardStallDetailDto;
  canWrite: boolean;
  onClose: () => void;
  onChanged: (s: YardStallDto) => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [impoundId, setImpoundId] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  async function assign(): Promise<void> {
    try {
      onChanged(await yard.assignStall(detail.stall.id, impoundId.trim()));
      setImpoundId('');
    } catch (err) {
      onError((err as Error).message);
    }
  }
  async function release(): Promise<void> {
    try {
      onChanged(await yard.releaseStall(detail.stall.id));
    } catch (err) {
      onError((err as Error).message);
    }
  }
  async function addPhoto(): Promise<void> {
    try {
      await yard.registerStallPhoto(detail.stall.id, {
        photoUrl: photoUrl.trim(),
        photoType: 'overview',
      });
      setPhotoUrl('');
      onChanged(detail.stall);
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: <dialog>.showModal() doesn't fit our React-controlled open state — same pattern as settings/services/service-catalog-form.tsx.
      role="dialog"
      aria-modal="true"
      aria-labelledby="stall-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-md space-y-4 rounded-md border border-border-on-dark bg-bg-surface-elevated p-5">
        <header className="flex items-center justify-between">
          <h2 id="stall-detail-title" className="text-lg font-bold">
            Stall {detail.stall.label} - {detail.stall.stallType}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-secondary-on-dark"
          >
            ✕
          </button>
        </header>

        {detail.occupant ? (
          <div className="rounded-md bg-bg-base p-3 text-sm">
            <p className="font-semibold">{detail.occupant.vehicleDescription}</p>
            <p className="text-text-secondary-on-dark">
              {detail.occupant.licensePlate ?? 'no plate'} - {detail.occupant.status}
            </p>
            {canWrite && (
              <button type="button" onClick={release} className="mt-2 text-sm text-accent-orange">
                Release stall
              </button>
            )}
          </div>
        ) : (
          canWrite && (
            <div className="flex gap-2">
              <input
                className={`${inputCls} flex-1`}
                placeholder="Impound record ID to assign"
                value={impoundId}
                onChange={(e) => setImpoundId(e.target.value)}
                aria-label="Impound record ID"
              />
              <button
                type="button"
                onClick={assign}
                className="rounded-md bg-accent-orange px-3 py-1 text-sm font-semibold text-black"
              >
                Assign
              </button>
            </div>
          )
        )}

        <div>
          <h3 className="mb-1 text-sm font-semibold">Photos ({detail.photos.length})</h3>
          <div className="flex flex-wrap gap-2">
            {detail.photos.map((p) => (
              <a
                key={p.id}
                href={p.photoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent-orange underline"
              >
                {p.photoType}
              </a>
            ))}
          </div>
          {canWrite && (
            <div className="mt-2 flex gap-2">
              <input
                className={`${inputCls} flex-1`}
                placeholder="https://photo-url"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                aria-label="Photo URL"
              />
              <button
                type="button"
                onClick={addPhoto}
                className="rounded-md border border-border-on-dark px-3 py-1 text-sm"
              >
                Add
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function gridRows(stalls: YardStallDto[]): number {
  const maxY = stalls.reduce((m, s) => Math.max(m, s.y), 0);
  return Math.max(4, maxY + 2);
}

function nextFreeCell(stalls: YardStallDto[]): { x: number; y: number } {
  const taken = new Set(stalls.map((s) => `${s.x},${s.y}`));
  for (let y = 0; y < 1000; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!taken.has(`${x},${y}`)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}
