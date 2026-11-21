import * as z from 'zod';

/** The zod schema for a JSON Schema string `format`, as `code` (zod source text) and as `schema`. */
export interface ZodStringFormatSchema {
  code: string;
  schema: z.ZodString | z.ZodStringFormat;
  /** The pattern still to check beside `schema`: one that `schema` does not write itself. */
  pattern: string | undefined;
}

// z.iso.time() rejects RFC 3339 zone suffixes ('10:30:00Z', '10:30:00+02:00'),
// which JSON Schema's format: time allows. Accept both local and
// zone-qualified times.
const isoTime =
  /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)?$/;

type Candidate = [code: string, schema: () => z.ZodString | z.ZodStringFormat];

/**
 * The zod schemas each format can be, the default first. zod writes the same
 * format for several schemas (z.uuid() and z.guid() both write uuid), each
 * with its own pattern.
 */
const formats: Record<string, [Candidate, ...Candidate[]]> = {
  // RFC 3339 date-time allows numeric zone offsets, which z.iso.datetime()
  // rejects by default.
  'date-time': [
    [
      'z.iso.datetime({ offset: true })',
      () => z.iso.datetime({ offset: true }),
    ],
    ['z.iso.datetime()', () => z.iso.datetime()],
  ],
  date: [['z.iso.date()', () => z.iso.date()]],
  time: [
    [`z.string().regex(/${isoTime.source}/)`, () => z.string().regex(isoTime)],
  ],
  email: [['z.email()', () => z.email()]],
  // JSON Schema's format: uuid is RFC 9562, which z.uuid() checks.
  uuid: [
    ['z.uuid()', () => z.uuid()],
    ['z.guid()', () => z.guid()],
  ],
  url: [['z.url()', () => z.url()]],
  ipv4: [['z.ipv4()', () => z.ipv4()]],
  ipv6: [['z.ipv6()', () => z.ipv6()]],
  cidrv4: [['z.cidrv4()', () => z.cidrv4()]],
  cidrv6: [['z.cidrv6()', () => z.cidrv6()]],
};
formats['datetime'] = formats['date-time'];
formats['uri'] = formats['url'];

/**
 * The zod schema for a string `format` with an optional `pattern`, or
 * `undefined` for a format zod has no schema for. An analyzed zod schema
 * writes its own pattern beside its format, so the schema that writes
 * `pattern` is chosen and the pattern is not restated; another pattern is
 * kept beside the format's default schema.
 */
export function zodStringFormat(
  format: string,
  pattern: string | undefined,
): ZodStringFormatSchema | undefined {
  const candidates = formats[format];
  if (!candidates) {
    return undefined;
  }
  const built = candidates.map(([code, schema]) => ({
    code,
    schema: schema(),
  }));
  const own = built.find(
    ({ schema }) => z.toJSONSchema(schema).pattern === pattern,
  );
  return own ? { ...own, pattern: undefined } : { ...built[0], pattern };
}
