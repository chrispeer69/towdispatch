/**
 * DispatchEventsService — the API-side fan-out point for live dispatch
 * events. Services (JobsService, ShiftsService) call into here when state
 * changes; the DispatchGateway listens and re-emits to the right tenant
 * room.
 *
 * Decoupling the emit from the gateway lets the services stay pure
 * (no Socket.IO objects in service code) and lets us test the event flow
 * with a plain in-process subscriber. The gateway subscribes once at boot.
 */
import { Injectable } from '@nestjs/common';
import type {
  DispatchEventName,
  DriverLocationChangedEvent,
  DriverShiftEndedEvent,
  DriverShiftStartedEvent,
  DriverStatusChangedEvent,
  ImpoundOpenedEvent,
  ImpoundReleasedEvent,
  JobAssignedEvent,
  JobCreatedEvent,
  JobStatusChangedEvent,
  JobUnassignedEvent,
  TrackingLinkSummaryEvent,
  TrackingMessageReceivedEvent,
} from '@ustowdispatch/shared';
import { DISPATCH_EVENTS } from '@ustowdispatch/shared';

export type DispatchEventPayload =
  | { name: typeof DISPATCH_EVENTS.JOB_CREATED; payload: JobCreatedEvent }
  | { name: typeof DISPATCH_EVENTS.JOB_ASSIGNED; payload: JobAssignedEvent }
  | { name: typeof DISPATCH_EVENTS.JOB_UNASSIGNED; payload: JobUnassignedEvent }
  | { name: typeof DISPATCH_EVENTS.JOB_STATUS_CHANGED; payload: JobStatusChangedEvent }
  | { name: typeof DISPATCH_EVENTS.DRIVER_LOCATION_CHANGED; payload: DriverLocationChangedEvent }
  | { name: typeof DISPATCH_EVENTS.DRIVER_SHIFT_STARTED; payload: DriverShiftStartedEvent }
  | { name: typeof DISPATCH_EVENTS.DRIVER_SHIFT_ENDED; payload: DriverShiftEndedEvent }
  | { name: typeof DISPATCH_EVENTS.DRIVER_STATUS_CHANGED; payload: DriverStatusChangedEvent }
  | { name: typeof DISPATCH_EVENTS.TRACKING_LINK_CREATED; payload: TrackingLinkSummaryEvent }
  | { name: typeof DISPATCH_EVENTS.TRACKING_LINK_UPDATED; payload: TrackingLinkSummaryEvent }
  | { name: typeof DISPATCH_EVENTS.TRACKING_LINK_VIEWED; payload: TrackingLinkSummaryEvent }
  | {
      name: typeof DISPATCH_EVENTS.TRACKING_MESSAGE_RECEIVED;
      payload: TrackingMessageReceivedEvent;
    }
  | { name: typeof DISPATCH_EVENTS.IMPOUND_OPENED; payload: ImpoundOpenedEvent }
  | { name: typeof DISPATCH_EVENTS.IMPOUND_RELEASED; payload: ImpoundReleasedEvent };

export type DispatchSubscriber = (
  tenantId: string,
  event: DispatchEventPayload,
) => void | Promise<void>;

@Injectable()
export class DispatchEventsService {
  private readonly subscribers = new Set<DispatchSubscriber>();

  subscribe(sub: DispatchSubscriber): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  /**
   * Fire-and-forget. Errors in a subscriber must not prevent other
   * subscribers from running.
   */
  emit(tenantId: string, name: DispatchEventName, payload: unknown): void {
    const event = { name, payload } as DispatchEventPayload;
    for (const sub of this.subscribers) {
      try {
        const r = sub(tenantId, event);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch(() => {
            /* swallow — gateway logs internally */
          });
        }
      } catch {
        /* swallow */
      }
    }
  }
}
