import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SchemaObject, SchemasObject } from 'openapi3-ts/oas31';

import { getItemsName } from './pagination-result.ts';

function createSchema(properties: SchemasObject) {
  return properties;
}

function arraySchema(items?: SchemaObject): SchemaObject {
  return {
    type: 'array',
    items: items ?? { type: 'object' },
  };
}

function stringSchema(): SchemaObject {
  return {
    type: 'string',
  };
}

function objectSchema(properties?: SchemasObject): SchemaObject {
  return {
    type: 'object',
    properties: properties ?? {},
  };
}

describe('getItemsName()', () => {
  describe('No Array Properties', () => {
    test('should return null if no properties are arrays', () => {
      const schema = createSchema({
        name: stringSchema(),
        age: { type: 'integer' },
        details: objectSchema(),
      });
      assert.strictEqual(getItemsName(schema), null);
    });
  });

  describe('Single Array Property', () => {
    test('should return the name of the single array property', () => {
      const schema = createSchema({
        users: arraySchema(),
        count: { type: 'integer' },
      });
      assert.strictEqual(getItemsName(schema), 'users');
    });

    test('should return the name even if other non-array properties exist', () => {
      const schema = createSchema({
        id: stringSchema(),
        itemsList: arraySchema(),
        metadata: objectSchema(),
      });
      assert.strictEqual(getItemsName(schema), 'itemsList');
    });
  });

  describe('Multiple Array Properties - Keyword Heuristics', () => {
    test('should prefer primary top-tier keywords (data)', () => {
      const schema = createSchema({
        users: arraySchema(),
        data: arraySchema(),
        records: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'data');
    });

    test('should prefer primary top-tier keywords (items)', () => {
      const schema = createSchema({
        elements: arraySchema(),
        items: arraySchema(),
        values: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'items');
    });

    test('should prefer primary top-tier keywords (results)', () => {
      const schema = createSchema({
        list: arraySchema(),
        results: arraySchema(), // Primary top-tier
        entries: arraySchema(), // Secondary
      });
      assert.strictEqual(getItemsName(schema), 'results');
    });

    test('should prefer primary top-tier keywords (value) - case insensitive', () => {
      const schema = createSchema({
        Value: arraySchema(),
        otherArray: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'Value');
    });

    test('should prefer primary other keywords (records) if no top-tier', () => {
      const schema = createSchema({
        elements: arraySchema(),
        records: arraySchema(), // Primary other
        anotherList: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'records');
    });

    test('should prefer primary other keywords (content) - case insensitive', () => {
      const schema = createSchema({
        Content: arraySchema(),
        genericList: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'Content');
    });

    test('should prefer secondary keywords (entries) if no primary', () => {
      const schema = createSchema({
        somePlural: arraySchema(), // Will be plural, but 'entries' is keyword
        entries: arraySchema(), // Secondary
        anotherPlural: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'entries');
    });

    test('should prefer "data" over "items" if both are top-tier (based on order in PRIMARY_TOP_TIER_KEYWORDS)', () => {
      // This test assumes internal stability of PRIMARY_TOP_TIER_KEYWORDS or that the first match wins.
      // The current implementation iterates and updates if a *better* rank is found.
      // If 'data' and 'items' have the same rank (2), the one encountered first as per property order might win.
      // Let's test specific ordering.
      const schema1 = createSchema({
        items: arraySchema(),
        data: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema1), 'items'); // 'items' comes first in schema

      const schema2 = createSchema({
        data: arraySchema(),
        items: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema2), 'data'); // 'data' comes first in schema
    });

    test('should prefer "items" (rank 2) over "records" (rank 3)', () => {
      const schema = createSchema({
        records: arraySchema(),
        items: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'items');
    });

    test('should prefer "records" (rank 3) over "entries" (rank 4)', () => {
      const schema = createSchema({
        entries: arraySchema(),
        records: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'records');
    });
  });

  describe('Multiple Array Properties - Pluralization Heuristics', () => {
    test('should prefer a non-deprioritized plural over a non-keyword singular', () => {
      const schema = createSchema({
        products: arraySchema(), // Plural, not deprioritized
        detail: arraySchema(), // Singular
        info: arraySchema(), // Singular
      });
      assert.strictEqual(getItemsName(schema), 'products');
    });

    test('should prefer a non-deprioritized plural (users) over a deprioritized plural (details)', () => {
      const schema = createSchema({
        details: arraySchema(), // Plural, deprioritized
        users: arraySchema(), // Plural, not deprioritized
      });
      assert.strictEqual(getItemsName(schema), 'users');
    });

    test('should prefer a keyword like "items" (rank 2) over a non-deprioritized plural "products" (rank 5)', () => {
      const schema = createSchema({
        products: arraySchema(),
        items: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'items');
    });

    test('should prefer a non-deprioritized plural "orders" (rank 5) over a deprioritized plural "attributes" (rank 6)', () => {
      const schema = createSchema({
        attributes: arraySchema(),
        orders: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'orders');
    });

    test('should pick a deprioritized plural if it is the only plural and no keywords match better', () => {
      const schema = createSchema({
        links: arraySchema(), // Plural, deprioritized
        singularName: arraySchema(),
        anotherSingular: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'links');
    });

    test('should handle mixed case plurals correctly', () => {
      const schema = createSchema({
        Events: arraySchema(), // Plural, not deprioritized
        metaData: arraySchema(), // Singular
      });
      assert.strictEqual(getItemsName(schema), 'Events');
    });
  });

  describe('Fallback Behavior', () => {
    test('should return the first array property if no heuristics match strongly', () => {
      const schema = createSchema({
        arrayOne: arraySchema(),
        arrayTwo: arraySchema(),
        arrayThree: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'arrayOne');
    });

    test('should return the first array even if others are deprioritized plurals but no better match', () => {
      const schema = createSchema({
        alphaList: arraySchema(), // No strong signal
        beta_links: arraySchema(), // Deprioritized plural
        gamma_series: arraySchema(), // Deprioritized plural
      });
      assert.strictEqual(getItemsName(schema), 'alphaList'); // Falls back to first
    });
  });

  describe('Edge Cases and Specificity', () => {
    test('should handle properties that are not valid SchemaObjects gracefully (e.g. boolean)', () => {
      const schema = createSchema({
        validArray: arraySchema(),
        invalidProp: true as never, // Not a valid SchemaObject
      });
      assert.strictEqual(getItemsName(schema), 'validArray');
    });

    test('should handle properties that are null SchemaObjects gracefully', () => {
      const schema = createSchema({
        anotherArray: arraySchema(),
        nullProp: null as never, // Not a valid SchemaObject
      });
      assert.strictEqual(getItemsName(schema), 'anotherArray');
    });

    test('should correctly identify primary keyword even with other plausible names', () => {
      const schema = createSchema({
        userList: arraySchema(),
        data: arraySchema(), // Primary top-tier
        all_users: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema), 'data');
    });

    test('plural "status" (deprioritized) vs singular "item_list"', () => {
      // 'status' is plural but on deprioritize list (rank 6)
      // 'item_list' is singular (no rank from pluralization)
      // Fallback should pick 'status' if it's the only plural or first among equals.
      // However, if 'item_list' is the only array, it should be picked.
      const schema1 = createSchema({
        status: arraySchema(),
        item_list_singular: { type: 'string' }, // Not an array
      });
      assert.strictEqual(getItemsName(schema1), 'status');

      const schema2 = createSchema({
        status: arraySchema(), // deprioritized plural
        another_singular_array: arraySchema(), // singular array
      });
      // 'status' (rank 6) vs 'another_singular_array' (no rank from plural, default to first if no other match)
      // The current logic would make 'status' rank 6. 'another_singular_array' would be rank Infinity initially.
      // Then, if no other heuristics match, it falls back to the first array.
      // If 'status' is first, it wins. If 'another_singular_array' is first, it wins.
      // Let's test order.
      assert.strictEqual(getItemsName(schema2), 'status'); // 'status' is rank 6, 'another_singular_array' is effectively rank > 6

      const schema3 = createSchema({
        another_singular_array: arraySchema(),
        status: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema3), 'status'); // 'status' (rank 6) should still be preferred over 'another_singular_array' (rank > 6)
    });

    test('complex scenario with multiple heuristics', () => {
      const schema = createSchema({
        errors: arraySchema(), // deprioritized plural (rank 6)
        warnings: arraySchema(), // deprioritized plural (rank 6)
        payload: arraySchema(), // primary other keyword (rank 3)
        logs: arraySchema(), // non-deprioritized plural (rank 5)
        someData: arraySchema(), // singular
      });
      assert.strictEqual(getItemsName(schema), 'payload');
    });

    test('scenario where only deprioritized plurals exist', () => {
      const schema = createSchema({
        errors: arraySchema(),
        warnings: arraySchema(),
        details: arraySchema(),
      });
      // All are rank 6. The first one encountered should be returned.
      assert.strictEqual(getItemsName(schema), 'errors');
    });

    test('keyword that is also a deprioritized plural should get keyword rank', () => {
      // "errors" is on PLURAL_DEPRIORITIZE_LIST (would be rank 6)
      // If "errors" was also a secondary keyword (rank 4), it should be chosen with rank 4.
      // This test relies on the internal keyword lists or would need to mock them.
      // For now, let's use an existing keyword that is plural: "users" is in PRIMARY_OTHER_KEYWORDS (rank 3).
      // If "users" were (hypothetically) also on PLURAL_DEPRIORITIZE_LIST, it should still be rank 3.
      const schema = createSchema({
        someSingular: arraySchema(),
        users: arraySchema(), // Is a PRIMARY_OTHER_KEYWORD (rank 3)
        details: arraySchema(), // Is a PLURAL_DEPRIORITIZE_LIST item (rank 6)
      });
      // "users" (rank 3) should win over "details" (rank 6) and "someSingular" (fallback)
      assert.strictEqual(getItemsName(schema), 'users');
    });

    test('deprioritized plural with mixed casing is correctly identified', () => {
      const schema = createSchema({
        someSingular: arraySchema(),
        Errors: arraySchema(), // "errors" is on deprioritize list
        anotherSingular: arraySchema(),
      });
      // "Errors" (rank 6) should be chosen over singulars (fallback)
      assert.strictEqual(getItemsName(schema), 'Errors');
    });

    test('property name with leading/trailing underscores and on deprioritize list', () => {
      const schema = createSchema({
        _links_: arraySchema(), // plural of link, "links" is on deprioritize list
        items: arraySchema(), // primary top-tier keyword
      });
      // "items" (rank 2) should win over "_links_" (rank 6)
      assert.strictEqual(getItemsName(schema), 'items');

      const schema2 = createSchema({
        _links_: arraySchema(),
        someData: arraySchema(),
      });
      assert.strictEqual(getItemsName(schema2), '_links_');
    });

    test('property name with special characters (non-alphanumeric)', () => {
      const schema = createSchema({
        'item-list': arraySchema(), // plural, not on deprioritize list
        'data-feed': arraySchema(), // singular
      });
      // 'item-list' (rank 5) vs 'data-feed' (fallback)
      assert.strictEqual(getItemsName(schema), 'item-list');

      const schema2 = createSchema({
        'item-list': arraySchema(),
        data: arraySchema(), // keyword (rank 2)
      });
      assert.strictEqual(getItemsName(schema2), 'data');
    });

    test('empty string as property name for an array', () => {
      const schema1 = createSchema({
        '': arraySchema(),
        items: arraySchema(),
      });
      // "items" (rank 2) should win over "" (would be rank 5 if considered plural, or fallback)
      assert.strictEqual(getItemsName(schema1), 'items');

      const schema2 = createSchema({
        '': arraySchema(),
        anotherArray: arraySchema(),
      });
      // "" is plural (empty string is technically pluralized to "s" by some libraries,
      // but pluralize.isPlural('') is false). So it's a fallback.
      // The first one, "", should be chosen.
      assert.strictEqual(getItemsName(schema2), '');

      const schema3 = createSchema({
        anotherArray: arraySchema(),
        '': arraySchema(),
      });
      assert.strictEqual(getItemsName(schema3), 'anotherArray');
    });
  });

  describe('Comprehensive Ranking and Order Independence', () => {
    test('should pick top-tier keyword regardless of its order among other types', () => {
      const schema = createSchema({
        userActions: arraySchema(), // Non-deprioritized plural (rank 5)
        configurations: arraySchema(), // Deprioritized plural (rank 6)
        entries: arraySchema(), // Secondary keyword (rank 4)
        records: arraySchema(), // Primary other keyword (rank 3)
        data: arraySchema(), // Primary top-tier keyword (rank 2)
        someSingular: arraySchema(), // Singular (fallback)
      });
      assert.strictEqual(getItemsName(schema), 'data');
    });

    test('should pick primary other keyword if no top-tier, regardless of order', () => {
      const schema = createSchema({
        userActions: arraySchema(), // Non-deprioritized plural (rank 5)
        configurations: arraySchema(), // Deprioritized plural (rank 6)
        payload: arraySchema(), // Primary other keyword (rank 3)
        entries: arraySchema(), // Secondary keyword (rank 4)
        someSingular: arraySchema(), // Singular (fallback)
      });
      assert.strictEqual(getItemsName(schema), 'payload');
    });

    test('should pick secondary keyword if no primary, regardless of order', () => {
      const schema = createSchema({
        userActions: arraySchema(), // Non-deprioritized plural (rank 5)
        elements: arraySchema(), // Secondary keyword (rank 4)
        configurations: arraySchema(), // Deprioritized plural (rank 6)
        someSingular: arraySchema(), // Singular (fallback)
      });
      assert.strictEqual(getItemsName(schema), 'elements');
    });

    test('should pick non-deprioritized plural if no keywords, regardless of order', () => {
      const schema = createSchema({
        configurations: arraySchema(), // Deprioritized plural (rank 6)
        userActions: arraySchema(), // Non-deprioritized plural (rank 5)
        someSingular: arraySchema(), // Singular (fallback)
      });
      assert.strictEqual(getItemsName(schema), 'userActions');
    });

    test('should pick deprioritized plural if only that and singulars, regardless of order', () => {
      const schema = createSchema({
        someSingular: arraySchema(), // Singular (fallback)
        configurations: arraySchema(), // Deprioritized plural (rank 6)
        anotherSingular: arraySchema(), // Singular (fallback)
      });
      assert.strictEqual(getItemsName(schema), 'configurations');
    });

    test('if multiple properties have the same highest rank, first one is chosen', () => {
      const schema1 = createSchema({
        data: arraySchema(), // rank 2
        items: arraySchema(), // rank 2
        results: arraySchema(), // rank 2
      });
      assert.strictEqual(getItemsName(schema1), 'data');

      const schema2 = createSchema({
        items: arraySchema(), // rank 2
        data: arraySchema(), // rank 2
      });
      assert.strictEqual(getItemsName(schema2), 'items');

      const schema3 = createSchema({
        goodPlural: arraySchema(), // rank 5
        anotherGoodPlural: arraySchema(), // rank 5
      });
      assert.strictEqual(getItemsName(schema3), 'goodPlural');
    });

    test('singular name on deprioritize list (e.g. "status") is treated as singular if not plural', () => {
      // 'status' is singular, pluralize.isPlural('status') is false.
      // So it doesn't get rank 6 from being a deprioritized plural.
      // It's just a regular singular name.
      const schema1 = createSchema({
        status: arraySchema(), // Singular
        another: arraySchema(), // Singular
      });
      assert.strictEqual(getItemsName(schema1), 'status'); // Fallback to first

      const schema2 = createSchema({
        another: arraySchema(), // Singular
        status: arraySchema(), // Singular
      });
      assert.strictEqual(getItemsName(schema2), 'another'); // Fallback to first

      const schema3 = createSchema({
        status: arraySchema(), // Singular
        items: arraySchema(), // Keyword, rank 2
      });
      assert.strictEqual(getItemsName(schema3), 'items');

      const schema4 = createSchema({
        status: arraySchema(), // Singular
        statuses: arraySchema(), // Plural (non-deprioritized as "statuses" is not on list), rank 5
      });
      // "statuses" (rank 5) vs "status" (no rank, fallback)
      assert.strictEqual(getItemsName(schema4), 'statuses');
    });

    test('a keyword should be preferred over a non-keyword plural even if plural comes first', () => {
      const schema = createSchema({
        products: arraySchema(), // Non-keyword plural (rank 5)
        data: arraySchema(), // Primary top-tier keyword (rank 2)
      });
      assert.strictEqual(getItemsName(schema), 'data');
    });

    test('full spectrum ranking test with specific order', () => {
      const schema = createSchema({
        alpha: arraySchema(), // Singular fallback
        zeta_errors: arraySchema(), // Deprioritized plural (rank 6) "errors"
        beta_actions: arraySchema(), // Non-deprioritized plural (rank 5) "actions" (assuming not on deprioritize list for this test)
        gamma_elements: arraySchema(), // Secondary keyword (rank 4) "elements"
        delta_records: arraySchema(), // Primary other keyword (rank 3) "records"
        epsilon_items: arraySchema(), // Primary top-tier keyword (rank 2) "items"
      });
      assert.strictEqual(
        getItemsName(schema),
        'epsilon_items',
        'Failed with specific order 1',
      );

      const schema2 = createSchema({
        epsilon_items: arraySchema(), // Rank 2
        delta_records: arraySchema(), // Rank 3
        gamma_elements: arraySchema(), // Rank 4
        beta_actions: arraySchema(), // Rank 5
        zeta_errors: arraySchema(), // Rank 6
        alpha: arraySchema(), // Fallback
      });
      assert.strictEqual(
        getItemsName(schema2),
        'epsilon_items',
        'Failed with specific order 2 (reversed)',
      );
    });

    test('ensure singular items from PLURAL_DEPRIORITIZE_LIST are not ranked as plural', () => {
      // "status" is on PLURAL_DEPRIORITIZE_LIST, but singular "status" is not plural.
      const schema = createSchema({
        status: arraySchema(), // Singular, not plural. Fallback.
        items: arraySchema(), // Keyword, rank 2.
        logs: arraySchema(), // Plural, not on deprioritize list. Rank 5.
      });
      assert.strictEqual(getItemsName(schema), 'items');

      const schema2 = createSchema({
        status: arraySchema(), // Singular
        logs: arraySchema(), // Plural, rank 5
      });
      assert.strictEqual(getItemsName(schema2), 'logs');

      const schema3 = createSchema({
        status: arraySchema(), // Singular
        another_singular: arraySchema(), // Singular
      });
      assert.strictEqual(getItemsName(schema3), 'status'); // Fallback to first
    });
  });
});
