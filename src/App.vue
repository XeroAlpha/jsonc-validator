<template>
  <div class="container">
    <div class="load-schema-button" @click="showLoadSchemaDialog">
      {{ t('loadSchema.button') }}
    </div>
    <div class="preview no-problem" v-if="state.input.length === 0">
      {{ t('checkResult.needInput') }}
    </div>
    <ul
      class="preview"
      v-else-if="state.problems.length > 0"
    >
      <span>{{ t('checkResult.haveProblem') }}</span>
      <li
        class="problem"
        v-for="(problem, index) in state.problems"
        :key="index"
        @click="setSelection(problem)"
      >
        <span class="problem-location">{{ problem.location[0] + 1 }}:{{ problem.location[1] + 1 }}</span>
        <code class="problem-code" v-if="problem.code !== ''">{{ problem.code }}</code>
        <span class="problem-text">{{ t(problem.message, problem.params) }}</span>
        <span class="problem-cause" v-if="problem.cause">({{ problem.cause }})</span>
      </li>
    </ul>
    <div class="preview no-problem" v-else-if="schema.state === 'loading'">
      {{ t('checkResult.noProblemSchemaLoading') }}
    </div>
    <div class="preview no-problem" v-else>
      {{ t('checkResult.noProblem') }}
    </div>
    <div class="code-box">
      <div ref="highlight" class="code-backdrop" v-html="state.highlight"></div>
      <div class="code-wrap">
        <textarea
          ref="textarea"
          class="code-input"
          v-model="state.input"
          :placeholder="t('codeArea.placeHolder')"
          @scroll.passive="syncScroll()"
        ></textarea>
      </div>
    </div>
  </div>  
</template>

<script setup>
import { reactive, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { findNodeAtLocation, getNodeValue, ParseErrorCode, parseTree } from 'jsonc-parser';
import { JsonPointer } from 'json-ptr';
import Ajv from 'ajv';

const { t } = useI18n();
const state = reactive({ input: '', problems: [], highlight: '' });
const textarea = ref();
const highlight = ref();
const schema = reactive({ state: 'none', error: null, validate: null });

const defaultSchemaBase = new URL('./schemas/', location.href);
const query = new URLSearchParams(location.search);
const schemaPath = query.has('schema') ? new URL(query.get('schema'), defaultSchemaBase) : null;

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  // messages: false,
  strictSchema: false,
  unicodeRegExp: false,
  async loadSchema(uri) {
    const res = await fetch(new URL(uri, schemaPath));
    return await res.json();
  }
});

if (schemaPath) {
  schema.state = 'loading';
  fetch(schemaPath)
    .then((res) => res.json())
    .then((schema) => ajv.validateSchema(schema) && ajv.compileAsync(schema))
    .then((validate) => {
      schema.validate = validate;
      schema.state = 'ready';
    }, (error) => {
      schema.error = error;
      schema.state = 'error';
    });
}

function showLoadSchemaDialog() {
  const url = prompt(t('loadSchema.prompt'), schemaPath ? schemaPath.toString() : '');
  if (!url) return;
  location.search = `?schema=${encodeURIComponent(url)}`;
}

state.input = localStorage.getItem('jsoncheck-code') || '';
watch(() => state.input, (v) => {
  localStorage.setItem('jsoncheck-code', v);
});

function setSelection(problem) {
  const box = textarea.value;
  const anchor = document.getElementById(`anchor-${problem.offset}-${problem.length}`);
  box.focus();
  box.scrollTo({
    top: anchor.offsetTop - (box.clientHeight - anchor.offsetHeight) / 2,
    left: anchor.offsetLeft - (box.clientWidth - anchor.offsetWidth) / 2 
  });
  box.setSelectionRange(problem.offset, problem.offset + problem.length);
}

function syncScroll() {
  const box = textarea.value;
  highlight.value.scroll({
    top: box.scrollTop,
    left: box.scrollLeft
  });
}

function offsetToLnCol(text, offset) {
  const lineBreakRegex = /\r\n|\r|\n/g;
  let lineCount = 0;
  let lineStart = 0;
  let execResult;
  while ((execResult = lineBreakRegex.exec(text)) !== null) {
    if (execResult.index > offset) {
      break;
    }
    lineCount += 1;
    lineStart = execResult.index + execResult[0].length;
  }
  return [lineCount, offset - lineStart];
}

