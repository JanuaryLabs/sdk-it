import type { SchemaObject, SchemasObject } from 'openapi3-ts/oas31';
import pluralize from 'pluralize';

const PRIMARY_TOP_TIER_KEYWORDS: string[] = [
  'data',
  'items',
  'results',
  'value',
];
const PRIMARY_OTHER_KEYWORDS: string[] = [
  'records',
  'content',
  'list',
  'payload',
  'entities',
  'collection',
  'users',
  'products',
  'orders',
  'bookings',
  'articles',
  'posts',
  'documents',
  'events',
];
const SECONDARY_KEYWORDS: string[] = ['entries', 'rows', 'elements'];

const PLURAL_DEPRIORITIZE_LIST: string[] = [
  'status',
  'success',
  'address',
  'details',
  'properties',
  'params',
  'headers',
  'cookies',
  'series',
  'links',
  'meta',
  'metadata',
  'statistics',
  'settings',
  'options',
  'permissions',
  'credentials',
  'diagnostics',
  'warnings',
  'errors',
  'actions',
  'attributes',
  'categories',
  'features',
  'includes',
  'tags',
];

// For exact matches (normalized: lowercase, no underscores/hyphens)
const HAS_MORE_PRIMARY_POSITIVE_EXACT: string[] = [
  'hasmore',
  'hasnext',
  'hasnextpage',
  'moreitems',
  'moreitemsavailable',
  'nextpage',
  'nextpageexists',
  'nextpageavailable',
  'hasadditionalresults',
  'moreresultsavailable',
  'canloadmore',
  'hasadditional',
  'additionalitems',
  'fetchmore',
];

const HAS_MORE_SECONDARY_POSITIVE_EXACT: string[] = ['more', 'next'];

const HAS_MORE_PRIMARY_INVERTED_EXACT: string[] = [
  'islast',
  'lastpage',
  'endofresults',
  'endoflist',
  'nomoreitems',
  'nomoredata',
  'allitemsloaded',
  'iscomplete',
  'completed',
];

// For regex-based sub-phrase matching (tested against original propName, case-insensitive)
// These regexes look for meaningful phrases, often using word boundaries (\b)
// and allowing for optional underscores.
const HAS_MORE_POSITIVE_REGEX_PATTERNS: string[] = [
  '\\bhas_?more\\b',
  '\\bhas_?next\\b', // e.g., itemsHasNext, items_has_next
  '\\bmore_?items\\b',
  '\\bnext_?page\\b', // e.g., userNextPageFlag
  '\\badditional\\b', // e.g., hasAdditionalData, additional_results_exist
  '\\bcontinuation\\b', // e.g., continuationAvailable, has_continuation_token
  '\\bmore_?results\\b',
  '\\bpage_?available\\b',
  '\\bnext(?:_?(page|marker))?\\b',
];
const COMPILED_HAS_MORE_POSITIVE_REGEXES: RegExp[] =
  HAS_MORE_POSITIVE_REGEX_PATTERNS.map((p) => new RegExp(p, 'i'));

const HAS_MORE_INVERTED_REGEX_PATTERNS: string[] = [
  '\\bis_?last\\b', // e.g., pageIsLast
  '\\blast_?page\\b', // e.g., resultsAreLastPage
  '\\bend_?of_?(data|results|list|items|stream)\\b',
  '\\bno_?more_?(items|data|results)?\\b',
  '\\ball_?(items_?)?loaded\\b',
  '\\bis_?complete\\b',
];
const COMPILED_HAS_MORE_INVERTED_REGEXES: RegExp[] =
  HAS_MORE_INVERTED_REGEX_PATTERNS.map((p) => new RegExp(p, 'i'));

/**
 * Tries to guess the name of the property that holds the main list of items
 * within an object schema using a series of heuristics.
 *
 * @param schema The OpenAPI SchemaObject, expected to be of type 'object'.
 * @returns The name of the most likely property containing the items array,
 *          or null if no array properties are found in the schema.
 */
