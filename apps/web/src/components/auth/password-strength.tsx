'use client';

/**
 * Live password rule meter mirroring the server-side passwordSchema:
 *   - 12+ chars
 *   - lowercase letter
 *   - uppercase letter
 *   - digit
 *
 * Visual: four pips that fill orange as rules pass, plus a checklist below.
 */
interface RuleResult {
  label: string;
  passed: boolean;
}

function evaluate(value: string): RuleResult[] {
  return [
    { label: 'At least 12 characters', passed: value.length >= 12 },
    { label: 'Contains a lowercase letter', passed: /[a-z]/.test(value) },
    { label: 'Contains an uppercase letter', passed: /[A-Z]/.test(value) },
    { label: 'Contains a digit', passed: /[0-9]/.test(value) },
  ];
}

export function PasswordStrength({ value }: { value: string }): JSX.Element {
  const rules = evaluate(value);
  const passed = rules.filter((r) => r.passed).length;

  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={
              i < passed
                ? 'h-1.5 flex-1 rounded-full bg-brand-primary'
                : 'h-1.5 flex-1 rounded-full bg-divider'
            }
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        {rules.map((r) => (
          <li
            key={r.label}
            className={
              r.passed
                ? 'flex items-center gap-2 text-ok'
                : 'flex items-center gap-2 text-text-secondary-on-dark-on-dark/60'
            }
          >
            <span aria-hidden>{r.passed ? '✓' : '·'}</span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
