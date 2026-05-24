/**
 * AnthropicDamageProvider — Claude vision via the Messages API (Photo
 * Damage Analysis, Session 42).
 *
 * Raw `fetch` against /v1/messages — no SDK dependency (Rule 4: no new
 * external deps; this path is not exercised in CI, the stub is). Photo
 * bytes are inlined as base64 image blocks; the structured-JSON reply is
 * extracted + validated by the shared parser. Only non-PII vehicle hints
 * reach the API.
 */
import { Injectable } from '@nestjs/common';
import type { DamagePhase, VehicleContext } from '@ustowdispatch/shared';
import {
  type DamageAnalyzeResult,
  type DamagePhoto,
  type DamageProvider,
  DamageProviderError,
  buildVisionInstruction,
  extractJsonBlock,
  parseVisionFindings,
} from './provider.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

@Injectable()
export class AnthropicDamageProvider implements DamageProvider {
  readonly id = 'anthropic' as const;
  readonly requiresImageBytes = true;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async analyze(
    photos: DamagePhoto[],
    phase: DamagePhase,
    vehicle: VehicleContext,
  ): Promise<DamageAnalyzeResult> {
    const instruction = buildVisionInstruction(phase, vehicle);
    const content: unknown[] = [{ type: 'text', text: instruction }];
    for (const p of photos) {
      if (!p.base64) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: p.mimeType, data: p.base64 },
      });
    }

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1500,
          messages: [{ role: 'user', content }],
        }),
      });
    } catch (err) {
      throw new DamageProviderError(`anthropic request failed: ${String(err)}`, true);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 408/409/425/429 + 5xx are retryable; other 4xx (auth, bad request) are not.
      const transient = res.status === 429 || res.status >= 500;
      throw new DamageProviderError(`anthropic ${res.status}: ${body.slice(0, 500)}`, transient);
    }

    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
    const findings = parseVisionFindings(extractJsonBlock(text));
    return { findings, raw: json, model: this.model };
  }
}
