/* eslint-disable @nx/enforce-module-boundaries */
import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import React, { Fragment } from 'react';

import { isRef, parseRef } from '@sdk-it/core/ref.js';
import { isEmpty } from '@sdk-it/core/utils.js';
import { isPrimitiveSchema } from '@sdk-it/spec/is-primitive-schema.js';
import { coerceTypes } from '@sdk-it/spec/tune.js';

import { Separator } from '../shadcn/separator.tsx';
import { Description } from './description';

interface SchemaProps {
  schema: SchemaObject | ReferenceObject;
  name?: string;
  required?: boolean;
  level?: number;
  isNested?: boolean;
  hideType?: (level: number) => boolean;
}

export const getTypeDisplay = (
  schemaToDisplay: SchemaObject | ReferenceObject,
): string => {
  if (isRef(schemaToDisplay)) {
    return parseRef(schemaToDisplay.$ref).model;
  }

  if (schemaToDisplay.type === 'array' && schemaToDisplay.items) {
    const itemDisplay = getTypeDisplay(schemaToDisplay.items);
    return `array • ${itemDisplay}`;
  }

  if (schemaToDisplay.enum && schemaToDisplay.enum.length > 0) {
    const valTypes = Array.from(
      new Set(schemaToDisplay.enum.map((value) => typeof value)),
    );
    const baseType = valTypes.join(' | ') || 'unknown';
    return `enum • ${schemaToDisplay.type || baseType}`;
  }

  // Default type display
  const types = coerceTypes(schemaToDisplay);
  let nullable = false;
  if (types.includes('null')) {
    nullable = true;
  }
  const mainTypes = types.filter((t) => t !== 'null');
  let typeDisplay = mainTypes.join(' | ') || 'unknown';
  if (schemaToDisplay.format) {
    typeDisplay += ` (${schemaToDisplay.format})`;
  }
  if (nullable) {
    typeDisplay += ' | null';
  }
  return typeDisplay;
};

export const SchemaComponent: React.FC<SchemaProps> = ({
  name,
  schema,
  required = false,
  level = 0,
  hideType = () => false,
}) => {
  const indent = `${'\u00A0\u00A0'.repeat(level)}${' '.repeat(2)}`;
  const isRequiredText = required ? ' required' : ' optional';

  if (isRef(schema)) {
    const refName = schema.$ref.split('/').pop();
    return (
      <div className="flex flex-wrap items-center gap-x-1 text-sm">
        {name && (
          <code className="property-name">
            {indent}
            {name}
          </code>
        )}
        <span className="text-muted-foreground text-xs">{refName}</span>
        <span className="text-xs text-red-500">{isRequiredText}</span>
      </div>
    );
  }

  return (
    <>
      {!hideType(level) && (
        <div className="flex items-center gap-x-1 text-sm">
          {indent}
          <code className="property-name">{name}</code>
          <span className="text-muted-foreground text-xs">
            {getTypeDisplay(schema)}
          </span>
          <span className="text-xs text-red-500">{isRequiredText}</span>
        </div>
      )}
      {schema.description && (
        <div>
          {indent}
          <Description varient="sm" description={schema.description} />
        </div>
      )}

      {schema.properties &&
        Object.entries(schema.properties).map(([propName, propSchema]) => (
          <Fragment key={propName}>
            <Separator className="my-4" />
            <SchemaComponent
              key={propName}
              name={propName}
              schema={propSchema}
              required={(schema.required || []).includes(propName)}
              level={hideType(level) ? level : level + 1}
              isNested
            />
          </Fragment>
        ))}

      {schema.items && (
        <div>
          <SchemaComponent
            schema={schema.items}
            hideType={() => true} // Hide type for items
            level={
              isRef(schema.items) || isPrimitiveSchema(schema.items)
                ? level
                : level + 1
            }
            isNested
          />
        </div>
      )}

      {!isEmpty(schema.enum) && (
        <div className="text-muted-foreground text-xs">
          {indent}Enum:{' '}
          {schema.enum.map((val) => JSON.stringify(val)).join(', ')}
        </div>
      )}
    </>
  );
};