function isLiteralNodeType(node) {
  return node && node.type !== "object" && node.type !== "array";
}

function reportError(problems, input, message, params, cause, nodeOrRange, options) {
  let offset = 0;
  let length = 0;
  let skipCode = false;
  if (Array.isArray(nodeOrRange)) {
    [offset, length] = nodeOrRange;
    skipCode = length > 50;
  } else if (typeof nodeOrRange === 'object') {
    ({ offset, length } = nodeOrRange);
    skipCode = length > 50 || !isLiteralNodeType(nodeOrRange);
  }
  if (options && options.skipCode) skipCode = true;
  problems.push({
    message,
    params,
    cause,
    code: skipCode ? '' : input.slice(offset, offset + length),
    offset, length,
    location: offsetToLnCol(input, offset),
    skipHighlight: options && options.skipHighlight
  });
}

function checkObjectNode(node, reportError) {
  if (!node) return;
  if (Array.isArray(node.children)) {
    if (node.type === 'object') {
      const propertyNames = [];
      for (const property of node.children) {
        const [keyNode, valueNode] = property.children;
        const propertyName = keyNode.value;
        if (propertyNames.includes(propertyName)) {
          reportError('errorMessage.misc.DuplicateObjectKey', null, null, keyNode);
        } else {
          propertyNames.push(propertyName);
        }
        checkObjectNode(valueNode, reportError);
      }
    } else if (node.type === 'array') {
      for (const child of node.children) {
        checkObjectNode(child, reportError);
      }
    }
  }
}

const HTMLEscapeChars = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;'
};

function findNodeByJSONPointer(root, pointer) {
  const resolved = JsonPointer.decode(pointer);
  let current = root;
  while (resolved.length) {
    let segment = resolved.shift();
    if (current.type === 'array') {
      segment = Number(segment);
    }
    current = findNodeAtLocation(current, [segment]);
    if (!current) {
      return undefined;
    }
  }
  return current;
}

function locatePropertyKeyNode(objectNode, propertyName) {
  return findNodeAtLocation(objectNode, [propertyName]).parent.children[0];
}

function translateValidateError(error, root) {
  const { keyword, schemaPath, instancePath } = error;
  let node = findNodeByJSONPointer(root, instancePath);
  let range = null;
  let message = `errorMessage.validateError.${keyword}`;
  const params = { ...error.params };
  switch (keyword) {
    case 'type':
      message = `${message}.${params.type}`;
      break;
    case 'contains':
      if ("maxContains" in params) {
        message = `${message}.range`;
      } else {
        message = `${message}.minimum`;
      }
      break;
    case 'discriminator':
      message = `${message}.${params.error}`;
      break;
    case 'additionalItems':
    case 'items':
    case 'unevaluatedItems':
      node = findNodeAtLocation(node, [params.limit]);
      break;
    case 'uniqueItems':
      node = findNodeAtLocation(node, [params.j]);
      break;
    case 'additionalProperties':
      node = findNodeAtLocation(node, [params.additionalProperty]);
      break;
    case 'unevaluatedProperties':
      node = findNodeAtLocation(node, [params.unevaluatedProperty]);
      break;
    case 'dependencies':
    case 'dependentRequired':
      node = findNodeAtLocation(node, [params.property]);
      break;
    case 'propertyNames':
      node = locatePropertyKeyNode(node, params.propertyName);
      break;
    case 'required':
      range = [node.offset + node.length - 1, 1];
      node = null;
      break;
  }
  return { message, params, cause: schemaPath, node, range };
}

