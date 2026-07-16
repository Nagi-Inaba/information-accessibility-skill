const supportedKeywords = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "minLength",
  "pattern",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "uniqueItems",
  "items",
  "properties",
  "required",
  "additionalProperties",
  "allOf",
  "if",
  "then",
  "else",
  // Existing assessment schemas use format as an annotation. Keeping it
  // non-asserting preserves their validation behavior; security contracts use
  // enforced patterns instead.
  "format"
]);

function matchesSchemaType(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === expected;
}

function jsonEquals(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => jsonEquals(item, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && jsonEquals(left[key], right[key]));
}

function inspectSchema(schema, location, errors, seen = new Set()) {
  if (typeof schema === "boolean") return;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push(`${location} must be a schema object or boolean`);
    return;
  }
  if (seen.has(schema)) return;
  seen.add(schema);

  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) errors.push(`${location}.${keyword} is an unsupported schema keyword`);
  }
  if (Object.hasOwn(schema, "$ref")) {
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) {
      errors.push(`${location} contains an unsupported external schema reference`);
    }
  }
  if (Object.hasOwn(schema, "pattern")) {
    try {
      new RegExp(schema.pattern, "u");
    } catch (error) {
      errors.push(`${location}.pattern is an invalid regular expression: ${error.message}`);
    }
  }

  const propertiesAreObject = schema.properties === undefined
    || (schema.properties !== null && typeof schema.properties === "object" && !Array.isArray(schema.properties));
  if (!propertiesAreObject) {
    errors.push(`${location}.properties must be an object`);
  } else {
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      inspectSchema(childSchema, `${location}.properties.${key}`, errors, seen);
    }
  }
  const definitionsAreObject = schema.$defs === undefined
    || (schema.$defs !== null && typeof schema.$defs === "object" && !Array.isArray(schema.$defs));
  if (!definitionsAreObject) {
    errors.push(`${location}.$defs must be an object`);
  } else {
    for (const [key, childSchema] of Object.entries(schema.$defs ?? {})) {
      inspectSchema(childSchema, `${location}.$defs.${key}`, errors, seen);
    }
  }
  if (Object.hasOwn(schema, "items")) inspectSchema(schema.items, `${location}.items`, errors, seen);
  if (schema.allOf !== undefined && !Array.isArray(schema.allOf)) {
    errors.push(`${location}.allOf must be an array`);
  } else {
    for (const [index, childSchema] of (schema.allOf ?? []).entries()) {
      inspectSchema(childSchema, `${location}.allOf[${index}]`, errors, seen);
    }
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) errors.push(`${location}.required must be an array`);
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) errors.push(`${location}.enum must be an array`);
  for (const keyword of ["if", "then", "else"]) {
    if (Object.hasOwn(schema, keyword)) inspectSchema(schema[keyword], `${location}.${keyword}`, errors, seen);
  }
}

function resolveLocalReference(rootSchema, reference) {
  const parts = reference.slice(2).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let resolved = rootSchema;
  for (const part of parts) {
    if (resolved === null || typeof resolved !== "object" || !Object.hasOwn(resolved, part)) return undefined;
    resolved = resolved[part];
  }
  return resolved;
}

function validateNode(value, schema, location, errors, rootSchema, referenceStack = []) {
  if (schema === true) return errors;
  if (schema === false) {
    errors.push(`${location} is rejected by schema`);
    return errors;
  }

  if (Object.hasOwn(schema, "$ref")) {
    const reference = schema.$ref;
    if (referenceStack.includes(reference)) {
      errors.push(`${location} contains a cyclic schema reference: ${reference}`);
      return errors;
    }
    const resolved = resolveLocalReference(rootSchema, reference);
    if (resolved === undefined) {
      errors.push(`${location} contains an unresolved local schema reference: ${reference}`);
      return errors;
    }
    validateNode(value, resolved, location, errors, rootSchema, [...referenceStack, reference]);
  }

  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (expectedTypes.length && !expectedTypes.some((type) => matchesSchemaType(value, type))) {
    errors.push(`${location} must have type ${expectedTypes.join(" or ")}`);
    return errors;
  }
  if (Object.hasOwn(schema, "const") && !jsonEquals(value, schema.const)) {
    errors.push(`${location} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((item) => jsonEquals(value, item))) {
    errors.push(`${location} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) errors.push(`${location} must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${location} must match pattern ${schema.pattern}`);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Object.hasOwn(schema, "minimum") && value < schema.minimum) errors.push(`${location} must be at least ${schema.minimum}`);
    if (Object.hasOwn(schema, "maximum") && value > schema.maximum) errors.push(`${location} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (Object.hasOwn(schema, "minItems") && value.length < schema.minItems) errors.push(`${location} must contain at least ${schema.minItems} items`);
    if (Object.hasOwn(schema, "maxItems") && value.length > schema.maxItems) errors.push(`${location} must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems === true && value.some((item, index) => value.slice(0, index).some((prior) => jsonEquals(prior, item)))) {
      errors.push(`${location} must contain unique items`);
    }
    if (Object.hasOwn(schema, "items")) {
      value.forEach((item, index) => validateNode(item, schema.items, `${location}[${index}]`, errors, rootSchema, referenceStack));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required by schema`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${location}.${key} is not allowed by schema`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateNode(value[key], childSchema, `${location}.${key}`, errors, rootSchema, referenceStack);
    }
  }
  for (const childSchema of schema.allOf ?? []) validateNode(value, childSchema, location, errors, rootSchema, referenceStack);
  if (Object.hasOwn(schema, "if")) {
    const conditionErrors = [];
    validateNode(value, schema.if, location, conditionErrors, rootSchema, referenceStack);
    if (conditionErrors.length === 0 && Object.hasOwn(schema, "then")) validateNode(value, schema.then, location, errors, rootSchema, referenceStack);
    if (conditionErrors.length > 0 && Object.hasOwn(schema, "else")) validateNode(value, schema.else, location, errors, rootSchema, referenceStack);
  }
  return errors;
}

export function validateJsonSchema(value, schema, location = "$", errors = []) {
  const schemaErrorStart = errors.length;
  inspectSchema(schema, "$schema", errors);
  if (errors.length > schemaErrorStart) return errors;
  return validateNode(value, schema, location, errors, schema);
}
