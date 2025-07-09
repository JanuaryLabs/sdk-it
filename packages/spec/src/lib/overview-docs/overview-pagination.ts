import type { NavItem } from '../sidebar.js';
import type { OurOpenAPIObject } from '../types.js';

export function generatePaginationOverview(spec: OurOpenAPIObject): NavItem {
  const markdown: string[] = [];

  markdown.push(`# Pagination`);
  markdown.push(`This API uses cursor-based pagination to efficiently navigate through large datasets.`);
  
  markdown.push(`## How Pagination Works`);
  markdown.push(`When making requests to endpoints that return multiple items, you can control the number of results and navigate through pages using the following parameters:`);
  markdown.push('');
  markdown.push(`- **limit** - The maximum number of items to return per page (default: 20, max: 100)`);
  markdown.push(`- **cursor** - A token representing the position in the dataset to start from`);
  markdown.push('');

  markdown.push(`## Example Usage`);
  markdown.push('');
  markdown.push('### TypeScript');
  markdown.push('```typescript');
  markdown.push('// First page');
  markdown.push('const firstPage = await client.items.list({');
  markdown.push('  limit: 25');
  markdown.push('});');
  markdown.push('');
  markdown.push('// Next page');
  markdown.push('if (firstPage.nextCursor) {');
  markdown.push('  const secondPage = await client.items.list({');
  markdown.push('    limit: 25,');
  markdown.push('    cursor: firstPage.nextCursor');
  markdown.push('  });');
  markdown.push('}');
  markdown.push('```');
  markdown.push('');

  markdown.push(`## Response Structure`);
  markdown.push(`Paginated responses follow this structure:`);
  markdown.push('');
  markdown.push('```json');
  markdown.push('{');
  markdown.push('  "data": [...], // Array of items');
  markdown.push('  "nextCursor": "eyJpZCI6MTAwfQ==", // Token for next page (null if last page)');
  markdown.push('  "hasMore": true, // Whether more pages exist');
  markdown.push('  "totalCount": 150 // Total number of items (if available)');
  markdown.push('}');
  markdown.push('```');
  markdown.push('');

  markdown.push(`## Iterating Through All Pages`);
  markdown.push('');
  markdown.push('### TypeScript');
  markdown.push('```typescript');
  markdown.push('async function getAllItems() {');
  markdown.push('  const allItems = [];');
  markdown.push('  let cursor = undefined;');
  markdown.push('  ');
  markdown.push('  do {');
  markdown.push('    const page = await client.items.list({');
  markdown.push('      limit: 100,');
  markdown.push('      cursor');
  markdown.push('    });');
  markdown.push('    ');
  markdown.push('    allItems.push(...page.data);');
  markdown.push('    cursor = page.nextCursor;');
  markdown.push('  } while (cursor);');
  markdown.push('  ');
  markdown.push('  return allItems;');
  markdown.push('}');
  markdown.push('```');
  markdown.push('');

  markdown.push(`## Best Practices`);
  markdown.push('');
  markdown.push(`1. **Use appropriate page sizes** - Balance between number of requests and response size`);
  markdown.push(`2. **Handle cursors securely** - Don't modify cursor values; treat them as opaque tokens`);
  markdown.push(`3. **Implement retry logic** - Handle temporary failures when iterating through pages`);
  markdown.push(`4. **Consider rate limits** - Be mindful of API rate limits when fetching multiple pages`);

  return {
    id: 'generated-pagination',
    title: 'Pagination',
    url: '/pagination',
    description: 'Learn how to navigate through paginated API responses',
    content: markdown.join('\n'),
  };
}