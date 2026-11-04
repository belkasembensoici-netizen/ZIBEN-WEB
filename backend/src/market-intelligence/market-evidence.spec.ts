import { describe, expect, it } from 'vitest';
import {
  normalizeMarketEvidence,
  normalizeMarketEvidenceBatch,
  type MarketEvidenceInput,
  MarketEvidenceValidationError,
} from './market-evidence.js';

const ingestedAt = new Date('2026-11-03T17:00:00.000Z');

function evidence(
  overrides: Partial<MarketEvidenceInput> = {},
): MarketEvidenceInput {
  return {
    id: 'observation-1',
    kind: 'verified_observation',
    countryCode: 'dz',
    region: 'west',
    statement: 'Delivery confirmation rate was recorded by the merchant.',
    confidence: 0.9,
    observedAt: '2026-10-30T10:00:00Z',
    sources: [{ id: 'merchant-export-1', name: 'Merchant export' }],
    ...overrides,
  };
}

describe('market evidence normalization', () => {
  it('normalizes country, statement and timestamps while retaining provenance', () => {
    expect(normalizeMarketEvidence(evidence(), ingestedAt)).toMatchObject({
      id: 'observation-1',
      countryCode: 'DZ',
      region: 'west',
      statement: 'Delivery confirmation rate was recorded by the merchant.',
      ingestedAt: '2026-11-03T17:00:00.000Z',
      sources: [{ id: 'merchant-export-1', name: 'Merchant export' }],
      verificationStatus: 'unverified',
    });
  });

  it('requires source provenance for observations and statistical findings', () => {
    expect(() =>
      normalizeMarketEvidence(
        evidence({ kind: 'statistical_finding', sources: [] }),
        ingestedAt,
      ),
    ).toThrow(MarketEvidenceValidationError);
  });

  it('requires hypotheses and recommendations to reference evidence', () => {
    for (const kind of ['model_hypothesis', 'recommended_action'] as const) {
      expect(() =>
        normalizeMarketEvidence(
          evidence({ kind, sources: [], derivedFrom: [] }),
          ingestedAt,
        ),
      ).toThrow(/must reference their supporting evidence/);
    }
  });

  it('accepts a supported hypothesis that cites its evidence', () => {
    const records = normalizeMarketEvidenceBatch(
      [
        evidence(),
        evidence({
          id: 'hypothesis-1',
          kind: 'model_hypothesis',
          region: undefined,
          sources: [],
          derivedFrom: ['observation-1'],
          statement: 'Delivery confidence may vary by fulfillment region.',
        }),
      ],
      ingestedAt,
    );

    expect(records[1].kind).toBe('model_hypothesis');
    expect(records[1].derivedFrom).toEqual(['observation-1']);
  });

  it('rejects references outside the batch and duplicate evidence ids', () => {
    expect(() =>
      normalizeMarketEvidenceBatch([
        evidence({
          id: 'hypothesis-1',
          kind: 'model_hypothesis',
          sources: [],
          derivedFrom: ['missing'],
        }),
      ]),
    ).toThrow(/not present in the batch/);

    expect(() =>
      normalizeMarketEvidenceBatch([evidence(), evidence()]),
    ).toThrow(/must be unique/);
  });

  it('rejects malformed dates, confidence and cross-country Algerian regions', () => {
    expect(() =>
      normalizeMarketEvidence(evidence({ observedAt: 'yesterday' })),
    ).toThrow(/ISO 8601/);
    expect(() =>
      normalizeMarketEvidence(evidence({ observedAt: '2026-02-30T10:00:00Z' })),
    ).toThrow(/ISO 8601/);
    expect(() =>
      normalizeMarketEvidence(evidence({ confidence: 1.1 })),
    ).toThrow(/between 0 and 1/);
    expect(() =>
      normalizeMarketEvidence(evidence({ countryCode: 'FR' })),
    ).toThrow(/only be used with country code DZ/);
  });

  it('rejects insecure or credential-bearing source URLs', () => {
    expect(() =>
      normalizeMarketEvidence(
        evidence({
          sources: [
            {
              id: 'source',
              name: 'Source',
              url: 'http://example.test/data',
            },
          ],
        }),
      ),
    ).toThrow(/HTTPS/);
    expect(() =>
      normalizeMarketEvidence(
        evidence({
          sources: [
            {
              id: 'source',
              name: 'Source',
              url: 'https://user:password@example.test/data',
            },
          ],
        }),
      ),
    ).toThrow(/HTTPS/);
  });
});
