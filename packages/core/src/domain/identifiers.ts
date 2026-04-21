import { z } from 'zod';

/**
 * Branded types prevent accidentally passing a SessionId where a RoundId is
 * expected. The runtime representation is still a string, but the compiler
 * treats them as distinct. The `__brand` property is phantom — never assigned
 * at runtime; it only exists in the type system.
 */
type Brand<T, B extends string> = T & { readonly __brand: B };

export type OrganizationId = Brand<string, 'OrganizationId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type RoundId = Brand<string, 'RoundId'>;
export type JobId = Brand<string, 'JobId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;

export const OrganizationIdSchema = z.string().uuid().transform((v) => v as OrganizationId);
export const SessionIdSchema = z.string().uuid().transform((v) => v as SessionId);
export const RoundIdSchema = z.string().uuid().transform((v) => v as RoundId);
export const JobIdSchema = z.string().min(1).transform((v) => v as JobId);
export const ArtifactIdSchema = z.string().uuid().transform((v) => v as ArtifactId);
