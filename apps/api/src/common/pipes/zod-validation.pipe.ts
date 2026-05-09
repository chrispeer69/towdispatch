/**
 * Zod-driven validation pipe.
 *
 * Two usage modes:
 *   1) Per-handler: `@Body(new ZodValidationPipe(createUserSchema)) body: CreateUserPayload`
 *      The constructor schema validates the incoming value.
 *   2) Global no-op: registered globally in main.ts, but with no schema it
 *      passes the value through. Per-handler schemas are still required.
 */
import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodError, ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    if (!this.schema) return value;
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw result.error as ZodError;
    }
    return result.data;
  }
}
