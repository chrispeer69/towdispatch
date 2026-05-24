'use client';

import { DriverApiError, driverApi } from '@/lib/driver/api-client';
/**
 * /driver/voice — Web Speech API demo of the voice-driver flow (Session 45).
 *
 * Runs the full hands-free loop in a browser so the flow is testable
 * without a CarPlay / Android Auto head unit:
 *   webkitSpeechRecognition → POST /voice-driver/command → speechSynthesis.
 *
 * This is the web fallback surface described in
 * docs/voice-driver/native-integration.md. It deliberately reuses the
 * driver session (driverApi attaches the driver JWT) so QA exercises the
 * real parser, the real transitions, and the real confirmation gate.
 *
 * Accessibility: every control is a real <button> with a visible label and
 * an aria-live transcript/response region, so the page is usable by
 * keyboard and screen reader even though its purpose is voice.
 */
import type { VoiceCommandResponse, VoicePlatform } from '@ustowdispatch/shared';
import { useCallback, useRef, useState } from 'react';

// Minimal typings for the still-unprefixed-in-TS Web Speech API.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getRecognition(lang: string): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike })
      .SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  return rec;
}

function speak(text: string, lang: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export default function DriverVoicePage(): JSX.Element {
  const [locale, setLocale] = useState<'en' | 'es'>('en');
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState<VoiceCommandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  const send = useCallback(
    async (text: string) => {
      setError(null);
      try {
        const res = await driverApi<VoiceCommandResponse>('POST', '/voice-driver/command', {
          transcript: text,
          platform: 'web' satisfies VoicePlatform,
          locale,
        });
        setResponse(res);
        speak(res.responseText, locale === 'es' ? 'es-US' : 'en-US');
      } catch (err) {
        if (err instanceof DriverApiError) {
          setError(`${err.code}: ${err.message}`);
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Unknown error');
        }
      }
    },
    [locale],
  );

  const startListening = useCallback(() => {
    const rec = getRecognition(locale === 'es' ? 'es-US' : 'en-US');
    if (!rec) {
      setError('Speech recognition is not supported in this browser. Use the text box below.');
      return;
    }
    recRef.current = rec;
    setListening(true);
    setTranscript('');
    rec.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript ?? '';
      setTranscript(said);
      if (said) void send(said);
    };
    rec.onerror = (event) => {
      setError(`Speech error: ${event.error}`);
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
  }, [locale, send]);

  const stopListening = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const [manual, setManual] = useState('');

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Voice commands (demo)</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Web fallback for CarPlay / Android Auto. Hold a quiet moment, tap <strong>Listen</strong>,
        and say e.g. &ldquo;on scene&rdquo;, &ldquo;loaded&rdquo;, &ldquo;clear the job&rdquo;, or
        &ldquo;repeat address&rdquo;.
      </p>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Response language</legend>
        <div className="mt-1 flex gap-3">
          {(['en', 'es'] as const).map((l) => (
            <label key={l} className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="locale"
                checked={locale === l}
                onChange={() => setLocale(l)}
              />
              {l === 'en' ? 'English' : 'Español'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={listening ? stopListening : startListening}
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground"
          aria-pressed={listening}
        >
          {listening ? 'Stop' : 'Listen'}
        </button>
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) void send(manual.trim());
        }}
      >
        <input
          type="text"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="…or type a command (no mic needed)"
          className="flex-1 rounded-md border px-3 py-2"
          aria-label="Type a voice command"
        />
        <button type="submit" className="rounded-md border px-4 py-2 font-medium">
          Send
        </button>
      </form>

      <div aria-live="polite" className="mt-6 space-y-3">
        {transcript && (
          <p className="text-sm">
            <span className="font-medium">Heard:</span> {transcript}
          </p>
        )}
        {response && (
          <div className="rounded-md border p-4">
            <p className="text-lg">{response.responseText}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>Intent</dt>
              <dd>{response.recognizedIntent}</dd>
              <dt>Confidence</dt>
              <dd>{(response.confidence * 100).toFixed(0)}%</dd>
              <dt>Action executed</dt>
              <dd>{response.actionExecuted ? 'yes' : 'no'}</dd>
              <dt>Job status</dt>
              <dd>{response.jobStatus ?? '—'}</dd>
            </dl>
            {response.followUpQuestion && (
              <p className="mt-2 text-sm font-medium">↪ {response.followUpQuestion}</p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}
