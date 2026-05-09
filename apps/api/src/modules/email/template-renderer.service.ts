/**
 * Handlebars compiler with file-system caching. Templates live in
 * src/modules/email/templates/<name>.{html,txt}. Both are required — every
 * outbound email ships HTML AND a plain-text alternative.
 *
 * Resolves templates relative to this file at runtime so it works under
 * tsx (dev) and compiled `dist/` (prod) the same way.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable } from '@nestjs/common';
import Handlebars, { type TemplateDelegate } from 'handlebars';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, 'templates');

export interface RenderedEmail {
  html: string;
  text: string;
}

interface CompiledPair {
  html: TemplateDelegate;
  text: TemplateDelegate;
}

@Injectable()
export class TemplateRenderer {
  private readonly cache = new Map<string, CompiledPair>();

  render(name: string, vars: Record<string, unknown>): RenderedEmail {
    const compiled = this.load(name);
    return {
      html: compiled.html(vars),
      text: compiled.text(vars),
    };
  }

  private load(name: string): CompiledPair {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const htmlSrc = readFileSync(join(TEMPLATES_DIR, `${name}.html`), 'utf8');
    const textSrc = readFileSync(join(TEMPLATES_DIR, `${name}.txt`), 'utf8');
    const compiled: CompiledPair = {
      html: Handlebars.compile(htmlSrc, { noEscape: false }),
      text: Handlebars.compile(textSrc, { noEscape: true }),
    };
    this.cache.set(name, compiled);
    return compiled;
  }
}
