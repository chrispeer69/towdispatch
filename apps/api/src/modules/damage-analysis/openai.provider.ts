/**
 * OpenAIDamageProvider — GPT-4o vision via the Chat Completions API (Photo
 * Damage Analysis, Session 42).
 *
 * Raw `fetch` against /v1/chat/completions — no SDK dependency (see
 * AnthropicDamageProvider for the rationale). Photos are inlined as
 * base64 data-URL image parts; response_format json_object nudges the
 * model toward a clean envelope, which the shared parser validates.
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

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

@Injectable()
export class OpenAIDamageProvider implements DamageProvider {
  readonly id = 'openai' as const;
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
        type: 'image_url',
        image_url: { url: `data:${p.mimeType};base64,${p.base64}` },
      });
    }

    let res: Response;
    try {
      res = await fetch(OPENAI_CHAT_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content }],
        }),
      });
    } catch (err) {
      throw new DamageProviderError(`openai request failed: ${String(err)}`, true);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const transient = res.status === 429 || res.status >= 500;
      throw new DamageProviderError(`openai ${res.status}: ${body.slice(0, 500)}`, transient);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    const findings = parseVisionFindings(extractJsonBlock(text));
    return { findings, raw: json, model: this.model };
  }
}
