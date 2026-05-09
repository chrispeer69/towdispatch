/**
 * argon2id password hashing. Parameters are the OWASP 2024 minimum:
 *   memoryCost: 19 MiB, timeCost: 2, parallelism: 1.
 * Produces standard PHC strings; argon2.verify reads the parameters from the
 * hash, so we can lift these defaults later without breaking old hashes.
 */
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
