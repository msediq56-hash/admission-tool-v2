// Recursive condition evaluator for the admission eligibility rule engine.
// Supports all 5 condition types: comparison, composite, lookup, conditional, any_of/all_of.

/**
 * Resolve a dot-path field on an object.
 * Returns { value, exists } where exists is false if any segment is missing.
 */
export function resolveField(obj, dotPath) {
  if (!dotPath || dotPath === '') {
    return { value: obj, exists: obj !== undefined && obj !== null };
  }
  const segments = dotPath.split('.');
  let current = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return { value: undefined, exists: false };
    }
    if (typeof current !== 'object') {
      return { value: undefined, exists: false };
    }
    if (!(seg in current)) {
      return { value: undefined, exists: false };
    }
    current = current[seg];
  }
  return { value: current, exists: current !== undefined };
}

/**
 * Check if an array element matches a filter object.
 * All key-value pairs in the filter must match the element.
 */
function matchesFilter(element, filter) {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    const { value, exists } = resolveField(element, key);
    if (!exists || value !== expected) return false;
  }
  return true;
}

/**
 * Apply a comparison operator.
 */
function applyOperator(operator, fieldValue, conditionValue, fieldExists) {
  switch (operator) {
    case 'eq':
      return fieldValue === conditionValue;
    case 'neq':
      return fieldValue !== conditionValue;
    case 'in':
      return Array.isArray(conditionValue) && conditionValue.includes(fieldValue);
    case 'not_in':
      return Array.isArray(conditionValue) && !conditionValue.includes(fieldValue);
    case 'gte':
      return typeof fieldValue === 'number' && fieldValue >= conditionValue;
    case 'lte':
      return typeof fieldValue === 'number' && fieldValue <= conditionValue;
    case 'gt':
      return typeof fieldValue === 'number' && fieldValue > conditionValue;
    case 'lt':
      return typeof fieldValue === 'number' && fieldValue < conditionValue;
    case 'exists':
      return fieldExists && fieldValue !== null && fieldValue !== undefined;
    case 'not_exists':
      return !fieldExists || fieldValue === null || fieldValue === undefined;
    case 'contains':
      return Array.isArray(fieldValue) && fieldValue.includes(conditionValue);
    case 'contains_any':
      return Array.isArray(fieldValue) && Array.isArray(conditionValue) &&
        conditionValue.some(v => fieldValue.includes(v));
    case 'matches_regex':
      return typeof fieldValue === 'string' && new RegExp(conditionValue).test(fieldValue);
    default:
      return false;
  }
}

/**
 * Evaluate a condition node recursively.
 *
 * @param {object} condition - The condition node from the rule set
 * @param {object} data - The data object to evaluate against (full profile or array element)
 * @param {object} ctx - Evaluation context: { profile, referenceTables, evaluationDate, dataSources }
 * @returns {{ passed: boolean, trace: object }}
 */
export function evaluateCondition(condition, data, ctx) {
  switch (condition.type) {
    case 'comparison':
      return evalComparison(condition, data, ctx);
    case 'composite':
      return evalComposite(condition, data, ctx);
    case 'lookup':
      return evalLookup(condition, data, ctx);
    case 'conditional':
      return evalConditional(condition, data, ctx);
    case 'any_of':
    case 'all_of':
      return evalQuantifier(condition, data, ctx);
    default:
      return {
        passed: false,
        trace: { conditionType: condition.type, result: 'error', detail: `Unknown condition type: ${condition.type}` }
      };
  }
}

function evalComparison(condition, data, ctx) {
  const { field, operator, value } = condition;
  const resolved = resolveField(data, field);

  // Track data source
  if (ctx.dataSources && field) {
    ctx.dataSources.add(field);
  }

  const passed = applyOperator(operator, resolved.value, value, resolved.exists);

  return {
    passed,
    trace: {
      conditionType: 'comparison',
      result: passed ? 'passed' : 'failed',
      detail: `${field} ${operator} ${JSON.stringify(value)} → actual: ${JSON.stringify(resolved.value)}`
    }
  };
}

function evalComposite(condition, data, ctx) {
  const { operator, conditions } = condition;
  const subResults = [];

  if (operator === 'and') {
    let allPassed = true;
    for (const sub of conditions) {
      const result = evaluateCondition(sub, data, ctx);
      subResults.push(result.trace);
      if (!result.passed) {
        allPassed = false;
        break; // short-circuit
      }
    }
    return {
      passed: allPassed,
      trace: { conditionType: 'composite', result: allPassed ? 'passed' : 'failed', detail: `AND (${conditions.length} conditions)`, subResults }
    };
  }

  if (operator === 'or') {
    let anyPassed = false;
    for (const sub of conditions) {
      const result = evaluateCondition(sub, data, ctx);
      subResults.push(result.trace);
      if (result.passed) {
        anyPassed = true;
        break; // short-circuit
      }
    }
    return {
      passed: anyPassed,
      trace: { conditionType: 'composite', result: anyPassed ? 'passed' : 'failed', detail: `OR (${conditions.length} conditions)`, subResults }
    };
  }

  if (operator === 'not') {
    const result = evaluateCondition(conditions[0], data, ctx);
    subResults.push(result.trace);
    const passed = !result.passed;
    return {
      passed,
      trace: { conditionType: 'composite', result: passed ? 'passed' : 'failed', detail: 'NOT', subResults }
    };
  }

  return {
    passed: false,
    trace: { conditionType: 'composite', result: 'error', detail: `Unknown composite operator: ${operator}` }
  };
}

