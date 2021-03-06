(function (global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    var jsonlint = require('./jsonlint')
    var Ajv = require('ajv')
    // eslint-disable-next-line no-inner-declarations
    function requireSchemaDraft (environment) {
      return require('ajv/lib/refs/' + environment + '.json')
    }
    factory(exports, Ajv, jsonlint, requireSchemaDraft)
    // eslint-disable-next-line no-undef
  } else if (typeof define === 'function' && define.amd) {
    // eslint-disable-next-line no-undef
    define('jsonlint-validator', ['exports', 'ajv', 'jsonlint', 'jsonlint-schema-drafts'],
      function (exports, jsonlint, Ajv, schemaDrafts) {
        function requireSchemaDraft (environment) {
          return schemaDrafts[environment]
        }
        factory(exports, Ajv, jsonlint, requireSchemaDraft)
      })
  } else {
    // eslint-disable-next-line no-undef
    global = global || self
    var requireSchemaDraft = function (environment) {
      return global.jsonlintSchemaDrafts[environment]
    }
    factory(global.jsonlintValidator = {}, global.Ajv, global.jsonlint, requireSchemaDraft)
  }
}(this, function (exports, Ajv, jsonlint, requireSchemaDraft) {
  'use strict'

  function addErrorLocation (problem, input, tokens, dataPath) {
    var token = tokens.find(function (token) {
      return dataPath === jsonlint.pathToPointer(token.path)
    })
    if (token) {
      var location = token.location.start
      var offset = location.offset
      var line = location.line
      var column = location.column
      var texts = jsonlint.getErrorTexts(problem.reason, input, offset, line, column)
      problem.message = texts.message
      problem.excerpt = texts.excerpt
      if (texts.pointer) {
        problem.pointer = texts.pointer
        problem.location = {
          start: {
            column: column,
            line: line,
            offset: offset
          }
        }
      }
      return true
    }
  }

  function errorToProblem (error, input, tokens) {
    var dataPath = error.dataPath
    var schemaPath = error.schemaPath
    var reason = (dataPath || '/') + ' ' + error.message + '; see ' + schemaPath
    var problem = {
      reason: reason,
      dataPath: dataPath,
      schemaPath: schemaPath
    }
    if (!addErrorLocation(problem, input, tokens, dataPath)) {
      problem.message = reason
    }
    return problem
  }

  function createError (errors, data, input, options) {
    if (!input) {
      input = JSON.stringify(data, undefined, 2)
    }
    if (!options) {
      options = {}
    }
    Object.assign(options, {
      tokenLocations: true,
      tokenPaths: true
    })
    var tokens = jsonlint.tokenize(input, options)
    // var problems = errors.map(function (error) {
    //   return errorToProblem(error, input, tokens)
    // })
    // var message = problems
    //   .map(function (problem) {
    //     return problem.message
    //   })
    //   .join('\n')
    var problem = errorToProblem(errors[0], input, tokens)
    var error = new SyntaxError(problem.message)
    Object.assign(error, problem)
    return error
  }

  function createAjv (environment) {
    var ajvOptions = { jsonPointers: true }
    var ajv
    if (!environment) {
      ajvOptions.schemaId = 'auto'
      ajv = new Ajv(ajvOptions)
      ajv.addMetaSchema(requireSchemaDraft('json-schema-draft-04'))
      ajv.addMetaSchema(requireSchemaDraft('json-schema-draft-06'))
    } else if (environment === 'json-schema-draft-07') {
      ajv = new Ajv(ajvOptions)
    } else if (environment === 'json-schema-draft-06') {
      ajv = new Ajv(ajvOptions)
      ajv.addMetaSchema(requireSchemaDraft('json-schema-draft-06'))
    } else if (environment === 'json-schema-draft-04') {
      ajvOptions.schemaId = 'id'
      ajv = new Ajv(ajvOptions)
      ajv.addMetaSchema(requireSchemaDraft('json-schema-draft-04'))
    } else {
      throw new RangeError('Unsupported environment for the JSON schema validation: "' +
        environment + '".')
    }
    return ajv
  }

  function compileSchema (ajv, schema, parseOptions) {
    var parsed
    try {
      parsed = jsonlint.parse(schema, parseOptions)
    } catch (error) {
      error.message = 'Parsing the JSON schema failed.\n' + error.message
      throw error
    }
    try {
      return ajv.compile(parsed)
    } catch (originalError) {
      var errors = ajv.errors
      var betterError = errors
        ? createError(errors, parsed, schema, parseOptions)
        : originalError
      betterError.message = 'Compiling the JSON schema failed.\n' + betterError.message
      throw betterError
    }
  }

  function compile (schema, environment) {
    var options = {}
    if (typeof environment === 'object' && !(environment instanceof String)) {
      options = environment
      environment = options.environment
    }
    var ajv = createAjv(environment)
    var parseOptions = {
      mode: options.mode,
      ignoreComments: options.ignoreComments,
      ignoreTrailingCommas: options.ignoreTrailingCommas,
      allowSingleQuotedStrings: options.allowSingleQuotedStrings,
      allowDuplicateObjectKeys: options.allowDuplicateObjectKeys
    }
    var validate = compileSchema(ajv, schema, parseOptions)
    return function (data, input, options) {
      if (typeof data === 'string' || data instanceof String) {
        options = input
        input = data
        data = jsonlint.parse(input, options)
      } else if (!(typeof input === 'string' || input instanceof String)) {
        options = input
        input = undefined
      }
      if (validate(data)) {
        return data
      }
      throw createError(validate.errors, data, input, options)
    }
  }

  exports.compile = compile

  Object.defineProperty(exports, '__esModule', { value: true })
}))
