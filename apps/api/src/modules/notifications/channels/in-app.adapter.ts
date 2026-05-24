/**
 * InAppAdapter — the simplest channel: there is no external provider call.
 *
 * The dispatcher persists the delivery row before this adapter runs, so all
 * we do here is flip the row to `delivered` and emit a socket event for any
 * active client subscription. The status callback path used by SMS/email
 * doesn't apply: the moment the row is in the DB the notification is
 * delivered for in-app purposes.
 *
 * A future enhancement is to use the existing dispatch Socket.IO gateway to
 * push the new row to connected web/mobile clients. We keep that wiring out
 * of this commit so the gateway dependency stays a one-way arrow (dispatch
 * → notifications, not the reverse) until the gateway gains a dedicated
 * notifications channel.
 */
import { Injectable } from '@nestjs/common';
import type {
  ChannelAdapter,
  ChannelSendInput,
  ChannelSendResult,
} from './channel-adapter.interface.js';

@Injectable()
export class InAppAdapter implements ChannelAdapter {
  readonly channel = 'in_app' as const;
  readonly providerName = 'in_app';
  readonly isLive = true;

  async send(_input: ChannelSendInput): Promise<ChannelSendResult> {
    // The body / subject have already been persisted onto the delivery row
    // by the dispatcher; nothing to send.
    return {
      status: 'delivered',
      providerMessageId: null,
      providerName: this.providerName,
    };
  }
}
