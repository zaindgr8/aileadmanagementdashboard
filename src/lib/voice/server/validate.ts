import { z } from 'zod';
import { STAGE_KEYS } from '@/lib/voice/leads';
import { HttpError } from './http';

const text = (max: number) => z.string().trim().max(max);

export const LeadFields = z.object({
  name: text(120),
  email: z.union([z.literal(''), z.string().trim().max(200).pipe(z.email())]),
  company: text(160),
  stage: z.enum(STAGE_KEYS),
  value: z.number().finite().min(0).max(1e12).nullable().transform((v) => v ?? undefined),
  tags: z.array(text(40).min(1)).max(20).transform((t) => [...new Set(t)]),
  follow_up_at: z.number().int().positive().nullable(),
  source: text(120),
  archived: z.boolean(),
}).partial();

/** Parses `data` with `schema`, turning the first problem into a readable 400. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new HttpError(400, `${issue.path.join('.') || 'Input'}: ${issue.message}`);
}
