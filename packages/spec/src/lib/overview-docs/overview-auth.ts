import type { OAuthFlowsObject, SecuritySchemeObject } from 'openapi3-ts/oas31';

import { resolveRef } from '@sdk-it/core';

import type { NavItem } from '../sidebar.js';
import type { OurOpenAPIObject } from '../types.js';
import {
  getAuthIntroText,
  getTextByCount,
  presetDocs,
} from './doc-text-utils.js';

function getSecuritySchemeDescription(scheme: SecuritySchemeObject): string {
  switch (scheme.type) {
    case 'apiKey': {
      const location =
        scheme.in === 'header'
          ? 'HTTP header'
          : scheme.in === 'query'
            ? 'query parameter'
            : 'cookie';
      return `API Key authentication requires you to provide an API key in the ${location} named \`${scheme.name}\`.`;
    }
    case 'http':
      if (scheme.scheme === 'bearer') {
        const format = scheme.bearerFormat
          ? ` The expected token format is \`${scheme.bearerFormat}\`.`
          : '';
        return `Bearer token authentication requires you to include a bearer token in the \`Authorization\` header of your requests.${format}`;
      }
      if (scheme.scheme === 'basic') {
        return `Basic authentication requires you to provide a username and password, encoded in base64 format in the \`Authorization\` header.`;
      }
      return `HTTP ${scheme.scheme} authentication is required for accessing this API.`;
    case 'oauth2': {
      const flows = Object.keys(scheme.flows || {});
      const flowDescriptions = flows.map((flow) => {
        switch (flow) {
          case 'authorizationCode':
            return 'Authorization Code (for server-side applications)';
          case 'implicit':
            return 'Implicit (for browser-based applications)';
          case 'password':
            return 'Resource Owner Password Credentials';
          case 'clientCredentials':
            return 'Client Credentials (for machine-to-machine authentication)';
          default:
            return flow;
        }
      });
      return `OAuth 2.0 authentication is supported with the following grant type(s): ${flowDescriptions.join(', ')}.`;
    }
    case 'openIdConnect':
      return `OpenID Connect authentication is used for this API. You will need to authenticate through the OpenID provider to obtain access tokens.`;
    default:
      return 'This API uses a custom authentication scheme. Please refer to the API documentation for specific details.';
  }
}

function formatOAuth2Flows(flows: OAuthFlowsObject): string {
  let result = '';

  for (const [flowType, flow] of Object.entries(flows || {})) {
    result += `#### ${getFlowDisplayName(flowType)}\n\n`;

    if (flow.authorizationUrl) {
      result += `- **Authorization URL:** \`${flow.authorizationUrl}\`\n`;
    }
    if (flow.tokenUrl) {
      result += `- **Token URL:** \`${flow.tokenUrl}\`\n`;
    }
    if (flow.refreshUrl) {
      result += `- **Refresh URL:** \`${flow.refreshUrl}\`\n`;
    }
    if (flow.scopes && Object.keys(flow.scopes).length > 0) {
      result += `- **Available Scopes:**\n`;
      for (const [scope, description] of Object.entries(flow.scopes)) {
        result += `  - \`${scope}\`: ${description}\n`;
      }
    }
    result += '\n';
  }

  return result;
}

function getFlowDisplayName(flowType: string): string {
  const flowNames: Record<string, string> = {
    authorizationCode: 'Authorization Code Flow',
    implicit: 'Implicit Flow',
    password: 'Resource Owner Password Flow',
    clientCredentials: 'Client Credentials Flow',
  };
  return flowNames[flowType] || flowType;
}

export function generateAuthOverview(spec: OurOpenAPIObject): NavItem {
  let markdown = `# Authentication\n\n`;

  const securitySchemes = spec.components.securitySchemes;
  const globalSecurity = spec.security || [];

  const authMethodCount = Object.keys(securitySchemes).length;
  if (!authMethodCount && !globalSecurity.length) {
    markdown += `This API does not require authentication.\n\n`;
  } else {
    if (authMethodCount > 1) {
      markdown += `${getAuthIntroText(authMethodCount)}\n\n`;
      markdown += `## ${getTextByCount(authMethodCount, presetDocs.auth.section)}\n\n`;
    }

    for (const [name, scheme] of Object.entries(securitySchemes)) {
      const schemeObj = resolveRef<SecuritySchemeObject>(spec, scheme);
      if (authMethodCount > 1) {
        markdown += `### ${name}\n\n`;
      }

      const description =
        schemeObj.description || getSecuritySchemeDescription(schemeObj);
      markdown += `${description}\n\n`;

      if (schemeObj.type === 'apiKey') {
        markdown += `**Details:**\n`;
        markdown += `- Parameter Name: \`${schemeObj.name}\`\n`;
        markdown += `- Location: ${schemeObj.in === 'header' ? 'HTTP Header' : schemeObj.in === 'query' ? 'Query Parameter' : 'Cookie'}\n\n`;
      } else if (schemeObj.type === 'http') {
        if (schemeObj.bearerFormat) {
          markdown += `- Token Format: \`${schemeObj.bearerFormat}\`\n`;
        }
        markdown += '\n';
      } else if (schemeObj.type === 'oauth2' && schemeObj.flows) {
        markdown += `**OAuth 2.0 Flows:**\n\n`;
        markdown += formatOAuth2Flows(schemeObj.flows);
      } else if (schemeObj.type === 'openIdConnect') {
        markdown += `**Details:**\n`;
        markdown += `- Discovery URL: \`${schemeObj.openIdConnectUrl}\`\n\n`;
      }
    }
  }

  return {
    id: 'authorization',
    url: '/authorization',
    title: 'Authorization',
    description: 'Authentication methods and security schemes',
    content: markdown,
  };
}
