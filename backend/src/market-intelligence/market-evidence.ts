import { Injectable } from '@nestjs/common';

export const ALGERIAN_REGIONS = ['east', 'west', 'central', 'south'] as const;

export type AlgerianRegion = (typeof ALGERIAN_REGIONS)[number];
export type EvidenceKind =
  | 'verified_observation'
  | 'statistical_finding'
  | 'model_hypothesis'
  | 'recommended_action';

export interface EvidenceSource {
  id: string;
  name: string;
  url?: string;
}

export interface MarketEvidenceInput {
  id: string;
  kind: EvidenceKind;
  countryCode: string;
  region?: AlgerianRegion;
  statement: string;
  confidence: number;
  observedAt: string;
  sources: EvidenceSource[];
  derivedFrom?: string[];
}

export interface MarketEvidence extends MarketEvidenceInput {
  countryCode: string;
  ingestedAt: string;
  sources: EvidenceSource[];
  derivedFrom: string[];
  verificationStatus: 'unverified';
}

export class MarketEvidenceValidationError extends Error {
  constructor(
    message: string,
    readonly evidenceId?: string,
  ) {
    super(message);
    this.name = 'MarketEvidenceValidationError';
  }
}

const EVIDENCE_KINDS = new Set<EvidenceKind>([
  'verified_observation',
  'statistical_finding',
  'model_hypothesis',
  'recommended_action',
]);

function isIsoTimestamp(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    ,
    ,
    offsetHour,
    offsetMinute,
  ] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const yearNumber = Number(year);
  const offsetHourNumber = Number(offsetHour ?? '0');
  const offsetMinuteNumber = Number(offsetMinute ?? '0');
  const leapYear =
    yearNumber % 4 === 0 && (yearNumber % 100 !== 0 || yearNumber % 400 === 0);
  const daysInMonth =
    [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
      monthNumber - 1
    ] ?? 0;

  return (
    dayNumber >= 1 &&
    dayNumber <= daysInMonth &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    offsetHourNumber <= 23 &&
    offsetMinuteNumber <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function validateSource(source: EvidenceSource, evidenceId: string): void {
  if (!source.id.trim() || !source.name.trim()) {
    throw new MarketEvidenceValidationError(
      'Every source requires a non-empty id and name',
      evidenceId,
    );
  }

  if (source.url !== undefined) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      throw new MarketEvidenceValidationError(
        'Source URLs must be valid HTTPS URLs',
        evidenceId,
      );
    }

    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new MarketEvidenceValidationError(
        'Source URLs must be valid HTTPS URLs',
        evidenceId,
      );
    }
  }
}

export function normalizeMarketEvidence(
  input: MarketEvidenceInput,
  ingestedAt: Date = new Date(),
): MarketEvidence {
  if (!input.id.trim()) {
    throw new MarketEvidenceValidationError('Evidence id is required');
  }
  if (!EVIDENCE_KINDS.has(input.kind)) {
    throw new MarketEvidenceValidationError(
      'Unsupported evidence classification',
      input.id,
    );
  }
  if (!/^[A-Za-z]{2}$/.test(input.countryCode)) {
    throw new MarketEvidenceValidationError(
      'Country code must be a two-letter ISO 3166-1 alpha-2 code',
      input.id,
    );
  }
  if (input.region !== undefined && !ALGERIAN_REGIONS.includes(input.region)) {
    throw new MarketEvidenceValidationError(
      'Unsupported Algerian region',
      input.id,
    );
  }
  if (input.region !== undefined && input.countryCode.toUpperCase() !== 'DZ') {
    throw new MarketEvidenceValidationError(
      'Algerian region labels can only be used with country code DZ',
      input.id,
    );
  }
  if (!input.statement.trim()) {
    throw new MarketEvidenceValidationError(
      'Evidence statement is required',
      input.id,
    );
  }
  if (
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    throw new MarketEvidenceValidationError(
      'Confidence must be a number between 0 and 1',
      input.id,
    );
  }
  if (!isIsoTimestamp(input.observedAt)) {
    throw new MarketEvidenceValidationError(
      'observedAt must be an ISO 8601 timestamp with timezone',
      input.id,
    );
  }
  if (!Number.isFinite(ingestedAt.getTime())) {
    throw new MarketEvidenceValidationError('Ingestion timestamp is invalid');
  }

  const sources = input.sources.map((source) => {
    validateSource(source, input.id);
    return {
      ...source,
      id: source.id.trim(),
      name: source.name.trim(),
    };
  });
  const derivedFrom = [...new Set(input.derivedFrom ?? [])];

  if (
    (input.kind === 'verified_observation' ||
      input.kind === 'statistical_finding') &&
    sources.length === 0
  ) {
    throw new MarketEvidenceValidationError(
      'Observations and statistical findings require source provenance',
      input.id,
    );
  }
  if (
    (input.kind === 'model_hypothesis' ||
      input.kind === 'recommended_action') &&
    derivedFrom.length === 0
  ) {
    throw new MarketEvidenceValidationError(
      'Hypotheses and recommendations must reference their supporting evidence',
      input.id,
    );
  }
  if (derivedFrom.includes(input.id)) {
    throw new MarketEvidenceValidationError(
      'Evidence cannot derive from itself',
      input.id,
    );
  }

  return {
    ...input,
    countryCode: input.countryCode.toUpperCase(),
    statement: input.statement.trim(),
    sources,
    derivedFrom,
    ingestedAt: ingestedAt.toISOString(),
    verificationStatus: 'unverified',
  };
}

export function normalizeMarketEvidenceBatch(
  inputs: readonly MarketEvidenceInput[],
  ingestedAt: Date = new Date(),
): MarketEvidence[] {
  const seen = new Set<string>();
  const normalized = inputs.map((input) => {
    const record = normalizeMarketEvidence(input, ingestedAt);
    if (seen.has(record.id)) {
      throw new MarketEvidenceValidationError(
        'Evidence ids must be unique within a batch',
        record.id,
      );
    }
    seen.add(record.id);
    return record;
  });

  const ids = new Set(normalized.map((record) => record.id));
  for (const record of normalized) {
    for (const reference of record.derivedFrom) {
      if (!ids.has(reference)) {
        throw new MarketEvidenceValidationError(
          `Referenced evidence "${reference}" is not present in the batch`,
          record.id,
        );
      }
    }
  }

  return normalized;
}

@Injectable()
export class MarketEvidenceService {
  normalize(input: MarketEvidenceInput, ingestedAt?: Date): MarketEvidence {
    return normalizeMarketEvidence(input, ingestedAt);
  }

  normalizeBatch(
    inputs: readonly MarketEvidenceInput[],
    ingestedAt?: Date,
  ): MarketEvidence[] {
    return normalizeMarketEvidenceBatch(inputs, ingestedAt);
  }
}