function evalLookup(condition, data, ctx) {
  const { table, lookup_key_field, result_field, expected_values } = condition;
  const keyResolved = resolveField(data, lookup_key_field);

  if (ctx.dataSources && lookup_key_field) {
    ctx.dataSources.add(lookup_key_field);
  }

  if (!keyResolved.exists) {
    return {
      passed: false,
      trace: { conditionType: 'lookup', result: 'failed', detail: `Field ${lookup_key_field} not found` }
    };
  }

  const tableData = ctx.referenceTables[table];
  if (!tableData) {
    return {
      passed: false,
      trace: { conditionType: 'lookup', result: 'error', detail: `Reference table '${table}' not found` }
    };
  }

  const keyValue = keyResolved.value;
  const entry = tableData[keyValue];

  if (expected_values === null || expected_values === undefined) {
    // Pass if key exists in table
    const passed = entry !== undefined;
    return {
      passed,
      trace: { conditionType: 'lookup', result: passed ? 'passed' : 'failed', detail: `Key '${keyValue}' ${passed ? 'found' : 'not found'} in table '${table}'` }
    };
  }

  // Check if the result field value is in expected values
  const resultValue = result_field ? resolveField(entry, result_field)?.value : entry;
  const passed = Array.isArray(expected_values) && expected_values.includes(resultValue);
  return {
    passed,
    trace: { conditionType: 'lookup', result: passed ? 'passed' : 'failed', detail: `Lookup ${table}[${keyValue}].${result_field || ''} = ${JSON.stringify(resultValue)}` }
  };
}

function evalConditional(condition, data, ctx) {
  const ifResult = evaluateCondition(condition.if, data, ctx);
  const subResults = [{ branch: 'if', ...ifResult.trace }];

  if (ifResult.passed) {
    const thenResult = evaluateCondition(condition.then, data, ctx);
    subResults.push({ branch: 'then', ...thenResult.trace });
    return {
      passed: thenResult.passed,
      trace: { conditionType: 'conditional', result: thenResult.passed ? 'passed' : 'failed', detail: 'IF true → evaluated THEN', subResults }
    };
  }

  // IF failed
  if (condition.else) {
    const elseResult = evaluateCondition(condition.else, data, ctx);
    subResults.push({ branch: 'else', ...elseResult.trace });
    return {
      passed: elseResult.passed,
      trace: { conditionType: 'conditional', result: elseResult.passed ? 'passed' : 'failed', detail: 'IF false → evaluated ELSE', subResults }
    };
  }

  // No else branch — pass (branch not applicable)
  return {
    passed: true,
    trace: { conditionType: 'conditional', result: 'passed', detail: 'IF false, no ELSE → pass (branch not applicable)', subResults }
  };
}

function evalQuantifier(condition, data, ctx) {
  const { type, array_field, filter, condition: innerCondition } = condition;
  const isAnyOf = type === 'any_of';

  const arrayResolved = resolveField(data, array_field);
  if (ctx.dataSources && array_field) {
    ctx.dataSources.add(array_field);
  }

  if (!arrayResolved.exists || !Array.isArray(arrayResolved.value)) {
    return {
      passed: !isAnyOf, // any_of fails on empty, all_of passes (vacuous truth)
      trace: {
        conditionType: type, result: isAnyOf ? 'failed' : 'passed',
        detail: `Array field '${array_field}' not found or not an array`
      }
    };
  }

  const arr = arrayResolved.value;
  const matchingElements = filter ? arr.filter(el => matchesFilter(el, filter)) : arr;
  const elementResults = [];

  if (matchingElements.length === 0) {
    return {
      passed: !isAnyOf,
      trace: {
        conditionType: type, result: isAnyOf ? 'failed' : 'passed',
        detail: `No elements matched filter ${JSON.stringify(filter)} in '${array_field}' (${arr.length} total)`,
        subResults: []
      }
    };
  }

  if (isAnyOf) {
    let anyPassed = false;
    for (const element of matchingElements) {
      const result = evaluateCondition(innerCondition, element, ctx);
      elementResults.push(result.trace);
      if (result.passed) {
        anyPassed = true;
        break;
      }
    }
    return {
      passed: anyPassed,
      trace: {
        conditionType: 'any_of', result: anyPassed ? 'passed' : 'failed',
        detail: `any_of ${array_field}: ${anyPassed ? 'found match' : 'no match'} (${matchingElements.length} elements checked)`,
        subResults: elementResults
      }
    };
  }

  // all_of
  let allPassed = true;
  for (const element of matchingElements) {
    const result = evaluateCondition(innerCondition, element, ctx);
    elementResults.push(result.trace);
    if (!result.passed) {
      allPassed = false;
      break;
    }
  }
  return {
    passed: allPassed,
    trace: {
      conditionType: 'all_of', result: allPassed ? 'passed' : 'failed',
      detail: `all_of ${array_field}: ${allPassed ? 'all passed' : 'not all passed'} (${matchingElements.length} elements checked)`,
      subResults: elementResults
    }
  };
}
