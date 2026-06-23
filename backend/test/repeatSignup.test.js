import { jest } from '@jest/globals';
import {
  emailNormKey,
  phoneKeyOf,
  repeatSignupDetail,
  repeatSignupCounts,
} from '../src/services/repeatSignup.js';

const mockSeq = (rows = []) => ({ query: jest.fn().mockResolvedValue(rows) });

describe('emailNormKey', () => {
  it('trims + lowercases', () => {
    expect(emailNormKey('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
  it('null for missing / empty / non-string', () => {
    expect(emailNormKey(null)).toBeNull();
    expect(emailNormKey('')).toBeNull();
    expect(emailNormKey('   ')).toBeNull();
    expect(emailNormKey(123)).toBeNull();
  });
  it('null for synthetic Retell email (case-insensitive)', () => {
    expect(emailNormKey('retell-abc@calls.mktr.sg')).toBeNull();
    expect(emailNormKey('X@Calls.Mktr.SG')).toBeNull();
  });
});

describe('phoneKeyOf', () => {
  it('trims; null for blank/null', () => {
    expect(phoneKeyOf(' +6591234567 ')).toBe('+6591234567');
    expect(phoneKeyOf('')).toBeNull();
    expect(phoneKeyOf(null)).toBeNull();
  });
});

describe('repeatSignupDetail', () => {
  it('no query + empty result when no phone and no usable email', async () => {
    const seq = mockSeq();
    const res = await repeatSignupDetail(seq, { phone: null, email: 'x@calls.mktr.sg' });
    expect(seq.query).not.toHaveBeenCalled();
    expect(res).toEqual({ campaignCount: 0, campaigns: [] });
  });

  it('queries with [phone, emailNorm] and returns campaigns', async () => {
    const rows = [
      { id: 'c1', name: 'Camp 1', signedUpAt: '2026-06-01' },
      { id: 'c2', name: 'Camp 2', signedUpAt: '2026-06-10' },
    ];
    const seq = mockSeq(rows);
    const res = await repeatSignupDetail(seq, { phone: '+6591234567', email: 'A@B.com' });
    expect(seq.query).toHaveBeenCalledTimes(1);
    expect(seq.query.mock.calls[0][1].bind).toEqual(['+6591234567', 'a@b.com']);
    expect(res).toEqual({ campaignCount: 2, campaigns: rows });
  });

  it('email-only repeat (no phone) binds [null, emailNorm]', async () => {
    const seq = mockSeq([{ id: 'c1', name: 'Camp', signedUpAt: '2026-06-01' }]);
    await repeatSignupDetail(seq, { phone: null, email: 'a@b.com' });
    expect(seq.query.mock.calls[0][1].bind).toEqual([null, 'a@b.com']);
  });

  it('synthetic email + real phone binds [phone, null]', async () => {
    const seq = mockSeq([]);
    await repeatSignupDetail(seq, { phone: '+6599998888', email: 'r@calls.mktr.sg' });
    expect(seq.query.mock.calls[0][1].bind).toEqual(['+6599998888', null]);
  });
});

describe('repeatSignupCounts', () => {
  it('empty rows → empty Map, no query', async () => {
    const seq = mockSeq();
    const map = await repeatSignupCounts(seq, []);
    expect(seq.query).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it('builds id/phone/email arrays (synthetic+blank → null) and maps counts', async () => {
    const seq = mockSeq([{ id: 'p1', count: 2 }, { id: 'p3', count: 3 }]);
    const map = await repeatSignupCounts(seq, [
      { id: 'p1', phone: ' +6591110000 ', email: 'A@B.com' },
      { id: 'p2', phone: '', email: 'r@calls.mktr.sg' },
      { id: 'p3', phone: '+6592220000', email: null },
    ]);
    const opts = seq.query.mock.calls[0][1];
    expect(opts.bind[0]).toEqual(['p1', 'p2', 'p3']); // ids
    expect(opts.bind[1]).toEqual(['+6591110000', null, '+6592220000']); // phones: trimmed, blank→null
    expect(opts.bind[2]).toEqual(['a@b.com', null, null]); // emails: normalized, synthetic/null→null
    expect(map.get('p1')).toBe(2);
    expect(map.get('p3')).toBe(3);
    expect(map.has('p2')).toBe(false);
  });
});
