import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import YAML from 'yaml';
import { COMPONENT_SCHEMAS } from './zod-schemas';
import { ZOD_VALIDATE_MAP } from './schema-registry';

/** Convert all Zod component schemas to OpenAPI 3.1 JSON Schema objects */
export function buildComponentSchemas(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = zodToJsonSchema(schema as any, {
      name,
      $refStrategy: 'none',
      target: 'openApi3',
    }) as Record<string, unknown>;
    out[name] = extractNamedSchema(json, name);
  }
  return out;
}

function extractNamedSchema(json: Record<string, unknown>, name: string): Record<string, unknown> {
  const definitions = json.definitions as Record<string, Record<string, unknown>> | undefined;
  if (definitions?.[name]) return definitions[name];

  if (typeof json.$ref === 'string' && definitions) {
    const refKey = json.$ref.replace('#/definitions/', '');
    if (definitions[refKey]) return definitions[refKey];
  }

  const { $schema, definitions: _defs, $ref, ...rest } = json;
  void $schema;
  void _defs;
  void $ref;
  return rest;
}

/** Emit OpenAPI schema object lines (indented under parent key) */
export function emitSchemaObjectLines(schema: Record<string, unknown>, baseIndent: number): string[] {
  const yaml = YAML.stringify(schema, { indent: 2 }).trimEnd();
  const pad = '  '.repeat(baseIndent);
  return yaml.split('\n').map((line: string) => `${pad}${line}`);
}

export function schemaRef(name: string): string {
  return `#/components/schemas/${name}`;
}

export function yamlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/** Extract OpenAPI path parameters from a normalized path */
export function extractPathParams(apiPath: string): string[] {
  const params: string[] = [];
  const re = /\{([A-Za-z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(apiPath)) !== null) params.push(m[1]);
  return params;
}

/** Parse route file content for validate(schemaName) middleware usage */
export function parseValidateSchemas(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const routeRe = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`][^)]*validate\((\w+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content)) !== null) {
    const method = m[1].toLowerCase();
    const routePath = m[2];
    const schemaVar = m[3];
    const componentName = ZOD_VALIDATE_MAP[schemaVar];
    if (componentName) {
      map.set(`${method} ${routePath}`, componentName);
    }
  }
  return map;
}

export function mergeSpecs(
  base: { requestBody?: string; response?: string; successStatus?: number } | undefined,
  validateRequest?: string,
): { requestBody?: string; response?: string; successStatus?: number } | undefined {
  if (!base && !validateRequest) return undefined;
  return {
    ...base,
    requestBody: base?.requestBody ?? validateRequest,
  };
}

/** Check if request body schema is typed (not generic JsonObjectRequest) */
export function isTypedRequest(schemaName?: string): boolean {
  if (!schemaName) return false;
  return schemaName !== 'JsonObjectRequest';
}

/** Check if response schema is typed (not generic envelope) */
export function isTypedResponse(schemaName?: string): boolean {
  if (!schemaName) return false;
  return !['GenericDataResponse', 'GenericDataListResponse', 'MessageResponse'].includes(schemaName);
}

export function countCoverage(
  routes: { method: string; path: string }[],
  resolve: (method: string, path: string) => { requestBody?: string; response?: string } | undefined,
): {
  total: number;
  withRequestBody: number;
  withTypedRequest: number;
  withResponse: number;
  withTypedResponse: number;
  withAnySchema: number;
} {
  let withRequestBody = 0;
  let withTypedRequest = 0;
  let withResponse = 0;
  let withTypedResponse = 0;
  let withAnySchema = 0;
  for (const r of routes) {
    const spec = resolve(r.method, r.path);
    const hasReq = !!spec?.requestBody;
    const hasTypedReq = isTypedRequest(spec?.requestBody);
    const hasRes = !!spec?.response;
    const hasTypedRes = isTypedResponse(spec?.response);
    const hasAny = hasReq || hasRes;
    if (hasReq) withRequestBody++;
    if (hasTypedReq) withTypedRequest++;
    if (hasRes) withResponse++;
    if (hasTypedRes) withTypedResponse++;
    if (hasAny) withAnySchema++;
  }
  return { total: routes.length, withRequestBody, withTypedRequest, withResponse, withTypedResponse, withAnySchema };
}


export type ZodSchemaMap = Record<string, z.ZodTypeAny>;
