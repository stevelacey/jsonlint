/* globals Uni, getTexts */

// Modified from https://github.com/rlidwka/jju/blob/master/lib/parse.js

function isHexDigit (x) {
  return (x >= '0' && x <= '9') ||
      (x >= 'A' && x <= 'F') ||
      (x >= 'a' && x <= 'f')
}

function isOctDigit (x) {
  return x >= '0' && x <= '7'
}

function isDecDigit (x) {
  return x >= '0' && x <= '9'
}

var unescapeMap = {
  '\'': '\'',
  '"': '"',
  '\\': '\\',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '/': '/'
}

function parseInternal (input, options) {
  if (typeof input !== 'string' || !(input instanceof String)) {
    input = String(input)
  }

  var json5 = options.mode === 'json5'
  var ignoreComments = options.ignoreComments || options.mode === 'cjson' || json5
  var ignoreTrailingCommas = options.ignoreTrailingCommas || json5
  var allowSingleQuotedStrings = options.allowSingleQuotedStrings || json5
  var allowDuplicateObjectKeys = options.allowDuplicateObjectKeys
  var reviver = options.reviver
  var tokenize = options.tokenize
  var rawTokens = options.rawTokens
  var tokenLocations = options.tokenLocations
  var tokenPaths = options.tokenPaths

  var isLineTerminator = json5 ? Uni.isLineTerminator : Uni.isLineTerminatorJSON
  var isWhiteSpace = json5 ? Uni.isWhiteSpace : Uni.isWhiteSpaceJSON

  var inputLength = input.length
  var lineNumber = 0
  var lineStart = 0
  var position = 0

  var startToken
  var endToken
  var tokenPath

  if (tokenize) {
    var tokens = []
    var tokenOffset = null
    var tokenLine
    var tokenColumn
    startToken = function () {
      if (tokenOffset !== null) throw Error('internal error, token overlap')
      tokenLine = lineNumber + 1
      tokenColumn = position - lineStart + 1
      tokenOffset = position
    }
    endToken = function (type, value) {
      if (tokenOffset !== position) {
        var token = { type: type }
        if (rawTokens) {
          token.raw = input.substr(tokenOffset, position - tokenOffset)
        }
        if (value !== undefined) {
          token.value = value
        }
        if (tokenLocations) {
          token.location = {
            start: {
              column: tokenColumn,
              line: tokenLine,
              offset: tokenOffset
            }
          }
        }
        if (tokenPaths) {
          token.path = tokenPath.slice()
        }
        tokens.push(token)
      }
      tokenOffset = null
      return value
    }
    tokenPaths && (tokenPath = [])
  }

  function generateMessage () {
    var message
    if (position < inputLength) {
      var token = JSON.stringify(input[position])
      message = 'Unexpected token ' + token
    } else {
      message = 'Unexpected end of input'
    }
    return message
  }

  function createError (message) {
    var column = position - lineStart + 1
    ++lineNumber
    var texts = getTexts(message, input, position, lineNumber, column)
    var error = SyntaxError(texts.message)
    error.reason = message
    error.excerpt = texts.excerpt
    error.pointer = texts.pointer
    error.location = {
      start: {
        column: column,
        line: lineNumber,
        offset: position
      }
    }
    return error
  }

  function fail (message) {
    if (!message) {
      message = generateMessage()
    }
    var error = createError(message)
    throw error
  }

  function newLine (char) {
    // account for <cr><lf>
    if (char === '\r' && input[position] === '\n') {
      ++position
    }
    lineStart = position
    ++lineNumber
  }

  function parseGeneric () {
    while (position < inputLength) {
      startToken && startToken()
      var char = input[position++]
      if (char === '"' || (char === '\'' && allowSingleQuotedStrings)) {
        var string = parseString(char)
        endToken && endToken('literal', string)
        return string
      } else if (char === '{') {
        endToken && endToken('symbol', '{')
        return parseObject()
      } else if (char === '[') {
        endToken && endToken('symbol', '[')
        return parseArray()
      } else if (char === '-' || char === '.' || isDecDigit(char) ||
                 (json5 && (char === '+' || char === 'I' || char === 'N'))) {
        var number = parseNumber()
        endToken && endToken('literal', number)
        return number
      } else if (char === 'n') {
        parseKeyword('null')
        endToken && endToken('literal', null)
        return null
      } else if (char === 't') {
        parseKeyword('true')
        endToken && endToken('literal', true)
        return true
      } else if (char === 'f') {
        parseKeyword('false')
        endToken && endToken('literal', false)
        return false
      } else {
        --position
        endToken && endToken()
        return undefined
      }
    }
  }

  function parseKey () {
    var result
    while (position < inputLength) {
      startToken && startToken()
      var char = input[position++]
      if (char === '"' || (char === '\'' && allowSingleQuotedStrings)) {
        var string = parseString(char)
        endToken && endToken('literal', string)
        return string
      } else if (char === '{') {
        endToken && endToken('symbol', '{')
        return parseObject()
      } else if (char === '[') {
        endToken && endToken('symbol', '[')
        return parseArray()
      } else if (char === '.' || isDecDigit(char)) {
        var number = parseNumber(true)
        endToken && endToken('literal', number)
        return number
      } else if ((json5 && Uni.isIdentifierStart(char)) ||
                 (char === '\\' && input[position] === 'u')) {
        var rollback = position - 1
        result = parseIdentifier()
        if (result === undefined) {
          position = rollback
          endToken && endToken()
          return undefined
        } else {
          endToken && endToken('literal', result)
          return result
        }
      } else {
        --position
        endToken && endToken()
        return undefined
      }
    }
  }

  function skipWhiteSpace () {
    var insideWhiteSpace
    function startWhiteSpace () {
      if (!insideWhiteSpace) {
        insideWhiteSpace = true
        --position
        startToken()
        ++position
      }
    }
    function endWhiteSpace () {
      if (insideWhiteSpace) {
        insideWhiteSpace = false
        endToken('whitespace')
      }
    }
    while (position < inputLength) {
      var char = input[position++]
      if (isLineTerminator(char)) {
        startToken && startWhiteSpace()
        newLine(char)
      } else if (isWhiteSpace(char)) {
        startToken && startWhiteSpace()
      } else if (char === '/' && ignoreComments &&
                 (input[position] === '/' || input[position] === '*')) {
        if (startToken) {
          --position
          endWhiteSpace()
          startToken()
          ++position
        }
        skipComment(input[position++] === '*')
        endToken && endToken('comment')
      } else {
        --position
        break
      }
    }
    endToken && endWhiteSpace()
  }

  function skipComment (multiLine) {
    while (position < inputLength) {
      var char = input[position++]
      if (isLineTerminator(char)) {
        if (!multiLine) {
          // let parent function deal with newline
          --position
          return
        }
        newLine(char)
      } else if (char === '*' && multiLine) {
        if (input[position] === '/') {
          ++position
          return
        }
      } else {
        // nothing
      }
    }
    if (multiLine) {
      fail('Unclosed multiline comment')
    }
  }

  function parseKeyword (keyword) {
    // keyword[0] is not checked because it was checked earlier
    var startPosition = position
    for (var i = 1, keywordLength = keyword.length; i < keywordLength; ++i) {
      if (position >= inputLength || keyword[i] !== input[position]) {
        position = startPosition - 1
        fail()
      }
      ++position
    }
  }

  function parseObject () {
    var result = {}
    var emptyObject = {}
    var isNotEmpty = false

    while (position < inputLength) {
      skipWhiteSpace()
      var key = parseKey()
      if (allowDuplicateObjectKeys === false && result[key]) {
        fail('Duplicate key: "' + key + '"')
      }
      skipWhiteSpace()
      startToken && startToken()
      var char = input[position++]
      endToken && endToken('symbol', char)
      if (char === '}' && key === undefined) {
        if (!ignoreTrailingCommas && isNotEmpty) {
          --position
          fail('Trailing comma in object')
        }
        return result
      } else if (char === ':' && key !== undefined) {
        skipWhiteSpace()
        tokenPath && tokenPath.push(key)
        var value = parseGeneric()
        tokenPath && tokenPath.pop()

        if (value === undefined) fail('No value found for key "' + key + '"')
        if (typeof key !== 'string') {
          if (!json5 || typeof key !== 'number') {
            fail('Wrong key type: "' + key + '"')
          }
        }

        if (key in emptyObject || emptyObject[key] != null) {
          // silently ignore it
        } else {
          if (reviver) {
            value = reviver(key, value)
          }
          if (value !== undefined) {
            isNotEmpty = true
            result[key] = value
          }
        }

        skipWhiteSpace()
        startToken && startToken()
        char = input[position++]
        endToken && endToken('symbol', char)
        if (char === ',') {
          continue
        } else if (char === '}') {
          return result
        } else {
          fail()
        }
      } else {
        --position
        fail()
      }
    }

    fail()
  }

  function parseArray () {
    var result = []
    while (position < inputLength) {
      skipWhiteSpace()
      tokenPath && tokenPath.push(result.length)
      var item = parseGeneric()
      tokenPath && tokenPath.pop()
      skipWhiteSpace()
      startToken && startToken()
      var char = input[position++]
      endToken && endToken('symbol', char)
      if (item !== undefined) {
        if (reviver) {
          item = reviver(String(result.length), item)
        }
        if (item === undefined) {
          ++result.length
          item = true // hack for check below, not included into result
        } else {
          result.push(item)
        }
      }

      if (char === ',') {
        if (item === undefined) {
          fail('Elisions are not supported')
        }
      } else if (char === ']') {
        if (!ignoreTrailingCommas && item === undefined && result.length) {
          --position
          fail('Trailing comma in array')
        }
        return result
      } else {
        --position
        fail()
      }
    }
  }

  function parseNumber () {
    // rewind because we don't know first char
    --position

    var start = position
    var char = input[position++]
    var toNumber = function (isOctal) {
      var string = input.substr(start, position - start)
      var result

      if (isOctal) {
        result = parseInt(string.replace(/^0o?/, ''), 8)
      } else {
        result = Number(string)
      }

      if (Number.isNaN(result)) {
        --position
        fail('Bad numeric literal - "' + input.substr(start, position - start + 1) + '"')
      } else if (!json5 && !string.match(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?(e[+-]?[0-9]+)?$/i)) {
        // additional restrictions imposed by json
        --position
        fail('Non-json numeric literal - "' + input.substr(start, position - start + 1) + '"')
      } else {
        return result
      }
    }

    // ex: -5982475.249875e+29384
    //     ^ skipping this
    if (char === '-' || (char === '+' && json5)) {
      char = input[position++]
    }

    if (char === 'N' && json5) {
      parseKeyword('NaN')
      return NaN
    }

    if (char === 'I' && json5) {
      parseKeyword('Infinity')
      // returning +inf or -inf
      return toNumber()
    }

    if (char >= '1' && char <= '9') {
      // ex: -5982475.249875e+29384
      //        ^^^ skipping these
      while (position < inputLength && isDecDigit(input[position])) {
        ++position
      }
      char = input[position++]
    }

    // special case for leading zero: 0.123456
    if (char === '0') {
      char = input[position++]

      //             new syntax, "0o777"           old syntax, "0777"
      var isOctal = char === 'o' || char === 'O' || isOctDigit(char)
      var isHex = char === 'x' || char === 'X'

      if (json5 && (isOctal || isHex)) {
        while (position < inputLength &&
               (isHex ? isHexDigit : isOctDigit)(input[position])) {
          ++position
        }

        var sign = 1
        if (input[start] === '-') {
          sign = -1
          ++start
        } else if (input[start] === '+') {
          ++start
        }

        return sign * toNumber(isOctal)
      }
    }

    if (char === '.') {
      // ex: -5982475.249875e+29384
      //                ^^^ skipping these
      while (position < inputLength && isDecDigit(input[position])) {
        ++position
      }
      char = input[position++]
    }

    if (char === 'e' || char === 'E') {
      char = input[position++]
      if (char === '-' || char === '+') {
        ++position
      }
      // ex: -5982475.249875e+29384
      //                       ^^^ skipping these
      while (position < inputLength && isDecDigit(input[position])) {
        ++position
      }
      char = input[position++]
    }

    // we have char in the buffer, so count for it
    --position
    return toNumber()
  }

  function parseIdentifier () {
    // rewind because we don't know first char
    --position

    var result = ''
    while (position < inputLength) {
      var char = input[position++]
      if (char === '\\' &&
          input[position] === 'u' &&
          isHexDigit(input[position + 1]) &&
          isHexDigit(input[position + 2]) &&
          isHexDigit(input[position + 3]) &&
          isHexDigit(input[position + 4])) {
        // UnicodeEscapeSequence
        char = String.fromCharCode(parseInt(input.substr(position + 1, 4), 16))
        position += 5
      }

      if (result.length) {
        // identifier started
        if (Uni.isIdentifierPart(char)) {
          result += char
        } else {
          --position
          return result
        }
      } else {
        if (Uni.isIdentifierStart(char)) {
          result += char
        } else {
          return undefined
        }
      }
    }

    fail()
  }

  function parseString (endChar) {
    // 7.8.4 of ES262 spec
    var result = ''
    while (position < inputLength) {
      var char = input[position++]
      if (char === endChar) {
        return result
      } else if (char === '\\') {
        if (position >= inputLength) {
          fail()
        }
        char = input[position++]
        if (unescapeMap[char] && (json5 || (char !== 'v' && (char !== "'" || allowSingleQuotedStrings)))) {
          result += unescapeMap[char]
        } else if (json5 && isLineTerminator(char)) {
          // line continuation
          newLine(char)
        } else if (char === 'u' || (char === 'x' && json5)) {
          // unicode/character escape sequence
          var count = char === 'u' ? 4 : 2
          // validation for \uXXXX
          for (var i = 0; i < count; ++i) {
            if (position >= inputLength) {
              fail()
            }
            if (!isHexDigit(input[position])) {
              fail('Bad escape sequence')
            }
            position++
          }
          result += String.fromCharCode(parseInt(input.substr(position - count, count), 16))
        } else if (json5 && isOctDigit(char)) {
          var digits
          if (char < '4' && isOctDigit(input[position]) && isOctDigit(input[position + 1])) {
            // three-digit octal
            digits = 3
          } else if (isOctDigit(input[position])) {
            // two-digit octal
            digits = 2
          } else {
            digits = 1
          }
          position += digits - 1
          result += String.fromCharCode(parseInt(input.substr(position - digits, digits), 8))
        } else if (json5) {
          // \X -> x
          result += char
        } else {
          --position
          fail()
        }
      } else if (isLineTerminator(char)) {
        fail()
      } else {
        if (!json5 && char.charCodeAt(0) < 32) {
          --position
          fail('Unexpected control character')
        }
        // SourceCharacter but not one of " or \ or LineTerminator
        result += char
      }
    }

    fail()
  }

  skipWhiteSpace()
  var returnValue = parseGeneric()
  if (returnValue !== undefined || position < inputLength) {
    skipWhiteSpace()
    if (position >= inputLength) {
      if (reviver) {
        returnValue = reviver('', returnValue)
      }
      return tokenize ? tokens : returnValue
    } else {
      fail()
    }
  } else {
    if (position) {
      fail('No data, only a whitespace')
    } else {
      fail('No data, empty input')
    }
  }
}

function parseCustom (input, options) { // eslint-disable-line no-unused-vars
  if (typeof options === 'function') {
    options = {
      reviver: options
    }
  } else if (!options) {
    options = {}
  }
  return parseInternal(input, options)
}

function tokenize (input, options) { // eslint-disable-line no-unused-vars
  if (!options) {
    options = {}
  }
  // As long as this is the single modification, this is easier than cloning.
  // (Once Node.js 6 is dropped, this can be replaced by object destructuring.)
  var oldTokenize = options.tokenize
  options.tokenize = true
  var tokens = parseInternal(input, options)
  options.tokenize = oldTokenize
  return tokens
}
