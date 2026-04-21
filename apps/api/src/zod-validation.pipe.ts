import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { type ZodSchema } from 'zod';

/**
 * NestJS pipe that runs a Zod schema and converts failures into 400s with a
 * readable diagnostic. This is our boundary validator — every request body is
 * parsed through one of these.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  public constructor(private readonly schema: ZodSchema<T>) {}

  public transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
