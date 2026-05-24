import { describe, expect, it } from 'vitest';
import {
  type VoiceParseContext,
  extractConfirmation,
  extractMinutes,
  extractReason,
  parseIntent,
} from './voice-intent.parser.js';

const DEFAULT: VoiceParseContext = { confidenceThreshold: 0.75 };

function intentOf(transcript: string, ctx: VoiceParseContext = DEFAULT): string {
  return parseIntent(transcript, ctx).intent;
}

describe('parseIntent — happy path for each of the 12 intents', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['accept this job', 'accept_job'],
    ["I'll take it", 'accept_job'],
    ['decline this job', 'decline_job'],
    ["I can't take this", 'decline_job'],
    ['en route', 'en_route'],
    ['on my way', 'en_route'],
    ["I'm on scene", 'arrive_on_scene'],
    ['arrived at the location', 'arrive_on_scene'],
    ['vehicle is loaded', 'vehicle_loaded'],
    ['hooked up', 'vehicle_loaded'],
    ['heading to the drop', 'en_route_drop'],
    ['arrived at the drop off', 'arrive_drop'],
    ['clear the job', 'clear_job'],
    ['all done', 'clear_job'],
    ['I need backup', 'request_help'],
    ["what's the address", 'repeat_address'],
    ['ETA twenty minutes', 'eta_update'],
    ['my truck broke down', 'mark_breakdown'],
  ];

  for (const [transcript, expected] of cases) {
    it(`"${transcript}" → ${expected}`, () => {
      const r = parseIntent(transcript, DEFAULT);
      expect(r.intent).toBe(expected);
      expect(r.confidence).toBeGreaterThanOrEqual(DEFAULT.confidenceThreshold);
      expect(r.rawIntent).toBe(expected);
    });
  }
});

describe('parseIntent — repeat_address phrasings', () => {
  for (const t of [
    "what's the address",
    'what is the address',
    'repeat the address',
    'address again',
  ]) {
    it(`"${t}" → repeat_address`, () => {
      expect(intentOf(t)).toBe('repeat_address');
    });
  }
});

describe('parseIntent — drop-phase vs pickup-phase disambiguation', () => {
  it('prefers arrive_drop over arrive_on_scene when "drop" is present', () => {
    expect(intentOf('I just arrived at the drop')).toBe('arrive_drop');
  });

  it('prefers en_route_drop over en_route when "drop" is present', () => {
    expect(intentOf('heading over to the drop now')).toBe('en_route_drop');
  });

  it('bare "arrived" with no drop word is on-scene', () => {
    expect(intentOf("arrived, I'm here")).toBe('arrive_on_scene');
  });
});

describe('parseIntent — ambiguous transcripts downgrade to clarify', () => {
  for (const t of ['uhh what now', 'the thing over there', 'um hello', 'asdf qwerty']) {
    it(`"${t}" → clarify (confidence 0, no raw match)`, () => {
      const r = parseIntent(t, DEFAULT);
      expect(r.intent).toBe('clarify');
      expect(r.confidence).toBe(0);
      expect(r.rawIntent).toBeNull();
      expect(r.suggestedRephrase).toBeTruthy();
    });
  }
});

describe('parseIntent — confidence threshold edge', () => {
  it('a weak single-keyword match falls below the default threshold → clarify', () => {
    const r = parseIntent('help', DEFAULT);
    expect(r.intent).toBe('clarify');
    expect(r.rawIntent).toBe('request_help'); // raw guess preserved for logging
    expect(r.confidence).toBeLessThan(0.75);
  });

  it('lowering the threshold lets the same weak match through', () => {
    const r = parseIntent('help', { confidenceThreshold: 0.5 });
    expect(r.intent).toBe('request_help');
  });

  it('a medium-confidence intent (0.78) clears the default threshold', () => {
    const r = parseIntent('ETA', DEFAULT);
    expect(r.intent).toBe('eta_update');
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
  });
});

describe('extractMinutes', () => {
  it('parses number words', () => {
    expect(extractMinutes('ETA twenty minutes')).toBe(20);
    expect(extractMinutes('about fifteen minutes out')).toBe(15);
    expect(extractMinutes('five minutes')).toBe(5);
  });

  it('parses compound tens', () => {
    expect(extractMinutes('twenty five minutes')).toBe(25);
  });

  it('parses digits next to a minutes word', () => {
    expect(extractMinutes('15 min')).toBe(15);
    expect(extractMinutes('be there in 8 minutes')).toBe(8);
  });

  it('returns undefined when there is no time quantity', () => {
    expect(extractMinutes('on my way')).toBeUndefined();
  });
});

describe('extractReason', () => {
  it('captures text after "because"', () => {
    expect(extractReason('decline because too far')).toBe('too far');
  });
  it('captures text after "due to"', () => {
    expect(extractReason('decline due to no access')).toBe('no access');
  });
  it('returns undefined with no reason marker', () => {
    expect(extractReason('decline this job')).toBeUndefined();
  });
});

describe('parseIntent — entity attachment', () => {
  it('attaches minutes to eta_update', () => {
    expect(parseIntent('ETA twenty minutes', DEFAULT).entities.minutes).toBe(20);
  });
  it('attaches a reason to decline_job', () => {
    expect(parseIntent('decline because too far', DEFAULT).entities.reason).toBe('too far');
  });
});

describe('extractConfirmation', () => {
  it('recognizes yes variants', () => {
    for (const t of ['yes', 'yeah', 'yep', 'affirmative', 'go ahead', 'confirm']) {
      expect(extractConfirmation(t)).toBe(true);
    }
  });
  it('recognizes no variants', () => {
    for (const t of ['no', 'nope', 'cancel', 'negative', 'never mind']) {
      expect(extractConfirmation(t)).toBe(false);
    }
  });
  it('no beats yes when both present (fail-safe)', () => {
    expect(extractConfirmation('yes no')).toBe(false);
  });
  it('returns undefined for non-confirmations', () => {
    expect(extractConfirmation('on my way')).toBeUndefined();
  });
});

describe('parseIntent — bare confirmations have a null rawIntent', () => {
  it('"yes" → no intent matched, confirmation = true', () => {
    const r = parseIntent('yes', DEFAULT);
    expect(r.rawIntent).toBeNull();
    expect(r.intent).toBe('clarify');
    expect(r.entities.confirmation).toBe(true);
  });
  it('"no" → no intent matched, confirmation = false', () => {
    const r = parseIntent('no', DEFAULT);
    expect(r.rawIntent).toBeNull();
    expect(r.entities.confirmation).toBe(false);
  });
});
