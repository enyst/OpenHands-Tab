import type { LLMToolDefinition } from './types';

const SCHEMA_INDENT_STEP = 2;
const SCHEMA_UNION_KEYS = ['anyOf', 'oneOf', 'allOf'] as const;
const MISSING_DESCRIPTION_PLACEHOLDER = 'No description provided';

const systemMessageSuffixTemplate = `You have access to the following functions:

{description}

If you choose to call a function ONLY reply in the following format with NO suffix:

<function=example_function_name>
<parameter=example_parameter_1>value_1</parameter>
<parameter=example_parameter_2>
This is the value for the second parameter
that can span
multiple lines
</parameter>
</function>

<IMPORTANT>
Reminder:
- Function calls MUST follow the specified format, start with <function= and end with </function>
- Required parameters MUST be specified
- Only call one function at a time
- You may provide optional reasoning for your function call in natural language BEFORE the function call, but NOT after.
- If there is no function call available, answer the question like normal with your current knowledge and do not tell the user about function calls
</IMPORTANT>`;

const indent = (spaces: number): string => ' '.repeat(spaces);
const nestedIndent = (spaces: number, levels = 1): number => spaces + SCHEMA_INDENT_STEP * levels;

const summarizeSchemaType = (schema: unknown): string => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema == null ? 'unknown' : String(schema);
  }

  const typedSchema = schema as Record<string, unknown>;
  for (const key of SCHEMA_UNION_KEYS) {
    const options = typedSchema[key];
    if (Array.isArray(options)) {
      return options.map((option) => summarizeSchemaType(option)).join(' or ');
    }
  }

  const schemaType = typedSchema.type;
  if (Array.isArray(schemaType)) {
    return schemaType.map(String).join(' or ');
  }
  if (schemaType === 'array') {
    const items = typedSchema.items;
    if (Array.isArray(items)) {
      return `array[${items.map((item) => summarizeSchemaType(item)).join(', ')}]`;
    }
    if (items && typeof items === 'object') {
      return `array[${summarizeSchemaType(items)}]`;
    }
    return 'array';
  }
  if (schemaType) return String(schemaType);
  if ('enum' in typedSchema) return 'enum';
  return 'unknown';
};

const getDescription = (schema: unknown): string => {
  if (schema && typeof schema === 'object' && !Array.isArray(schema) && 'description' in (schema as Record<string, unknown>)) {
    const description = (schema as Record<string, unknown>).description;
    if (typeof description === 'string' && description.trim()) {
      return description;
    }
  }
  return MISSING_DESCRIPTION_PLACEHOLDER;
};

const formatUnionDetails = (schema: Record<string, unknown>, spaces: number): string[] | null => {
  for (const key of SCHEMA_UNION_KEYS) {
    const options = schema[key];
    if (!Array.isArray(options)) continue;
    const lines = [`${indent(spaces)}${key} options:`];
    for (const option of options) {
      const optionType = summarizeSchemaType(option);
      const optionLine = `${indent(nestedIndent(spaces))}- ${optionType}: ${getDescription(option)}`;
      lines.push(optionLine);
      lines.push(...formatSchemaDetail(option, nestedIndent(spaces, 2)));
    }
    return lines;
  }
  return null;
};

const formatArrayDetails = (schema: Record<string, unknown>, spaces: number): string[] => {
  const lines = [`${indent(spaces)}Array details:`];
  const items = schema.items;

  if (Array.isArray(items)) {
    lines.push(`${indent(nestedIndent(spaces))}Allowed item types:`);
    items.forEach((item, idx) => {
      lines.push(`${indent(nestedIndent(spaces, 2))}${idx + 1}. ${summarizeSchemaType(item)}: ${getDescription(item)}`);
      lines.push(...formatSchemaDetail(item, nestedIndent(spaces, 3)));
    });
  } else if (items && typeof items === 'object') {
    lines.push(`${indent(nestedIndent(spaces))}Items type: ${summarizeSchemaType(items)}: ${getDescription(items)}`);
    lines.push(...formatSchemaDetail(items, nestedIndent(spaces, 2)));
  }

  const minItems = schema.minItems;
  if (typeof minItems === 'number') {
    lines.push(`${indent(nestedIndent(spaces))}Minimum items: ${minItems}`);
  }
  const maxItems = schema.maxItems;
  if (typeof maxItems === 'number') {
    lines.push(`${indent(nestedIndent(spaces))}Maximum items: ${maxItems}`);
  }
  return lines;
};

