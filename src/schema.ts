/*
 * Helvetium MCP - Helvetium Framework, A Newfoundcodes project.
 *
 * Copyright (C) 2026 Jonathan Eldy Baldivicio
 *
 * Author: Jonathan Eldy Baldivicio
 * Contact: jonathaneldy.baldivicio@newfoundcodes.com
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { invalidParams } from './errors.js';

function join(path: string, key: string | number) {
  return path ? `${path}.${key}` : String(key);
}

function typeOk(type: string, v: unknown): boolean {
  switch (type) {
    case 'null':
      return v === null;

    case 'array':
      return Array.isArray(v);

    case 'object':
      return !!v && typeof v === 'object' && !Array.isArray(v);

    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);

    default:
      return typeof v === type;
  }
}

export function validateJSONSchema(
  schema: Record<string, unknown>,
  value: unknown,
  path = '',
): SchemaValidationResult {
  const issues: SchemaIssue[] = [];
  const add = (message: string, keyword?: string, p = path) =>
    issues.push({ path: p, message, ...(keyword ? { keyword } : {}) });

  if ((schema as unknown) === true) {
    return { valid: true, issues };
  }

  if ((schema as unknown) === false) {
    add('Value is not allowed');
    return { valid: false, issues };
  }

  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    add('Value must equal const', 'const');
  }

  if (
    Array.isArray(schema.enum) &&
    !((schema.enum as unknown[]) || []).some(
      (x: unknown) => JSON.stringify(x) === JSON.stringify(value),
    )
  ) {
    add('Value is not in enum', 'enum');
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t: string) => typeOk(t, value))) {
      add(`Expected ${types.join(' or ')}`, 'type');
      return { valid: false, issues };
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const s of schema.allOf) {
      issues.push(...validateJSONSchema(s, value, path).issues);
    }
  }

  if (
    Array.isArray(schema.anyOf) &&
    !((schema.anyOf as unknown[]) || []).some(
      (s: unknown) => validateJSONSchema(s as Record<string, unknown>, value, path).valid,
    )
  ) {
    add('Value must match at least one anyOf schema', 'anyOf');
  }

  if (Array.isArray(schema.oneOf)) {
    const n = ((schema.oneOf as unknown[]) || []).filter(
      (s: unknown) => validateJSONSchema(s as Record<string, unknown>, value, path).valid,
    ).length;

    if (n !== 1) {
      add('Value must match exactly one oneOf schema', 'oneOf');
    }
  }

  if (schema.not && validateJSONSchema(schema.not as Record<string, unknown>, value, path).valid) {
    add('Value matches forbidden schema', 'not');
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      add(`String is shorter than ${schema.minLength}`, 'minLength');
    }

    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      add(`String is longer than ${schema.maxLength}`, 'maxLength');
    }

    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      add('String does not match pattern', 'pattern');
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      add(`Number is below ${schema.minimum}`, 'minimum');
    }

    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      add(`Number is above ${schema.maximum}`, 'maximum');
    }

    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      add(`Number must be greater than ${schema.exclusiveMinimum}`, 'exclusiveMinimum');
    }

    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
      add(`Number must be less than ${schema.exclusiveMaximum}`, 'exclusiveMaximum');
    }

    if (
      typeof schema.multipleOf === 'number' &&
      Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-10
    ) {
      add(`Number must be a multiple of ${schema.multipleOf}`, 'multipleOf');
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      add(`Array has fewer than ${schema.minItems} items`, 'minItems');
    }

    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      add(`Array has more than ${schema.maxItems} items`, 'maxItems');
    }

    if (schema.uniqueItems) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) {
        add('Array items must be unique', 'uniqueItems');
      }
    }

    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        issues.push(
          ...validateJSONSchema(schema.items as Record<string, unknown>, value[i], join(path, i))
            .issues,
        );
      }
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];

    for (const key of required) {
      if (!(key in object)) {
        issues.push({
          path: join(path, key),
          message: 'Required property is missing',
          keyword: 'required',
        });
      }
    }

    if (schema.properties) {
      for (const [key, s] of Object.entries(schema.properties)) {
        if (key in object) {
          issues.push(
            ...validateJSONSchema(s as Record<string, unknown>, object[key], join(path, key))
              .issues,
          );
        }
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(object)) {
        if (!(key in (schema.properties as Record<string, unknown>))) {
          issues.push({
            path: join(path, key),
            message: 'Additional property is not allowed',
            keyword: 'additionalProperties',
          });
        }
      }
    }

    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      for (const key of Object.keys(object)) {
        if (!schema.properties || !(key in (schema.properties as Record<string, unknown>))) {
          issues.push(
            ...validateJSONSchema(
              schema.additionalProperties as Record<string, unknown>,
              object[key],
              join(path, key),
            ).issues,
          );
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

export function assertJSONSchema(
  schema: Record<string, unknown>,
  value: unknown,
  label = 'value',
): void {
  const r = validateJSONSchema(schema, value);
  if (!r.valid) {
    throw invalidParams(`Invalid ${label}`, { issues: r.issues });
  }
}

export function headerAnnotatedProperties(
  schema: Record<string, unknown>,
): Array<{ path: string[]; header: string }> {
  const out: Array<{ path: string[]; header: string }> = [];
  const walk = (s: Record<string, unknown>, path: string[]) => {
    if (!s || typeof s !== 'object') {
      return;
    }

    if (typeof s['x-mcp-header'] === 'string') {
      out.push({ path, header: s['x-mcp-header'] });
    }

    if (s.properties) {
      for (const [k, v] of Object.entries(s.properties)) {
        walk(v, [...path, k]);
      }
    }
  };

  walk(schema, []);
  return out;
}