watchEffect(() => {
  const { input } = state;
  if (input !== '') {
    const problems = [];
    const parsedErrors = [];

    const pushProblems = reportError.bind(null, problems, input);
    const root = parseTree(input, parsedErrors);
    parsedErrors.forEach(({ error, offset, length }) => {
      const errorId = ParseErrorCode[error] || 'UnknownParseError';
      pushProblems(`errorMessage.parseError.${errorId}`, null, null, [offset, length]);
    });

    checkObjectNode(root, pushProblems);

    if (schema.state === 'ready') {
      const instance = getNodeValue(root);
      const valid = schema.validate(instance);
      if (!valid) {
        const errors = [];
        schema.validate.errors.forEach((error) => {
          error.skipHighlight = errors.some((e) => e.instancePath.startsWith(error.instancePath));
          errors.push(error);
        });
        schema.validate.errors.forEach((error) => {
          const translated = translateValidateError(error, root);
          pushProblems(
            translated.message,
            translated.params,
            translated.cause,
            translated.node || translated.range,
            error.skipHighlight
          );
        });
      }
    } else if (schema.state === 'error') {
      pushProblems('errorMessage.misc.InvalidSchema', null, schema.error);
    } else if (isLiteralNodeType(root)) {
      pushProblems('errorMessage.misc.InvalidRootElement', null, null, root);
    }

    problems.sort((a, b) => {
      if (a.offset === b.offset) {
        return a.length - b.length;
      } else {
        return a.offset - b.offset;
      }
    })
    state.problems = problems;
  } else {
    state.problems = [];
  }

  const highlightHtml = input.split('').map((ch) => HTMLEscapeChars[ch] || ch);
  const anchors = [];
  state.problems.forEach((problem) => {
    const { offset, length } = problem;
    const id = `anchor-${offset}-${length}`;
    const highlight = !problem.skipHighlight;
    const found = anchors.find((e) => e.id === id);
    if (found && !found.highlight) {
      found.highlight = highlight;
    }
    if (!found) {
      anchors.push({ id, offset, length, highlight });
    }
  });
  anchors.reverse().forEach((anchor) => {
    const { id, offset, length, highlight } = anchor;
    highlightHtml.splice(offset + length, 0, '</span>');
    if (highlight) {
      highlightHtml.splice(offset, 0, `<span id="${id}" class="code-highlight">`);
    } else {
      highlightHtml.splice(offset, 0, `<span id="${id}">`);
    }
  });
  state.highlight = highlightHtml.join('');
});

document.title = t('title');
window.ajv = ajv;
</script>

<style>
body {
  margin: 0px;
  padding: 0px;
  overflow-y: hidden;
  background-color: white;
  color: black;
}
.container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: calc(100vh - 32px);
  padding: 0px 16px 16px 16px;
  font-family: sans-serif;
  font-size: 16px;
  line-height: 24px;
}
.code-box {
  flex: 1;
  position: relative;
}
.code-backdrop {
  position: absolute;
  left: 0px;
  top: 0px;
  right: 0px;
  bottom: 0px;
  padding: 16px 16px 128px 16px;
  border: 1px solid transparent;
  color: transparent;
  white-space: pre;
  overflow: scroll;
  font-family: monospace;
}
.code-wrap {
  position: absolute;
  left: 0px;
  top: 0px;
  right: 0px;
  bottom: 0px;
  margin: 0px;
}
.code-input {
  width: calc(100% - 32px);
  height: calc(100% - 32px);
  padding: 16px;
  background-color: transparent;
  font-size: inherit;
  line-height: inherit;
  font-family: 'Droid Sans Mono', monospace;
  border: 1px solid gray;
  border-radius: 5px;
  white-space: pre;
  overflow: scroll;
  resize: none;
}
.code-highlight {
  text-decoration: red wavy underline; 
}
.preview {
  overflow-y: auto;
  max-height: 50vh;
}
.problem {
  cursor: pointer;
  user-select: none;
  margin-top: 8px;
}
.problem-location {
  padding: 0px 8px 0px 2px;
}
.problem-code {
  padding: 0px 4px 0px 4px;
  margin: 0px 8px 0px 2px;
  border: 1px solid black;
  font-family: monospace;
  white-space: pre-wrap;
  line-break: anywhere;
}
.problem-cause {
  margin-left: 4px;
}
.no-problem {
  text-align: center;
  padding: 16px 16px 20px 16px;
  font-weight: 700;
}
.load-schema-button {
  position: absolute;
  right: 16px;
  top: calc(1em - 5px);
  border: 1px solid black;
  padding: 5px;
  user-select: none;
  background-color: white;
  z-index: 100;
}
@media (max-width: 480px) {
  .load-schema-button {
    display: none;
  }
}
.load-schema-button:active {
  background-color: black;
  color: white;
}
</style>
