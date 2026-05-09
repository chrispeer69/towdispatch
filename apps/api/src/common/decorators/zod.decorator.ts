/**
 * Convenience wrappers so handlers can write
 *   create(@ZodBody(schema) body: T)
 * instead of
 *   create(@Body(new ZodValidationPipe(schema)) body: T)
 */
import { Body, Param, Query } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

export const ZodBody = <T>(schema: ZodSchema<T>): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));
export const ZodQuery = <T>(schema: ZodSchema<T>): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));
export const ZodParam = <T>(schema: ZodSchema<T>): ParameterDecorator =>
  Param(new ZodValidationPipe(schema));
