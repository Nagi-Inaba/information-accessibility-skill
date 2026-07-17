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

const supportedTypes = new Set(["null", "array", "object", "integer", "number", "string", "boolean"]);

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

function isSchemaObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasJsonDuplicates(values) {
  return values.some((item, index) => values.slice(0, index).some((prior) => jsonEquals(prior, item)));
}

function inspectSchema(schema, location, errors, state) {
  const context = state ?? {
    rootSchema: schema,
    active: new Set(),
    visited: new Set()
  };
  if (typeof schema === "boolean") return;
  if (!isSchemaObject(schema)) {
    errors.push(`${location} must be a schema object or boolean`);
    return;
  }
  if (context.visited.has(schema)) return;
  context.active.add(schema);

  for (const keyword of Object.keys(schema)) {
    if (!supportedKeywords.has(keyword)) errors.push(`${location}.${keyword} is an unsupported schema keyword`);
  }

  for (const keyword of ["$schema", "$id", "title", "description", "format"]) {
    if (Object.hasOwn(schema, keyword) && typeof schema[keyword] !== "string") {
      errors.push(`${location}.${keyword} must be a string`);
    }
  }

  if (Object.hasOwn(schema, "$ref")) {
    if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) {
      errors.push(`${location} contains an unsupported external schema reference`);
    } else {
      const resolved = resolveLocalReference(context.rootSchema, schema.$ref);
      if (resolved === undefined) {
        errors.push(`${location} contains an unresolved local schema reference: ${schema.$ref}`);
      } else if (context.active.has(resolved)) {
        errors.push(`${location} contains a cyclic schema reference: ${schema.$ref}`);
      } else {
        inspectSchema(resolved, `${location}.$ref(${schema.$ref})`, errors, context);
      }
    }
  }

  if (Object.hasOwn(schema, "type")) {
    const declaredTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (declaredTypes.length === 0) errors.push(`${location}.type must contain at least one schema type`);
    if (declaredTypes.some((type) => typeof type !== "string" || !supportedTypes.has(type))) {
      errors.push(`${location}.type contains an invalid schema type`);
    }
    if (new Set(declaredTypes).size !== declaredTypes.length) errors.push(`${location}.type must contain unique schema types`);
  }

  if (Object.hasOwn(schema, "enum")) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      errors.push(`${location}.enum must be a non-empty array`);
    } else if (hasJsonDuplicates(schema.enum)) {
      errors.push(`${location}.enum must contain unique values`);
    }
  }

  if (Object.hasOwn(schema, "minLength") && (!Number.isInteger(schema.minLength) || schema.minLength < 0)) {
    errors.push(`${location}.minLength must be a non-negative integer`);
  }
  if (Object.hasOwn(schema, "pattern")) {
    if (typeof schema.pattern !== "string") {
      errors.push(`${location}.pattern must be a string`);
    } else {
      try {
        new RegExp(schema.pattern, "u");
      } catch (error) {
        errors.push(`${location}.pattern is an invalid regular expression: ${error.message}`);
      }
    }
  }

  for (const keyword of ["minimum", "maximum"]) {
    if (Object.hasOwn(schema, keyword) && (typeof schema[keyword] !== "number" || !Number.isFinite(schema[keyword]))) {
      errors.push(`${location}.${keyword} must be a finite number`);
    }
  }
  if (typeof schema.minimum === "number" && typeof schema.maximum === "number" && schema.minimum > schema.maximum) {
    errors.push(`${location}.minimum must not exceed maximum`);
  }

  for (const keyword of ["minItems", "maxItems"]) {
    if (Object.hasOwn(schema, keyword) && (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)) {
      errors.push(`${location}.${keyword} must be a non-negative integer`);
    }
  }
  if (Number.isInteger(schema.minItems) && Number.isInteger(schema.maxItems) && schema.minItems > schema.maxItems) {
    errors.push(`${location}.minItems must not exceed maxItems`);
  }
  if (Object.hasOwn(schema, "uniqueItems") && typeof schema.uniqueItems !== "boolean") {
    errors.push(`${location}.uniqueItems must be boolean`);
  }

  if (Object.hasOwn(schema, "required")) {
    if (!Array.isArray(schema.required)) {
      errors.push(`${location}.required must be an array`);
    } else {
      if (schema.required.some((item) => typeof item !== "string")) errors.push(`${location}.required must contain only strings`);
      if (new Set(schema.required).size !== schema.required.length) errors.push(`${location}.required must contain unique names`);
    }
  }

  if (Object.hasOwn(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") {
    errors.push(`${location}.additionalProperties must be boolean; schema-valued additionalProperties is unsupported`);
  }

  const propertiesAreObject = schema.properties === undefined
    || isSchemaObject(schema.properties);
  if (!propertiesAreObject) {
    errors.push(`${location}.properties must be an object`);
  } else {
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      inspectSchema(childSchema, `${location}.properties.${key}`, errors, context);
    }
  }
  const definitionsAreObject = schema.$defs === undefined
    || isSchemaObject(schema.$defs);
  if (!definitionsAreObject) {
    errors.push(`${location}.$defs must be an object`);
  } else {
    for (const [key, childSchema] of Object.entries(schema.$defs ?? {})) {
      inspectSchema(childSchema, `${location}.$defs.${key}`, errors, context);
    }
  }
  if (Object.hasOwn(schema, "items")) inspectSchema(schema.items, `${location}.items`, errors, context);
  if (Object.hasOwn(schema, "allOf") && !Array.isArray(schema.allOf)) {
    errors.push(`${location}.allOf must be an array`);
  } else if (Array.isArray(schema.allOf) && schema.allOf.length === 0) {
    errors.push(`${location}.allOf must be a non-empty array`);
  } else {
    for (const [index, childSchema] of (schema.allOf ?? []).entries()) {
      inspectSchema(childSchema, `${location}.allOf[${index}]`, errors, context);
    }
  }
  for (const keyword of ["if", "then", "else"]) {
    if (Object.hasOwn(schema, keyword)) inspectSchema(schema[keyword], `${location}.${keyword}`, errors, context);
  }
  if (!Object.hasOwn(schema, "if") && (Object.hasOwn(schema, "then") || Object.hasOwn(schema, "else"))) {
    errors.push(`${location}.then and else require if in the supported schema subset`);
  }
  if (Object.hasOwn(schema, "if") && !Object.hasOwn(schema, "then") && !Object.hasOwn(schema, "else")) {
    errors.push(`${location}.if requires then or else in the supported schema subset`);
  }

  context.active.delete(schema);
  context.visited.add(schema);
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
