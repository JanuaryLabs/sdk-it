import type { ReferenceObject, SchemaObject } from 'openapi3-ts/oas31';
import React from 'react';

import { isRef } from '@sdk-it/core';

import { Description } from './description';

interface SchemaProps {
  schema: SchemaObject | ReferenceObject;
  name?: string;
  required?: boolean;
  level?: number;
  isNested?: boolean;
}

export const getTypeDisplay = (
  schemaToDisplay: SchemaObject | ReferenceObject,
): string => {
  // Handle reference objects
  if (isRef(schemaToDisplay)) {
    const refName = schemaToDisplay.$ref.split('/').pop() || 'unknown';
    return refName;
  }

  // Handle array types with nested item display
  if (schemaToDisplay.type === 'array' && schemaToDisplay.items) {
    // Recursively get the type of the array items
    const itemDisplay = getTypeDisplay(
      schemaToDisplay.items as SchemaObject | ReferenceObject,
    );
    return `array • ${itemDisplay}`;
  }

  // Handle enum types
  if (schemaToDisplay.enum && schemaToDisplay.enum.length > 0) {
    const valTypes = Array.from(
      new Set(schemaToDisplay.enum.map((v) => typeof v)),
    );
    const baseType = valTypes.join(' | ') || 'unknown';
    return `enum • ${baseType}`;
  }

  // Default type display
  const types = Array.isArray(schemaToDisplay.type)
    ? schemaToDisplay.type
    : schemaToDisplay.type
      ? [schemaToDisplay.type]
      : [];
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
export const SchemaProperty: React.FC<SchemaProps> = ({
  name,
  schema,
  required = false,
  level = 0,
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
      {
        <>
          <div className="flex items-center gap-x-1 text-sm">
            {indent}
            <code className="property-name">{name}</code>
            <span className="text-muted-foreground text-xs">
              {getTypeDisplay(schema)}
            </span>
            <span className="text-xs text-red-500">{isRequiredText}</span>
          </div>
          {schema.description && (
            <div>
              {indent}
              <Description varient="sm" description={schema.description} />
            </div>
          )}
        </>
      }

      {schema.properties &&
        Object.entries(schema.properties).map(([propName, propSchema]) => (
          <SchemaProperty
            key={propName}
            name={propName}
            schema={propSchema}
            required={(schema.required || []).includes(propName)}
            level={level + 1}
            isNested
          />
        ))}

      {schema.items && schema.type === 'array' && (
        <div>
          <SchemaProperty schema={schema.items} level={level + 1} isNested />
        </div>
      )}

      {schema.enum && schema.enum.length > 0 && (
        <div className="text-muted-foreground text-xs">
          {indent}Enum:
          {schema.enum.map((val) => JSON.stringify(val)).join(', ')}
        </div>
      )}
    </>
  );
};

export const SchemaComponent: React.FC<SchemaProps> = (props) => {
  return <SchemaProperty {...props} />;
};
