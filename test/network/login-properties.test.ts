import { describe, expect, it } from 'bun:test';
import { string, varInt } from '@/encoding/data-buffer';

describe('Login Success Property Encoding', () => {
  it('encodes single property without signature', () => {
    const properties = [
      {
        name: 'textures',
        value:
          'eyJ0aW1lc3RhbXAiOjE2MzA0NzI0MDAwMDAsInByb2ZpbGVJZCI6IjEyMzQ1Njc4OTAiLCJwcm9maWxlTmFtZSI6IlRlc3RQbGF5ZXIiLCJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvMTIzNDU2Nzg5MCJ9fX0=',
      },
    ];

    const propertiesCount = varInt(properties.length);
    const propertiesBuffers = properties.map((prop: any) => {
      const nameBuffer = string(prop.name);
      const valueBuffer = string(prop.value);
      const hasSignature = prop.signature ? Buffer.from([0x01]) : Buffer.from([0x00]);
      const signatureBuffer = prop.signature ? string(prop.signature) : Buffer.alloc(0);
      return Buffer.concat([nameBuffer, valueBuffer, hasSignature, signatureBuffer]);
    });
    const result = Buffer.concat([propertiesCount, ...propertiesBuffers]);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe(1); // VarInt 1 (property count)
    expect(result[1]).toBe(8); // VarInt 8 (length of "textures")
  });

  it('encodes property with signature', () => {
    const properties = [
      {
        name: 'textures',
        value: 'dGVzdFZhbHVl',
        signature: 'dGVzdFNpZ25hdHVyZQ==',
      },
    ];

    const propertiesCount = varInt(properties.length);
    const propertiesBuffers = properties.map((prop: any) => {
      const nameBuffer = string(prop.name);
      const valueBuffer = string(prop.value);
      const hasSignature = prop.signature ? Buffer.from([0x01]) : Buffer.from([0x00]);
      const signatureBuffer = prop.signature ? string(prop.signature) : Buffer.alloc(0);
      return Buffer.concat([nameBuffer, valueBuffer, hasSignature, signatureBuffer]);
    });
    const result = Buffer.concat([propertiesCount, ...propertiesBuffers]);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe(1);

    // Verify signature is included (signature string length + actual signature bytes)
    const signatureStringBuffer = string('dGVzdFNpZ25hdHVyZQ==');
    expect(result.includes(signatureStringBuffer.slice(1))).toBe(true);
  });

  it('encodes multiple properties', () => {
    const properties = [
      { name: 'textures', value: 'value1' },
      { name: 'cape', value: 'value2', signature: 'sig2' },
    ];

    const propertiesCount = varInt(properties.length);
    const propertiesBuffers = properties.map((prop: any) => {
      const nameBuffer = string(prop.name);
      const valueBuffer = string(prop.value);
      const hasSignature = prop.signature ? Buffer.from([0x01]) : Buffer.from([0x00]);
      const signatureBuffer = prop.signature ? string(prop.signature) : Buffer.alloc(0);
      return Buffer.concat([nameBuffer, valueBuffer, hasSignature, signatureBuffer]);
    });
    const result = Buffer.concat([propertiesCount, ...propertiesBuffers]);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe(2); // VarInt 2 (property count)
  });

  it('encodes empty properties array', () => {
    const properties: any[] = [];
    const propertiesCount = varInt(properties.length);
    const result = propertiesCount;

    expect(result.length).toBe(1);
    expect(result[0]).toBe(0); // VarInt 0 (no properties)
  });
});
