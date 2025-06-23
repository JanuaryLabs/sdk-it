import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import ts from 'typescript';

import { isInterfaceType } from './program.ts';

describe('isInterfaceType Helper Function - Error-First Testing', () => {
  // Phase 1: Error-First Testing - Attack Before You Defend
  describe('Error Cases and Invalid Inputs', () => {
    it('throws TypeError when type.symbol is undefined', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: undefined,
      } as unknown as ts.Type;

      assert.throws(
        () => {
          isInterfaceType(mockType);
        },
        TypeError,
        'Should throw TypeError when accessing flags on undefined symbol',
      );
    });

    it('throws TypeError when type.symbol is null', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: null,
      } as unknown as ts.Type;

      assert.throws(
        () => {
          isInterfaceType(mockType);
        },
        TypeError,
        'Should throw TypeError when accessing flags on null symbol',
      );
    });

    it('handles malformed type object missing isClassOrInterface method', () => {
      const mockType = {
        // Missing isClassOrInterface method
        symbol: {
          flags: ts.SymbolFlags.Interface,
        },
      } as unknown as ts.Type;

      assert.throws(
        () => {
          isInterfaceType(mockType);
        },
        TypeError,
        'Should throw when isClassOrInterface is not a function',
      );
    });

    it('handles type with symbol missing flags property', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {}, // Missing flags property
      } as unknown as ts.Type;

      // Should default to falsy flags (undefined & Interface === 0)
      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        false,
        'Should return false when flags property is missing',
      );
    });

    it('handles type with symbol having non-numeric flags', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: 'invalid' as unknown,
        },
      } as unknown as ts.Type;

      // Bitwise AND with string should result in 0 (falsy)
      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        false,
        'Should return false when flags is not a number',
      );
    });
  });

  // Phase 2: System Invariants Testing
  describe('System Invariants', () => {
    it('INVARIANT: Interface flag must be present for true result', () => {
      // Test that ONLY when Interface flag is present, result is true
      const interfaceType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: ts.SymbolFlags.Interface,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(interfaceType);
      assert.strictEqual(
        result,
        true,
        'INVARIANT VIOLATED: Interface flag present but function returned false',
      );
    });

    it('INVARIANT: Non-interface flags must result in false', () => {
      // Select a set of flags that are clearly not interface flags
      const nonInterfaceFlags = [
        ts.SymbolFlags.Class,
        ts.SymbolFlags.Function,
        ts.SymbolFlags.Variable,
        ts.SymbolFlags.Property,
        ts.SymbolFlags.Enum,
        ts.SymbolFlags.Module,
        ts.SymbolFlags.Namespace,
        // Removed TypeAliasExcludes which seems to have the Interface bit
      ];

      nonInterfaceFlags.forEach((flag) => {
        const mockType = {
          isClassOrInterface: () => true,
          symbol: {
            flags: flag,
          },
        } as unknown as ts.Type;

        const result = isInterfaceType(mockType);
        assert.strictEqual(
          result,
          false,
          `INVARIANT VIOLATED: Non-interface flag ${ts.SymbolFlags[flag]} (${flag}) returned true`,
        );
      });
    });

    it('INVARIANT: isClassOrInterface() false must always result in false', () => {
      // Even with Interface flag, if isClassOrInterface is false, result must be false
      const mockType = {
        isClassOrInterface: () => false,
        symbol: {
          flags: ts.SymbolFlags.Interface,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        false,
        'INVARIANT VIOLATED: isClassOrInterface() false should always result in false',
      );
    });
  });

  // Phase 3: State Transitions and Complex Scenarios
  describe('Complex Flag Combinations', () => {
    it('correctly handles combined flags including Interface', () => {
      const combinedFlags = [
        ts.SymbolFlags.Interface | ts.SymbolFlags.Type,
        ts.SymbolFlags.Interface | ts.SymbolFlags.Alias,
        ts.SymbolFlags.Interface | ts.SymbolFlags.Class, // Edge case
        ts.SymbolFlags.Interface | ts.SymbolFlags.Function,
      ];

      combinedFlags.forEach((flags, index) => {
        const mockType = {
          isClassOrInterface: () => true,
          symbol: { flags },
        } as unknown as ts.Type;

        const result = isInterfaceType(mockType);
        assert.strictEqual(
          result,
          true,
          `Combined flags case ${index + 1}: Interface flag present, should return true`,
        );
      });
    });

    it('correctly handles combined flags excluding Interface', () => {
      const combinedFlagsNoInterface = [
        ts.SymbolFlags.Function | ts.SymbolFlags.Variable,
        ts.SymbolFlags.Enum | ts.SymbolFlags.Module,
        // Removed Class | Type which seems to include the Interface bit
      ];

      combinedFlagsNoInterface.forEach((flags, index) => {
        // Explicitly check that the flags don't include the Interface bit
        if ((flags & ts.SymbolFlags.Interface) !== 0) {
          // Skip this test case if it includes the Interface bit
          return;
        }

        const mockType = {
          isClassOrInterface: () => true,
          symbol: { flags },
        } as unknown as ts.Type;

        const result = isInterfaceType(mockType);
        assert.strictEqual(
          result,
          false,
          `Combined flags case ${index + 1}: No Interface flag, should return false`,
        );
      });
    });

    it('handles edge case with maximum flag value', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: Number.MAX_SAFE_INTEGER,
        },
      } as unknown as ts.Type;

      // If Interface flag bit is set in MAX_SAFE_INTEGER, result should be true
      const hasInterfaceFlag =
        (Number.MAX_SAFE_INTEGER & ts.SymbolFlags.Interface) !== 0;
      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        hasInterfaceFlag,
        'Edge case with maximum flag value should follow bitwise logic',
      );
    });

    it('handles zero flags correctly', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: 0,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(mockType);
      assert.strictEqual(result, false, 'Zero flags should result in false');
    });
  });

  // Phase 4: Boundary Testing
  describe('Boundary Conditions', () => {
    it('tests exact Interface flag value', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: ts.SymbolFlags.Interface,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        true,
        'Exact Interface flag should return true',
      );
    });

    it('tests Interface flag minus one', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: ts.SymbolFlags.Interface - 1,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        false,
        'Interface flag minus one should not match',
      );
    });

    it('tests Interface flag plus one', () => {
      const flagValue = ts.SymbolFlags.Interface + 1;
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: flagValue,
        },
      } as unknown as ts.Type;

      // Depends on whether the +1 creates a different valid flag
      const hasInterfaceFlag = (flagValue & ts.SymbolFlags.Interface) !== 0;
      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        hasInterfaceFlag,
        'Interface flag plus one should follow bitwise logic',
      );
    });
  });

  // Phase 5: Happy Path Tests (Last)
  describe('Happy Path Scenarios', () => {
    it('correctly identifies interface types', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: ts.SymbolFlags.Interface,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        true,
        'Should correctly identify interface types',
      );
    });

    it('correctly rejects class types', () => {
      const mockType = {
        isClassOrInterface: () => true,
        symbol: {
          flags: ts.SymbolFlags.Class,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(mockType);
      assert.strictEqual(result, false, 'Should correctly reject class types');
    });

    it('correctly rejects primitive types', () => {
      const mockType = {
        isClassOrInterface: () => false,
        symbol: {
          flags: ts.SymbolFlags.None,
        },
      } as unknown as ts.Type;

      const result = isInterfaceType(mockType);
      assert.strictEqual(
        result,
        false,
        'Should correctly reject primitive types',
      );
    });
  });
});