export function getItemsName(
  properties: Record<string, SchemaObject>,
): string | null {
  const arrayPropertyNames: string[] = [];
  for (const propName in properties) {
    if (propName in properties) {
      const propSchema = properties[propName] as SchemaObject;
      if (propSchema && propSchema.type === 'array') {
        arrayPropertyNames.push(propName);
      }
    }
  }

  // Heuristic 0: No array properties at all.
  if (arrayPropertyNames.length === 0) {
    return null;
  }

  // Heuristic 1: Exactly one array property. This is the strongest signal.
  if (arrayPropertyNames.length === 1) {
    return arrayPropertyNames[0];
  }

  // Multiple array properties exist. Apply ranked heuristics:
  let bestCandidate: string | null = null;
  let candidateRank = Infinity; // Lower is better

  const updateCandidate = (propName: string, rank: number) => {
    if (rank < candidateRank) {
      bestCandidate = propName;
      candidateRank = rank;
    }
  };

  for (const propName of arrayPropertyNames) {
    const lowerPropName = propName.toLowerCase();

    // Heuristic 2: Top-tier primary keywords (e.g., "data", "items")
    if (PRIMARY_TOP_TIER_KEYWORDS.includes(lowerPropName)) {
      updateCandidate(propName, 2);
      continue; // Move to next property, this is a strong match for this prop
    }

    // Heuristic 3: Other primary keywords
    if (candidateRank > 3 && PRIMARY_OTHER_KEYWORDS.includes(lowerPropName)) {
      updateCandidate(propName, 3);
      continue;
    }

    // Heuristic 4: Secondary keywords
    if (candidateRank > 4 && SECONDARY_KEYWORDS.includes(lowerPropName)) {
      updateCandidate(propName, 4);
      continue;
    }

    // Heuristic 5: Pluralized name, not on the deprioritize list
    if (
      candidateRank > 5 &&
      pluralize.isPlural(propName) &&
      !PLURAL_DEPRIORITIZE_LIST.includes(lowerPropName)
    ) {
      updateCandidate(propName, 5);
      continue;
    }

    // Heuristic 6: Pluralized name, IS on the deprioritize list (less preferred plural)
    if (
      candidateRank > 6 &&
      pluralize.isPlural(propName) &&
      PLURAL_DEPRIORITIZE_LIST.includes(lowerPropName)
    ) {
      updateCandidate(propName, 6);
      continue;
    }
  }

  // If any of the above heuristics found a candidate, return it.
  if (bestCandidate) {
    return bestCandidate;
  }

  // Heuristic 7: Fallback - If no keywords or clear plurals,
  // and multiple arrays exist, return the first array property encountered.
  // This ensures we always return a name if arrays are present.
  return arrayPropertyNames[0];
}

function guess(properties: Record<string, SchemaObject>) {
  const booleanPropertyNames: string[] = [];
  for (const propName in properties) {
    const propSchema = properties[propName] as SchemaObject;
    if (
      propSchema.type === 'boolean' ||
      propSchema.type === 'integer' ||
      propSchema.type === 'string'
    ) {
      booleanPropertyNames.push(propName);
    }
  }

  if (booleanPropertyNames.length === 0) {
    return null;
  }

  if (booleanPropertyNames.length === 1) {
    return booleanPropertyNames[0];
  }

  let bestCandidate: string | null = null;
  let candidateRank = Infinity;

  const updateCandidate = (propName: string, rank: number) => {
    if (rank < candidateRank) {
      bestCandidate = propName;
      candidateRank = rank;
    }
  };

  for (const propName of booleanPropertyNames) {
    const normalizedForExactMatch = propName.toLowerCase().replace(/[-_]/g, '');
    let currentPropRank = Infinity;

    // Rank 1: Primary Exact Positive Match
    if (HAS_MORE_PRIMARY_POSITIVE_EXACT.includes(normalizedForExactMatch)) {
      currentPropRank = 1;
    }
    // Rank 2: Secondary Exact Positive Match
    else if (
      HAS_MORE_SECONDARY_POSITIVE_EXACT.includes(normalizedForExactMatch)
    ) {
      currentPropRank = 2;
    }
    // Rank 3: Positive Regex Match (sub-phrase)
    else {
      let foundPositiveRegex = false;
      for (const regex of COMPILED_HAS_MORE_POSITIVE_REGEXES) {
        if (regex.test(propName)) {
          // Test against original propName
          currentPropRank = 3;
          foundPositiveRegex = true;
          break;
        }
      }

      // Only proceed to inverted matches if no positive match of any kind (Rank 1, 2, or 3) was found
      if (!foundPositiveRegex) {
        // Rank 4: Primary Exact Inverted Match
        if (HAS_MORE_PRIMARY_INVERTED_EXACT.includes(normalizedForExactMatch)) {
          currentPropRank = 4;
        }
        // Rank 5: Inverted Regex Match (sub-phrase)
        else {
          for (const regex of COMPILED_HAS_MORE_INVERTED_REGEXES) {
            if (regex.test(propName)) {
              // Test against original propName
              currentPropRank = 5;
              break;
            }
          }
        }
      }
    }

    updateCandidate(propName, currentPropRank);
  }
  return bestCandidate;
}

/**
 * Tries to guess the name of a boolean property that indicates if there are more items
 * to fetch (e.g., for pagination).
 *
 * @param schema The OpenAPI SchemaObject, expected to be of type 'object'.
 * @returns The name of the most likely boolean property indicating "has more",
 *          or null if no suitable boolean property is found.
 */
export function getHasMoreName(properties: SchemasObject): string | null {
  const rootGuess = guess(properties);
  if (rootGuess) {
    return rootGuess;
  }
  for (const propName in properties) {
    const propSchema = properties[propName];
    if (propSchema.type === 'object' && propSchema.properties) {
      const nested = getHasMoreName(propSchema.properties as SchemasObject);
      if (nested) {
        return propName + '.' + nested;
      }
    }
  }
  return null;
}