const formatObjectDetails = (schema: Record<string, unknown>, spaces: number): string[] => {
  const lines = [`${indent(spaces)}Object details:`];
  const properties = (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties))
    ? schema.properties as Record<string, unknown>
    : {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as unknown[]).map(String) : []);

  Object.entries(properties).forEach(([propName, propSchema], idx) => {
    const status = required.has(propName) ? 'required' : 'optional';
    const propType = summarizeSchemaType(propSchema);
    lines.push(`${indent(nestedIndent(spaces))}${idx + 1}. ${propName} (${propType}, ${status}): ${getDescription(propSchema)}`);
    lines.push(...formatSchemaDetail(propSchema, nestedIndent(spaces, 2)));
  });

  if ('additionalProperties' in schema) {
    const additionalProperties = schema.additionalProperties;
    if (additionalProperties === false) {
      lines.push(`${indent(nestedIndent(spaces))}Additional properties: Not allowed`);
    } else {
      const additionalType = summarizeSchemaType(additionalProperties);
      lines.push(`${indent(nestedIndent(spaces))}Additional properties: Allowed (type: ${additionalType})`);
      lines.push(...formatSchemaDetail(additionalProperties, nestedIndent(spaces, 2)));
    }
  }
  return lines;
};

const formatSchemaDetail = (schema: unknown, spaces: number): string[] => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const typedSchema = schema as Record<string, unknown>;

  const unionLines = formatUnionDetails(typedSchema, spaces);
  if (unionLines) return unionLines;

  const schemaType = typedSchema.type;
  if (Array.isArray(schemaType)) {
    const allowedTypes = schemaType.join(', ');
    return [`${indent(spaces)}Allowed types: ${allowedTypes}`];
  }
  if (schemaType === 'array') {
    return formatArrayDetails(typedSchema, spaces);
  }
  if (schemaType === 'object') {
    return formatObjectDetails(typedSchema, spaces);
  }
  return [];
};

export const convertToolsToDescription = (tools: LLMToolDefinition[]): string => {
  let description = '';
  tools.forEach((tool, index) => {
    if (tool.type !== 'function') return;
    const fn = tool.function;
    if (index > 0) description += '\n';
    description += `---- BEGIN FUNCTION #${index + 1}: ${fn.name} ----\n`;
    if ('description' in fn && fn.description) {
      description += `Description: ${fn.description}\n`;
    }

    const parameters = (fn as { parameters?: unknown }).parameters;
    if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
      const paramsSchema = parameters as { properties?: Record<string, unknown>; required?: string[] };
      const properties = paramsSchema.properties ?? {};
      const requiredParams = new Set(paramsSchema.required ?? []);
      description += 'Parameters:\n';
      Object.entries(properties).forEach(([paramName, paramInfo], propIndex) => {
        const isRequired = requiredParams.has(paramName);
        const paramStatus = isRequired ? 'required' : 'optional';
        const paramType = summarizeSchemaType(paramInfo);
        const desc = getDescription(paramInfo);
        description += `  (${propIndex + 1}) ${paramName} (${paramType}, ${paramStatus}): ${desc}\n`;
        const detailLines = formatSchemaDetail(paramInfo, 6);
        if (detailLines.length) {
          description += `${detailLines.join('\n')}\n`;
        }
      });
    } else {
      description += 'No parameters are required for this function.\n';
    }

    description += `---- END FUNCTION #${index + 1} ----\n`;
  });
  return description;
};

export const buildToolsPrompt = (tools: LLMToolDefinition[]): string =>
  systemMessageSuffixTemplate.replace('{description}', convertToolsToDescription(tools));

